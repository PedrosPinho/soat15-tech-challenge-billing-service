import { NextFunction, Request, Response } from 'express';
import { Orcamento } from '@domain/entities/orcamento.entity';
import { Pagamento } from '@domain/entities/pagamento.entity';
import {
  Actor,
  OrcamentoDetalhado,
  OrcamentoUseCases,
} from '@application/use-cases/orcamento.use-cases';
import { PagamentoUseCases } from '@application/use-cases/pagamento.use-cases';
import { AuthenticatedRequest } from '@presentation/middlewares/auth.middleware';
import {
  validarDecisaoExterna,
  validarMotivoOpcional,
  validarOrdemServicoId,
} from '@presentation/validators/billing.validator';
import { verificarAssinaturaMercadoPago } from '@infrastructure/security/mercado-pago-signature';
import { UnauthorizedError } from '@shared/errors/domain.error';
import { logger } from '@shared/logger';

const actorDe = (req: AuthenticatedRequest): Actor =>
  req.scope === 'cliente'
    ? { scope: 'cliente', clienteId: req.clienteId ?? '' }
    : { scope: 'interno' };

const orcamentoView = (o: Orcamento): Record<string, unknown> => ({
  id: o.id,
  ordemServicoId: o.ordemServicoId,
  numeroOS: o.numeroOS,
  cliente: { id: o.cliente.id, nome: o.cliente.nome },
  itens: o.itens,
  valorTotal: o.valorTotal,
  validadeAte: o.validadeAte,
  status: o.status,
  motivo: o.motivo,
  aprovadoEm: o.aprovadoEm,
  criadoEm: o.criadoEm,
  atualizadoEm: o.atualizadoEm,
});

const pagamentoView = (p: Pagamento): Record<string, unknown> => ({
  id: p.id,
  orcamentoId: p.orcamentoId,
  ordemServicoId: p.ordemServicoId,
  valor: p.valor,
  status: p.status,
  initPoint: p.initPoint,
  expiraEm: p.expiraEm,
  mpPaymentId: p.mpPaymentId,
  mpRefundId: p.mpRefundId,
  motivo: p.motivo,
  confirmadoEm: p.confirmadoEm,
  criadoEm: p.criadoEm,
});

const detalheView = (d: OrcamentoDetalhado): Record<string, unknown> => ({
  ...orcamentoView(d.orcamento),
  pagamento: d.pagamento ? pagamentoView(d.pagamento) : null,
});

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<void>;
const wrap =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req as AuthenticatedRequest, res).catch(next);
  };

const param = (req: Request, nome: string): string => String(req.params[nome]);

export class BillingController {
  constructor(
    private readonly orcamentos: OrcamentoUseCases,
    private readonly pagamentos: PagamentoUseCases,
    private readonly mpWebhookSecret: () => string | undefined = () =>
      process.env.MP_WEBHOOK_SECRET,
  ) {}

  // ---- orçamentos ----

  obterOrcamento = wrap(async (req, res) => {
    const data = await this.orcamentos.obter(param(req, 'id'), actorDe(req));
    res.json({ status: 'success', data: detalheView(data) });
  });

  obterPorOrdemServico = wrap(async (req, res) => {
    const data = await this.orcamentos.obterPorOrdemServico(
      validarOrdemServicoId(req.query),
      actorDe(req),
    );
    res.json({ status: 'success', data: detalheView(data) });
  });

  aprovar = wrap(async (req, res) => {
    const o = await this.orcamentos.aprovar(param(req, 'id'), actorDe(req));
    res.json({ status: 'success', data: orcamentoView(o) });
  });

  recusar = wrap(async (req, res) => {
    const o = await this.orcamentos.recusar(
      param(req, 'id'),
      actorDe(req),
      validarMotivoOpcional(req.body),
    );
    res.json({ status: 'success', data: orcamentoView(o) });
  });

  /** Aprovação/recusa por sistema externo (segredo compartilhado, sem JWT). */
  decisaoExterna = wrap(async (req, res) => {
    const { aprovado, motivo } = validarDecisaoExterna(req.body);
    const actor: Actor = { scope: 'interno' };
    const o = aprovado
      ? await this.orcamentos.aprovar(param(req, 'id'), actor)
      : await this.orcamentos.recusar(param(req, 'id'), actor, motivo);
    res.json({ status: 'success', data: orcamentoView(o) });
  });

  // ---- pagamentos ----

  listarPagamentos = wrap(async (req, res) => {
    const lista = await this.orcamentos.listarPagamentos(
      validarOrdemServicoId(req.query),
      actorDe(req),
    );
    res.json({ status: 'success', data: lista.map(pagamentoView) });
  });

  /**
   * Webhook público do Mercado Pago. Assinatura inválida → 401 (nada é processado). Válida →
   * o estado é SEMPRE reconsultado no MP; resposta 200 mesmo para eventos sem ação, para o MP
   * não reenviar. Falha ao processar → 500 (o MP tenta de novo; o processamento é idempotente).
   */
  webhookMercadoPago = wrap(async (req, res) => {
    const body = (req.body ?? {}) as {
      type?: string;
      topic?: string;
      data?: { id?: string | number };
    };
    // A assinatura cobre o `data.id` da QUERY; o corpo só é usado como fallback de roteamento.
    const queryDataId = req.query['data.id'] as string | undefined;
    const dataId = queryDataId ?? (body.data?.id !== undefined ? String(body.data.id) : undefined);

    const valida = verificarAssinaturaMercadoPago({
      xSignature: req.header('x-signature'),
      xRequestId: req.header('x-request-id'),
      dataId: queryDataId,
      secret: this.mpWebhookSecret() ?? '',
    });
    if (!valida) throw new UnauthorizedError('Assinatura do webhook inválida');

    const tipo = (req.query.type as string | undefined) ?? body.type ?? body.topic;
    if (tipo !== 'payment' || !dataId) {
      logger.info({ tipo, dataId }, 'Notificação do Mercado Pago sem ação (não é payment)');
      res.status(200).json({ status: 'ignored' });
      return;
    }
    const resultado = await this.pagamentos.processarNotificacaoMercadoPago(dataId);
    res.status(200).json({ status: 'ok', resultado });
  });

  // ---- /internal ----

  resumo = wrap(async (_req, res) => {
    res.json(await this.pagamentos.resumo());
  });

  sincronizar = wrap(async (req, res) => {
    const { pagamento, resultado } = await this.pagamentos.sincronizar(param(req, 'id'));
    res.json({ status: 'success', resultado, data: pagamentoView(pagamento) });
  });
}
