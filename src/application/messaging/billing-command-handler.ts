import { publicarEvento } from '../eventos';
import { Orcamento, OrcamentoStatus } from '@domain/entities/orcamento.entity';
import { Pagamento, PagamentoStatus } from '@domain/entities/pagamento.entity';
import { IInboxRepository } from '@domain/repositories/inbox.repository';
import { IOrcamentoRepository } from '@domain/repositories/orcamento.repository';
import { IOutboxRepository } from '@domain/repositories/outbox.repository';
import { IPagamentoRepository } from '@domain/repositories/pagamento.repository';
import { INotificationService } from '@domain/services/notification.service';
import { IPaymentGateway } from '@domain/services/payment-gateway';
import { IUnitOfWork } from '@domain/services/unit-of-work';
import { InvalidMessageError, PaymentGatewayError, ValidationError } from '@shared/errors/domain.error';
import { Envelope } from '@shared/messaging/envelope';
import {
  CancelarOrcamentoPayload,
  EstornarPagamentoPayload,
  GerarOrcamentoPayload,
  SolicitarPagamentoPayload,
} from '@shared/messaging/messages';
import { logger } from '@shared/logger';


const VERSAO_SUPORTADA = 1;

export interface BillingCommandHandlerDeps {
  uow: IUnitOfWork;
  orcamentos: IOrcamentoRepository;
  pagamentos: IPagamentoRepository;
  outbox: IOutboxRepository;
  inbox: IInboxRepository;
  gateway: IPaymentGateway;
  notifications: INotificationService;
  /** Validade do link de pagamento (alinhado ao timeout de pagamento da Saga). */
  pagamentoTtlMinutos?: number;
  /** Base pública usada no link do e-mail (API Gateway). */
  publicBaseUrl?: string;
  clock?: () => Date;
}

/**
 * Consumidor da fila `billing-commands`. Todo comando gera exatamente um evento de
 * resposta; o inbox (`mensagens_processadas`) entra na MESMA transação do efeito e do
 * outbox, então uma reentrega nunca duplica nada. Chamadas ao Mercado Pago ficam
 * FORA da transação (rede lenta não segura lock) e levam chave de idempotência.
 */
export class BillingCommandHandler {
  private readonly clock: () => Date;
  private readonly ttlMs: number;

  constructor(private readonly d: BillingCommandHandlerDeps) {
    this.clock = d.clock ?? ((): Date => new Date());
    this.ttlMs = (d.pagamentoTtlMinutos ?? 60) * 60_000;
  }

  async handle(envelope: Envelope): Promise<void> {
    if (envelope.version !== VERSAO_SUPORTADA) {
      throw new InvalidMessageError(
        `Versão ${envelope.version} de ${envelope.type} não suportada (messageId ${envelope.messageId})`,
      );
    }
    switch (envelope.type) {
      case 'GerarOrcamento':
        return this.gerarOrcamento(envelope, envelope.payload as GerarOrcamentoPayload);
      case 'CancelarOrcamento':
        return this.cancelarOrcamento(envelope, envelope.payload as CancelarOrcamentoPayload);
      case 'SolicitarPagamento':
        return this.solicitarPagamento(envelope, envelope.payload as SolicitarPagamentoPayload);
      case 'EstornarPagamento':
        return this.estornarPagamento(envelope, envelope.payload as EstornarPagamentoPayload);
      default:
        throw new InvalidMessageError(`Comando desconhecido: ${envelope.type}`);
    }
  }

  private osId(env: Envelope): string {
    const id = (env.payload as { ordemServicoId?: unknown }).ordemServicoId;
    if (typeof id !== 'string' || !id) {
      throw new InvalidMessageError(`${env.type} sem ordemServicoId (messageId ${env.messageId})`);
    }
    return id;
  }

  /** Executa `work` na transação, descartando comandos já processados (inbox). */
  private async transacao<T>(env: Envelope, work: () => Promise<T>): Promise<T | undefined> {
    return this.d.uow.run(async () => {
      if (!(await this.d.inbox.markProcessed(env.messageId, env.type))) {
        logger.info(
          { messageId: env.messageId, type: env.type },
          'Mensagem já processada: confirmando sem reprocessar',
        );
        return undefined;
      }
      return work();
    });
  }

  // ---- GerarOrcamento -------------------------------------------------------

