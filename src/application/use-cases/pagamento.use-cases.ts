import { Pagamento, PagamentoStatus } from '@domain/entities/pagamento.entity';
import { IOutboxRepository } from '@domain/repositories/outbox.repository';
import {
  IPagamentoRepository,
  ResumoFinanceiro,
} from '@domain/repositories/pagamento.repository';
import { IPaymentGateway, PagamentoGateway } from '@domain/services/payment-gateway';
import { IUnitOfWork } from '@domain/services/unit-of-work';
import { NotFoundError } from '@shared/errors/domain.error';
import { logger } from '@shared/logger';
import { correlationIdAtual, publicarEvento } from '../eventos';

export interface PagamentoUseCasesDeps {
  uow: IUnitOfWork;
  pagamentos: IPagamentoRepository;
  outbox: IOutboxRepository;
  gateway: IPaymentGateway;
  clock?: () => Date;
}

export type ResultadoNotificacao =
  | 'confirmado'
  | 'recusado'
  | 'ignorado'
  | 'ja-processado'
  | 'divergente';

/**
 * Efeitos das notificações do Mercado Pago (webhook e reconciliação). O corpo do
 * webhook nunca é confiado: o estado vem de `GET /v1/payments/:id`. Tudo é idempotente
 * pelo estado do pagamento, então webhook repetido ou concorrente gera um só evento.
 */
export class PagamentoUseCases {
  private readonly clock: () => Date;

  constructor(private readonly d: PagamentoUseCasesDeps) {
    this.clock = d.clock ?? ((): Date => new Date());
  }

  /** Webhook `payment`: consulta o MP e aplica o resultado. */
  async processarNotificacaoMercadoPago(mpPaymentId: string): Promise<ResultadoNotificacao> {
    const mp = await this.d.gateway.consultarPagamento(mpPaymentId);
    if (!mp) {
      logger.warn({ mpPaymentId }, 'Pagamento inexistente no Mercado Pago: notificação ignorada');
      return 'ignorado';
    }
    return this.aplicar(mp);
  }

  /** Reconciliação (webhook perdido): `POST /internal/pagamentos/:id/sincronizar`. */
  async sincronizar(pagamentoId: string): Promise<{ pagamento: Pagamento; resultado: ResultadoNotificacao }> {
    const pagamento = await this.d.pagamentos.findById(pagamentoId);
    if (!pagamento) throw new NotFoundError('Pagamento não encontrado');

    const lista = await this.d.gateway.buscarPorReferencia(pagamento.orcamentoId);
    // Aprovado tem prioridade; senão, o mais recente (a lista vem do mais novo ao mais antigo).
    const alvo = lista.find((p) => p.status === 'approved') ?? lista[0];
    const resultado: ResultadoNotificacao = alvo ? await this.aplicar(alvo) : 'ignorado';
    return { pagamento: (await this.d.pagamentos.findById(pagamentoId)) ?? pagamento, resultado };
  }

  resumo(): Promise<ResumoFinanceiro> {
    return this.d.pagamentos.resumo();
  }

  private async aplicar(mp: PagamentoGateway): Promise<ResultadoNotificacao> {
    if (!mp.externalReference) {
      logger.warn({ mpPaymentId: mp.id }, 'Pagamento do MP sem external_reference: ignorado');
      return 'ignorado';
    }
    const orcamentoId = mp.externalReference;

    return this.d.uow.run(async () => {
      const pagamento = await this.d.pagamentos.findUltimoByOrcamentoId(orcamentoId, true);
      if (!pagamento) {
        logger.warn({ mpPaymentId: mp.id, orcamentoId }, 'Pagamento do MP sem pagamento local: ignorado');
        return 'ignorado';
      }
      const agora = this.clock();
      const correlationId = correlationIdAtual();

      if (mp.status === 'approved') {
        if (Math.abs(mp.valor - pagamento.valor) > 0.01) {
          // Nunca confirma valor diferente do cobrado: exige intervenção manual.
          logger.error(
            { mpPaymentId: mp.id, esperado: pagamento.valor, recebido: mp.valor },
            'Valor aprovado no MP diverge do cobrado: pagamento NÃO confirmado',
          );
          return 'divergente';
        }
        if (pagamento.status === PagamentoStatus.CONFIRMADO) {
          if (pagamento.mpPaymentId !== mp.id) {
            logger.warn(
              { pagamentoId: pagamento.id, existente: pagamento.mpPaymentId, novo: mp.id },
              'Segundo pagamento aprovado para o mesmo orçamento: requer estorno manual',
            );
          }
          return 'ja-processado';
        }
        if (pagamento.status === PagamentoStatus.ESTORNADO) return 'ja-processado';

        // PENDENTE, ou RECUSADO por cancelamento (cliente pagou tarde): o dinheiro entrou.
        pagamento.confirmar(mp.id, agora);
        await this.d.pagamentos.update(pagamento);
        await publicarEvento(this.d.outbox, 'PagamentoConfirmado', pagamento.sagaId, correlationId, {
          ordemServicoId: pagamento.ordemServicoId,
          orcamentoId: pagamento.orcamentoId,
          pagamentoId: pagamento.id,
          mpPaymentId: mp.id,
          valor: pagamento.valor,
          confirmadoEm: agora.toISOString(),
        });
        return 'confirmado';
      }

      if (mp.status === 'rejected' || mp.status === 'cancelled') {
        if (pagamento.status !== PagamentoStatus.PENDENTE) return 'ja-processado';
        const motivo = mp.statusDetail ? `${mp.status}: ${mp.statusDetail}` : mp.status;
        pagamento.recusar(motivo, agora);
        await this.d.pagamentos.update(pagamento);
        await publicarEvento(this.d.outbox, 'PagamentoRecusado', pagamento.sagaId, correlationId, {
          ordemServicoId: pagamento.ordemServicoId,
          orcamentoId: pagamento.orcamentoId,
          pagamentoId: pagamento.id,
          motivo,
        });
        return 'recusado';
      }

      // pending / in_process / refunded / charged_back: sem ação (estorno é iniciado por nós).
      logger.info({ mpPaymentId: mp.id, status: mp.status }, 'Status do MP sem ação');
      return 'ignorado';
    });
  }
}
