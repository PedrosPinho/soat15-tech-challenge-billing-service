import { Router } from 'express';
import { FakePaymentGateway } from '@infrastructure/payments/fake-payment-gateway';
import { ValidationError } from '@shared/errors/domain.error';
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
export const createInternalRouter = (
  c: BillingController,
  fakeGateway?: FakePaymentGateway,
): Router => {
  const router = Router();
  router.use(internalTokenMiddleware);

  // SÓ com `PAYMENT_GATEWAY=fake` (dev/smoke local): simula o comprador no checkout do MP.
  // Depois, `POST /internal/pagamentos/:id/sincronizar` reconcilia como se o webhook tivesse chegado.
  if (fakeGateway) {
    router.post('/dev/mercadopago/pagamentos', (req, res, next) => {
      const { mpPaymentId, status, orcamentoId, valor } = (req.body ?? {}) as Record<
        string,
        unknown
      >;
      if (
        typeof mpPaymentId !== 'string' ||
        typeof status !== 'string' ||
        typeof orcamentoId !== 'string' ||
        typeof valor !== 'number'
      ) {
        return next(
          new ValidationError(
            'mpPaymentId, status, orcamentoId (texto) e valor (número) são obrigatórios',
          ),
        );
      }
      res.status(201).json(fakeGateway.simularPagamento(mpPaymentId, status, orcamentoId, valor));
    });
  }
  router.get('/financeiro/resumo', c.resumo);
  router.post('/pagamentos/:id/sincronizar', c.sincronizar);
  return router;
};