  private async gerarOrcamento(env: Envelope, p: GerarOrcamentoPayload): Promise<void> {
    const osId = this.osId(env);
    const criado = await this.transacao(env, async () => {
      const resposta = (orc: Orcamento): Promise<void> =>
        publicarEvento(this.d.outbox, 'OrcamentoGerado', env.sagaId, env.correlationId, {
          ordemServicoId: osId,
          orcamentoId: orc.id,
          valorTotal: orc.valorTotal,
          validadeAte: orc.validadeAte.toISOString(),
        });
      const falha = (motivo: string): Promise<void> =>
        publicarEvento(this.d.outbox, 'OrcamentoFalhou', env.sagaId, env.correlationId, {
          ordemServicoId: osId,
          motivo,
        });

      const existente = await this.d.orcamentos.findByOrdemServicoId(osId, true);
      if (existente) {
        // Reenvio do orquestrador: repete a resposta, não duplica o orçamento.
        if (
          [OrcamentoStatus.CANCELADO, OrcamentoStatus.RECUSADO, OrcamentoStatus.EXPIRADO].includes(
            existente.status,
          )
        ) {
          await falha(`Orçamento da OS já está ${existente.status}`);
        } else {
          await resposta(existente);
        }
        return undefined;
      }

      let orcamento: Orcamento;
      try {
        orcamento = Orcamento.criar(
          {
            ordemServicoId: osId,
            numeroOS: p.numeroOS,
            sagaId: env.sagaId,
            cliente: p.cliente,
            itens: p.itens,
            valorTotal: p.valorTotal,
            validadeAte: p.validadeAte,
          },
          this.clock(),
        );
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        await falha(error.message);
        return undefined;
      }
      await this.d.orcamentos.insert(orcamento);
      await resposta(orcamento);
      return orcamento;
    });

    if (criado) await this.notificarOrcamento(criado);
  }

  /** Melhor esforço, fora da transação: e-mail com falha não desfaz o orçamento. */
  private async notificarOrcamento(o: Orcamento): Promise<void> {
    if (!o.cliente.email) {
      logger.info({ orcamentoId: o.id }, 'Cliente sem e-mail: notificação de orçamento ignorada');
      return;
    }
    try {
      const base = (this.d.publicBaseUrl ?? '').replace(/\/$/, '');
      await this.d.notifications.enviarOrcamentoDisponivel(o.cliente.email, {
        numeroOS: o.numeroOS,
        orcamentoId: o.id,
        clienteNome: o.cliente.nome,
        valorTotal: o.valorTotal,
        validadeAte: o.validadeAte,
        itens: o.itens,
        link: `${base}/api/orcamentos/${o.id}`,
      });
    } catch (error) {
      logger.warn({ error, orcamentoId: o.id }, 'Falha ao notificar orçamento disponível');
    }
  }

  // ---- CancelarOrcamento ----------------------------------------------------

  private async cancelarOrcamento(env: Envelope, p: CancelarOrcamentoPayload): Promise<void> {
    const osId = this.osId(env);
    await this.transacao(env, async () => {
      const encontrado = p.orcamentoId
        ? await this.d.orcamentos.findById(p.orcamentoId, true)
        : await this.d.orcamentos.findByOrdemServicoId(osId, true);
      const orcamento = encontrado && encontrado.ordemServicoId === osId ? encontrado : null;

      if (orcamento && [OrcamentoStatus.GERADO, OrcamentoStatus.APROVADO].includes(orcamento.status)) {
        orcamento.cancelar(p.motivo ?? 'Cancelado pela Saga', this.clock());
        await this.d.orcamentos.update(orcamento);
        // Link de pagamento ainda aberto deixa de valer. Se o cliente pagar mesmo assim,
        // o webhook registra o pagamento tardio e a Saga o estorna.
        const pendente = await this.d.pagamentos.findAtivoByOrcamentoId(orcamento.id, true);
        if (pendente?.status === PagamentoStatus.PENDENTE) {
          pendente.recusar('Orçamento cancelado', this.clock());
          await this.d.pagamentos.update(pendente);
        }
      }
      // Inexistente ou já terminal: no-op idempotente que ainda responde.
      await publicarEvento(this.d.outbox, 'OrcamentoCancelado', env.sagaId, env.correlationId, {
        ordemServicoId: osId,
        orcamentoId: orcamento?.id ?? p.orcamentoId,
      });
    });
  }

  // ---- SolicitarPagamento ---------------------------------------------------

