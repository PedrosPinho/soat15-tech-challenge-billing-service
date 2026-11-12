import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../../src/app';
import { OrcamentoUseCases } from '@application/use-cases/orcamento.use-cases';
import { PagamentoUseCases } from '@application/use-cases/pagamento.use-cases';
import { Orcamento, OrcamentoStatus as O } from '@domain/entities/orcamento.entity';
import { Pagamento, PagamentoStatus as P } from '@domain/entities/pagamento.entity';
import { FakePaymentGateway } from '@infrastructure/payments/fake-payment-gateway';
import { BillingController } from '@presentation/controllers/billing.controller';
import { makeFakes } from '../support/fakes';

const JWT = 'test-secret';
const MP_SECRET = 'mp-secret';
const interno = `Bearer ${jwt.sign({ sub: 'u1', email: 'a@b.c', scope: 'interno' }, JWT)}`;
const dono = `Bearer ${jwt.sign({ sub: 'c1', cpf: '52998224725', scope: 'cliente' }, JWT)}`;
const outro = `Bearer ${jwt.sign({ sub: 'c2', cpf: '11144477735', scope: 'cliente' }, JWT)}`;

describe('rotas do Billing', () => {
  let f: ReturnType<typeof makeFakes>;
  let gateway: FakePaymentGateway;
  let app: ReturnType<typeof createApp>;
  let orcId: string;
  let pg: Pagamento;
  const env = { ...process.env };

  beforeAll(() => {
    process.env.JWT_SECRET = JWT;
    process.env.INTERNAL_API_TOKEN = 'tok-interno';
    process.env.WEBHOOK_SECRET = 'wh-secret';
  });
  afterAll(() => {
    process.env = env;
  });

  beforeEach(async () => {
    f = makeFakes();
    gateway = new FakePaymentGateway();
    const o = Orcamento.criar({
      ordemServicoId: 'os-1',
      numeroOS: 'OS-1',
      sagaId: 'sg',
      cliente: { id: 'c1', nome: 'Maria', cpfCnpj: '1' },
      itens: [
        {
          tipo: 'SERVICO',
          referenciaId: 's',
          descricao: 'Revisão',
          quantidade: 1,
          valorUnitario: 200,
        },
      ],
      valorTotal: 200,
      validadeAte: new Date(Date.now() + 86_400_000),
    });
    await f.orcamentos.insert(o);
    orcId = o.id;
    pg = Pagamento.criar({
      orcamentoId: orcId,
      ordemServicoId: 'os-1',
      sagaId: 'sg',
      valor: 200,
      mpPreferenceId: 'pref',
      initPoint: 'https://mp/checkout',
      expiraEm: new Date(),
    });
    await f.pagamentos.insert(pg);
    app = createApp({
      billingController: new BillingController(
        new OrcamentoUseCases({ ...f }),
        new PagamentoUseCases({ ...f, gateway }),
        () => MP_SECRET,
      ),
    });
  });

  describe('/api/orcamentos', () => {
    it('exige autenticação', async () => {
      expect((await request(app).get(`/api/orcamentos/${orcId}`)).status).toBe(401);
      expect((await request(app).post(`/api/orcamentos/${orcId}/aprovar`)).status).toBe(401);
    });

    it('GET /:id devolve o orçamento com o pagamento e o initPoint; cliente de outro → 403; inexistente → 404', async () => {
      const res = await request(app).get(`/api/orcamentos/${orcId}`).set('Authorization', dono);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: orcId,
        status: 'GERADO',
        valorTotal: 200,
        pagamento: { initPoint: 'https://mp/checkout', status: 'PENDENTE' },
      });
      expect(res.body.data.cliente).toEqual({ id: 'c1', nome: 'Maria' }); // sem CPF/e-mail
      expect(
        (await request(app).get(`/api/orcamentos/${orcId}`).set('Authorization', outro)).status,
      ).toBe(403);
      expect(
        (await request(app).get('/api/orcamentos/x').set('Authorization', interno)).status,
      ).toBe(404);
    });

    it('GET /?ordemServicoId= localiza o orçamento da OS; sem parâmetro → 400', async () => {
      const res = await request(app)
        .get('/api/orcamentos?ordemServicoId=os-1')
        .set('Authorization', interno);
      expect(res.body.data.id).toBe(orcId);
      expect((await request(app).get('/api/orcamentos').set('Authorization', interno)).status).toBe(
        400,
      );
    });

    it('POST /:id/aprovar aprova e publica o evento; repetir é idempotente', async () => {
      const res = await request(app)
        .post(`/api/orcamentos/${orcId}/aprovar`)
        .set('Authorization', dono);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(O.APROVADO);
      await request(app).post(`/api/orcamentos/${orcId}/aprovar`).set('Authorization', dono);
      expect(f.db.tipos()).toEqual(['OrcamentoAprovado']);
      expect(
        (await request(app).post(`/api/orcamentos/${orcId}/aprovar`).set('Authorization', outro))
          .status,
      ).toBe(403);
    });

    it('POST /:id/recusar aceita motivo opcional e valida o tipo', async () => {
      expect(
        (
          await request(app)
            .post(`/api/orcamentos/${orcId}/recusar`)
            .set('Authorization', dono)
            .send({ motivo: 123 })
        ).status,
      ).toBe(400);
      const res = await request(app)
        .post(`/api/orcamentos/${orcId}/recusar`)
        .set('Authorization', dono)
        .send({ motivo: 'caro' });
      expect(res.body.data).toMatchObject({ status: O.RECUSADO, motivo: 'caro' });
      expect(
        (await request(app).post(`/api/orcamentos/${orcId}/aprovar`).set('Authorization', dono))
          .status,
      ).toBe(422);
    });

    it('recusar sem corpo funciona', async () => {
      expect(
        (await request(app).post(`/api/orcamentos/${orcId}/recusar`).set('Authorization', interno))
          .status,
      ).toBe(200);
    });

    describe('webhook de aprovação externa (segredo compartilhado)', () => {
      it('sem/ com segredo errado → 401', async () => {
        expect(
          (await request(app).post(`/api/orcamentos/${orcId}/webhook`).send({ aprovado: true }))
            .status,
        ).toBe(401);
        expect(
          (
            await request(app)
              .post(`/api/orcamentos/${orcId}/webhook`)
              .set('x-webhook-secret', 'errado')
              .send({ aprovado: true })
          ).status,
        ).toBe(401);
        expect(
          (
            await request(app)
              .post(`/api/orcamentos/${orcId}/webhook`)
              .set('x-webhook-secret', 'wh-secrex')
              .send({ aprovado: true })
          ).status,
        ).toBe(401);
      });
      it('aprova e recusa', async () => {
        const ok = await request(app)
          .post(`/api/orcamentos/${orcId}/webhook`)
          .set('x-webhook-secret', 'wh-secret')
          .send({ aprovado: true });
        expect(ok.body.data.status).toBe(O.APROVADO);
        expect(f.db.tipos()).toEqual(['OrcamentoAprovado']);
      });
      it('recusa com motivo; corpo inválido → 400', async () => {
        const r = await request(app)
          .post(`/api/orcamentos/${orcId}/webhook`)
          .set('x-webhook-secret', 'wh-secret')
          .send({ aprovado: false, motivo: 'sem verba' });
        expect(r.body.data).toMatchObject({ status: O.RECUSADO, motivo: 'sem verba' });
        expect(
          (
            await request(app)
              .post(`/api/orcamentos/${orcId}/webhook`)
              .set('x-webhook-secret', 'wh-secret')
              .send({})
          ).status,
        ).toBe(400);
      });
      it('sem WEBHOOK_SECRET configurado nada passa', async () => {
        const salvo = process.env.WEBHOOK_SECRET;
        delete process.env.WEBHOOK_SECRET;
        expect(
          (
            await request(app)
              .post(`/api/orcamentos/${orcId}/webhook`)
              .set('x-webhook-secret', 'x')
              .send({ aprovado: true })
          ).status,
        ).toBe(401);
        process.env.WEBHOOK_SECRET = salvo;
      });
    });
  });

  describe('/api/pagamentos', () => {
    it('GET lista os pagamentos da OS (dono/interno), 400 sem parâmetro, 403 para outro cliente', async () => {
      const ok = await request(app)
        .get('/api/pagamentos?ordemServicoId=os-1')
        .set('Authorization', dono);
      expect(ok.body.data).toHaveLength(1);
      expect(ok.body.data[0]).toMatchObject({ id: pg.id, valor: 200 });
      expect(
        (await request(app).get('/api/pagamentos?ordemServicoId=os-1').set('Authorization', outro))
          .status,
      ).toBe(403);
      expect((await request(app).get('/api/pagamentos').set('Authorization', interno)).status).toBe(
        400,
      );
      expect((await request(app).get('/api/pagamentos?ordemServicoId=os-1')).status).toBe(401);
    });

    describe('POST /webhooks/mercadopago (público, assinado)', () => {
      const assinado = (
        dataId: string,
        over: { ts?: string; secret?: string; requestId?: string } = {},
      ): Record<string, string> => {
        const ts = over.ts ?? '1700000000';
        const requestId = over.requestId ?? 'req-1';
        const v1 = createHmac('sha256', over.secret ?? MP_SECRET)
          .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
          .digest('hex');
        return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
      };
      const enviar = (
        dataId: string,
        headers: Record<string, string>,
        query = `data.id=${dataId}&type=payment`,
      ) =>
        request(app)
          .post(`/api/pagamentos/webhooks/mercadopago?${query}`)
          .set(headers)
          .send({ action: 'payment.updated', data: { id: dataId }, type: 'payment' });

      it('assinatura inválida ou ausente → 401 e nada é processado', async () => {
        gateway.simularPagamento('777', 'approved', orcId, 200);
        expect((await enviar('777', assinado('777', { secret: 'errado' }))).status).toBe(401);
        expect((await enviar('777', {})).status).toBe(401);
        expect((await enviar('888', assinado('777'))).status).toBe(401);
        expect(gateway.chamadas.consultarPagamento).toBe(0);
        expect(f.db.outbox).toHaveLength(0);
      });

      it('assinatura válida consulta o MP e confirma; webhook repetido gera um só evento', async () => {
        gateway.simularPagamento('777', 'approved', orcId, 200);
        const r1 = await enviar('777', assinado('777'));
        expect(r1.status).toBe(200);
        expect(r1.body.resultado).toBe('confirmado');
        const r2 = await enviar('777', assinado('777'));
        expect(r2.body.resultado).toBe('ja-processado');
        expect(f.db.tipos()).toEqual(['PagamentoConfirmado']);
        expect((await f.pagamentos.findById(pg.id))!.status).toBe(P.CONFIRMADO);
      });

      it('o corpo nunca é confiado: o estado vem do MP', async () => {
        gateway.simularPagamento('777', 'rejected', orcId, 200);
        const r = await request(app)
          .post('/api/pagamentos/webhooks/mercadopago?data.id=777&type=payment')
          .set(assinado('777'))
          .send({ status: 'approved', data: { id: '777' } });
        expect(r.body.resultado).toBe('recusado');
      });

      it('tipos que não são payment respondem 200 sem consultar o MP', async () => {
        const r = await request(app)
          .post('/api/pagamentos/webhooks/mercadopago?data.id=1&type=merchant_order')
          .set(assinado('1'))
          .send({});
        expect(r.status).toBe(200);
        expect(r.body.status).toBe('ignored');
        expect(gateway.chamadas.consultarPagamento).toBe(0);
      });

      it('usa o data.id e o type do corpo quando a query não os traz (assinatura sem id)', async () => {
        const v1 = createHmac('sha256', MP_SECRET).update('request-id:req-1;ts:1;').digest('hex');
        const r = await request(app)
          .post('/api/pagamentos/webhooks/mercadopago')
          .set({ 'x-signature': `ts=1,v1=${v1}`, 'x-request-id': 'req-1' })
          .send({ topic: 'payment', data: { id: 5 } });
        expect(r.status).toBe(200);
        expect(r.body.resultado).toBe('ignorado'); // consultou o MP: pagamento 5 não existe lá
        expect(gateway.chamadas.consultarPagamento).toBe(1);
      });

      it('sem MP_WEBHOOK_SECRET configurado rejeita tudo', async () => {
        const app2 = createApp({
          billingController: new BillingController(
            new OrcamentoUseCases({ ...f }),
            new PagamentoUseCases({ ...f, gateway }),
            () => undefined,
          ),
        });
        const r = await request(app2)
          .post('/api/pagamentos/webhooks/mercadopago?data.id=1&type=payment')
          .set(assinado('1'))
          .send({});
        expect(r.status).toBe(401);
      });

      it('falha ao consultar o MP → 500 (o MP reenvia)', async () => {
        gateway.falharProximaChamada = new Error('MP fora');
        expect((await enviar('777', assinado('777'))).status).toBe(500);
      });

      it('corpo vazio com query válida funciona', async () => {
        gateway.simularPagamento('9', 'pending', orcId, 200);
        const r = await request(app)
          .post('/api/pagamentos/webhooks/mercadopago?data.id=9&type=payment')
          .set(assinado('9'));
        expect(r.body.resultado).toBe('ignorado');
      });
    });
  });

  describe('/internal', () => {
    const tok = { 'x-internal-token': 'tok-interno' };

    it('exige o token interno', async () => {
      expect((await request(app).get('/internal/financeiro/resumo')).status).toBe(401);
      expect(
        (await request(app).get('/internal/financeiro/resumo').set('x-internal-token', 'errado'))
          .status,
      ).toBe(401);
      expect(
        (await request(app).get('/internal/financeiro/resumo').set('Authorization', interno))
          .status,
      ).toBe(401);
    });

    it('GET /financeiro/resumo devolve a receita (formato lido pelo OS)', async () => {
      pg.confirmar('mp-1');
      await f.pagamentos.update(pg);
      const res = await request(app).get('/internal/financeiro/resumo').set(tok);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        receitaTotal: 200,
        totalEstornado: 0,
        pagamentosConfirmados: 1,
        pagamentosEstornados: 0,
      });
    });

    it('POST /pagamentos/:id/sincronizar reconcilia com o MP; inexistente → 404', async () => {
      gateway.simularPagamento('mp-7', 'approved', orcId, 200);
      const res = await request(app).post(`/internal/pagamentos/${pg.id}/sincronizar`).set(tok);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        resultado: 'confirmado',
        data: { status: 'CONFIRMADO', mpPaymentId: 'mp-7' },
      });
      expect((await request(app).post('/internal/pagamentos/x/sincronizar').set(tok)).status).toBe(
        404,
      );
    });
  });

  it('sem controller as rotas de negócio não existem', async () => {
    expect((await request(createApp()).get('/api/orcamentos/x')).status).toBe(404);
  });
});
