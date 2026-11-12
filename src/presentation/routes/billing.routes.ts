import { Router } from 'express';
import { BillingController } from '@presentation/controllers/billing.controller';
import { authMiddleware } from '@presentation/middlewares/auth.middleware';
import { internalTokenMiddleware } from '@presentation/middlewares/internal-token.middleware';
import { webhookSecretMiddleware } from '@presentation/middlewares/webhook-secret.middleware';

/** `/api/orcamentos` — cliente (só o próprio) ou interno; o webhook de aprovação usa segredo compartilhado. */
export const createOrcamentoRouter = (c: BillingController): Router => {
  const router = Router();
  router.post('/:id/webhook', webhookSecretMiddleware, c.decisaoExterna);

  router.use(authMiddleware);
  router.get('/', c.obterPorOrdemServico);
  router.get('/:id', c.obterOrcamento);
  router.post('/:id/aprovar', c.aprovar);
  router.post('/:id/recusar', c.recusar);
  return router;
};

/** `/api/pagamentos` — o webhook do Mercado Pago é público (autenticado pela assinatura HMAC). */
export const createPagamentoRouter = (c: BillingController): Router => {
  const router = Router();
  router.post('/webhooks/mercadopago', c.webhookMercadoPago);

  router.use(authMiddleware);
  router.get('/', c.listarPagamentos);
  return router;
};

/** `/internal` — serviço-a-serviço; fora do API Gateway, protegido por `x-internal-token`. */
export const createInternalRouter = (c: BillingController): Router => {
  const router = Router();
  router.use(internalTokenMiddleware);
  router.get('/financeiro/resumo', c.resumo);
  router.post('/pagamentos/:id/sincronizar', c.sincronizar);
  return router;
};