  private async solicitarPagamento(env: Envelope, p: SolicitarPagamentoPayload): Promise<void> {
    const osId = this.osId(env);
    const recusa = (motivo: string, pagamentoId?: string): Promise<void> =>
      publicarEvento(this.d.outbox, 'PagamentoRecusado', env.sagaId, env.correlationId, {
        ordemServicoId: osId,
        orcamentoId: p.orcamentoId,
        pagamentoId,
        motivo,
      });
    const solicitado = (pg: Pagamento): Promise<void> =>
      publicarEvento(this.d.outbox, 'PagamentoSolicitado', env.sagaId, env.correlationId, {
        ordemServicoId: osId,
        orcamentoId: pg.orcamentoId,
        pagamentoId: pg.id,
        initPoint: pg.initPoint,
        expiraEm: pg.expiraEm.toISOString(),
      });

    const orcamento = p.orcamentoId ? await this.d.orcamentos.findById(p.orcamentoId) : null;
    if (!orcamento || orcamento.ordemServicoId !== osId) {
      await this.transacao(env, () => recusa('Orçamento não encontrado'));
      return;
    }
    if (orcamento.status !== OrcamentoStatus.APROVADO) {
      await this.transacao(env, () => recusa(`Orçamento ${orcamento.status}: pagamento não permitido`));
      return;
    }

    const existente = await this.d.pagamentos.findAtivoByOrcamentoId(orcamento.id);
    let preferencia: { preferenceId: string; initPoint: string } | undefined;
    if (!existente) {
      // Chave = orçamento: retries (fila/outbox) reaproveitam a mesma preferência.
      preferencia = await this.d.gateway.criarPreferencia({
        orcamentoId: orcamento.id,
        ordemServicoId: osId,
        numeroOS: orcamento.numeroOS,
        descricao: `Ordem de serviço ${orcamento.numeroOS}`,
        valor: orcamento.valorTotal,
        pagadorEmail: orcamento.cliente.email,
        expiraEm: new Date(this.clock().getTime() + this.ttlMs),
        idempotencyKey: `preferencia-${orcamento.id}`,
      });
    }

    await this.transacao(env, async () => {
      const ativo = await this.d.pagamentos.findAtivoByOrcamentoId(orcamento.id, true);
      if (ativo) {
        // Reenvio, ou outro comando já criou: repete a resposta adequada ao estado.
        if (ativo.status === PagamentoStatus.CONFIRMADO) {
          return publicarEvento(this.d.outbox, 'PagamentoConfirmado', env.sagaId, env.correlationId, {
            ordemServicoId: osId,
            orcamentoId: ativo.orcamentoId,
            pagamentoId: ativo.id,
            mpPaymentId: ativo.mpPaymentId ?? '',
            valor: ativo.valor,
            confirmadoEm: (ativo.confirmadoEm ?? this.clock()).toISOString(),
          });
        }
        return solicitado(ativo);
      }
      if (!preferencia) throw new Error('Pagamento ativo desapareceu entre as leituras; reentregar');
      const pagamento = Pagamento.criar(
        {
          orcamentoId: orcamento.id,
          ordemServicoId: osId,
          sagaId: env.sagaId,
          valor: orcamento.valorTotal,
          mpPreferenceId: preferencia.preferenceId,
          initPoint: preferencia.initPoint,
          expiraEm: new Date(this.clock().getTime() + this.ttlMs),
        },
        this.clock(),
      );
      await this.d.pagamentos.insert(pagamento);
      return solicitado(pagamento);
    });
  }

  // ---- EstornarPagamento ----------------------------------------------------

  private async estornarPagamento(env: Envelope, p: EstornarPagamentoPayload): Promise<void> {
    const osId = this.osId(env);
    const falha = (motivo: string): Promise<void> =>
      publicarEvento(this.d.outbox, 'EstornoFalhou', env.sagaId, env.correlationId, {
        ordemServicoId: osId,
        pagamentoId: p.pagamentoId,
        motivo,
      });
    const estornado = (pg: Pagamento): Promise<void> =>
      publicarEvento(this.d.outbox, 'PagamentoEstornado', env.sagaId, env.correlationId, {
        ordemServicoId: osId,
        pagamentoId: pg.id,
        mpRefundId: pg.mpRefundId ?? '',
      });

    const pagamento = p.pagamentoId ? await this.d.pagamentos.findById(p.pagamentoId) : null;
    if (!pagamento || pagamento.ordemServicoId !== osId) {
      await this.transacao(env, () => falha('Pagamento não encontrado'));
      return;
    }
    if (pagamento.status === PagamentoStatus.ESTORNADO) {
      await this.transacao(env, () => estornado(pagamento));
      return;
    }
    if (pagamento.status !== PagamentoStatus.CONFIRMADO || !pagamento.mpPaymentId) {
      await this.transacao(env, () => falha(`Pagamento ${pagamento.status}: não há o que estornar`));
      return;
    }

    let refundId: string;
    try {
      ({ refundId } = await this.d.gateway.estornar(pagamento.mpPaymentId, `estorno-${pagamento.id}`));
    } catch (error) {
      if (!(error instanceof PaymentGatewayError)) throw error;
      logger.warn({ error: error.message, pagamentoId: pagamento.id }, 'Estorno recusado pelo gateway');
      await this.transacao(env, () => falha(error.message));
      return;
    }

    await this.transacao(env, async () => {
      const atual = await this.d.pagamentos.findById(pagamento.id, true);
      if (atual && atual.status === PagamentoStatus.CONFIRMADO) {
        atual.estornar(refundId, p.motivo ?? 'Estorno solicitado pela Saga', this.clock());
        await this.d.pagamentos.update(atual);
        return estornado(atual);
      }
      return atual ? estornado(atual) : falha('Pagamento não encontrado');
    });
  }
}

