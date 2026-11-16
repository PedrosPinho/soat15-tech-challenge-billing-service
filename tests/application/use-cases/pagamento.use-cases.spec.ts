import { PagamentoUseCases } from '@application/use-cases/pagamento.use-cases';
import { Pagamento, PagamentoStatus as P } from '@domain/entities/pagamento.entity';
import { FakePaymentGateway } from '@infrastructure/payments/fake-payment-gateway';
import { NotFoundError } from '@shared/errors/domain.error';
import { makeFakes } from '../../support/fakes';

const AGORA = new Date('2026-11-12T10:00:00Z');

describe('PagamentoUseCases', () => {
  let f: ReturnType<typeof makeFakes>;
  let gateway: FakePaymentGateway;
  let uc: PagamentoUseCases;
  let pg: Pagamento;

  beforeEach(async () => {
    f = makeFakes();
    gateway = new FakePaymentGateway();
    uc = new PagamentoUseCases({ ...f, gateway, clock: () => AGORA });
    pg = Pagamento.criar(
      {
        orcamentoId: 'orc-1',
        ordemServicoId: 'os-1',
        sagaId: 'sg',
        valor: 310,
        mpPreferenceId: 'p',
        initPoint: 'http://mp',
        expiraEm: AGORA,
      },
      AGORA,
    );
    await f.pagamentos.insert(pg);
  });

  const estado = async (): Promise<Pagamento> => (await f.pagamentos.findById(pg.id))!;

  describe('processarNotificacaoMercadoPago', () => {
    it('approved confirma, guarda o mpPaymentId e publica PagamentoConfirmado', async () => {
      gateway.simularPagamento('mp-1', 'approved', 'orc-1', 310);
      expect(await uc.processarNotificacaoMercadoPago('mp-1')).toBe('confirmado');
      expect(await estado()).toMatchObject({ status: P.CONFIRMADO, mpPaymentId: 'mp-1' });
      expect(f.db.ultimo()).toMatchObject({
        type: 'PagamentoConfirmado',
        sagaId: 'sg',
        payload: {
          ordemServicoId: 'os-1',
          orcamentoId: 'orc-1',
          pagamentoId: pg.id,
          mpPaymentId: 'mp-1',
          valor: 310,
          confirmadoEm: AGORA.toISOString(),
        },
      });
    });

    it('webhook repetido gera um só evento', async () => {
      gateway.simularPagamento('mp-1', 'approved', 'orc-1', 310);
      await uc.processarNotificacaoMercadoPago('mp-1');
      expect(await uc.processarNotificacaoMercadoPago('mp-1')).toBe('ja-processado');
      expect(f.db.outbox).toHaveLength(1);
    });

    it('dois webhooks concorrentes: o segundo vê o estado já confirmado (lock da linha)', async () => {
      gateway.simularPagamento('mp-1', 'approved', 'orc-1', 310);
      const r = await Promise.all([
        uc.processarNotificacaoMercadoPago('mp-1'),
        uc.processarNotificacaoMercadoPago('mp-1'),
      ]);
      expect(r.filter((x) => x === 'confirmado')).toHaveLength(1);
      expect(f.db.outbox).toHaveLength(1);
    });

    it('segundo pagamento aprovado para o mesmo orçamento não confirma de novo', async () => {
      gateway.simularPagamento('mp-1', 'approved', 'orc-1', 310);
      gateway.simularPagamento('mp-2', 'approved', 'orc-1', 310);
      await uc.processarNotificacaoMercadoPago('mp-1');
      expect(await uc.processarNotificacaoMercadoPago('mp-2')).toBe('ja-processado');
      expect(f.db.outbox).toHaveLength(1);
    });

    it('valor aprovado diferente do cobrado NÃO confirma', async () => {
      gateway.simularPagamento('mp-1', 'approved', 'orc-1', 1);
      expect(await uc.processarNotificacaoMercadoPago('mp-1')).toBe('divergente');
      expect((await estado()).status).toBe(P.PENDENTE);
      expect(f.db.outbox).toHaveLength(0);
    });

    it('pagamento tardio (link cancelado e depois pago) é confirmado para a Saga estornar', async () => {
      pg.recusar('Orçamento cancelado', AGORA);
      await f.pagamentos.update(pg);
      gateway.simularPagamento('mp-9', 'approved', 'orc-1', 310);
      expect(await uc.processarNotificacaoMercadoPago('mp-9')).toBe('confirmado');
      expect((await estado()).status).toBe(P.CONFIRMADO);
    });

    it('aprovado após estorno é ignorado', async () => {
      pg.confirmar('mp-1', AGORA);
      pg.estornar('rf', 'x', AGORA);
      await f.pagamentos.update(pg);
      gateway.simularPagamento('mp-1', 'approved', 'orc-1', 310);
      expect(await uc.processarNotificacaoMercadoPago('mp-1')).toBe('ja-processado');
    });

    it.each(['rejected', 'cancelled'])(
      '%s recusa e publica PagamentoRecusado com o motivo',
      async (status) => {
        gateway.simularPagamento('mp-1', status, 'orc-1', 310).statusDetail =
          'cc_rejected_other_reason';
        expect(await uc.processarNotificacaoMercadoPago('mp-1')).toBe('recusado');
        expect(await estado()).toMatchObject({
          status: P.RECUSADO,
          motivo: `${status}: cc_rejected_other_reason`,
        });
        expect(f.db.ultimo()).toMatchObject({
          type: 'PagamentoRecusado',
          payload: { pagamentoId: pg.id, motivo: `${status}: cc_rejected_other_reason` },
        });
      },
    );

    it('rejeitado sem detalhe usa só o status; rejeitado repetido ou após confirmar é ignorado', async () => {
      gateway.simularPagamento('mp-1', 'rejected', 'orc-1', 310);
      await uc.processarNotificacaoMercadoPago('mp-1');
      expect((await estado()).motivo).toBe('rejected');
      expect(await uc.processarNotificacaoMercadoPago('mp-1')).toBe('ja-processado');
      expect(f.db.outbox).toHaveLength(1);
    });

    it.each(['pending', 'in_process', 'refunded', 'charged_back'])(
      '%s não tem ação',
      async (status) => {
        gateway.simularPagamento('mp-1', status, 'orc-1', 310);
        expect(await uc.processarNotificacaoMercadoPago('mp-1')).toBe('ignorado');
        expect((await estado()).status).toBe(P.PENDENTE);
      },
    );

    it('pagamento inexistente no MP, sem external_reference ou sem pagamento local é ignorado', async () => {
      expect(await uc.processarNotificacaoMercadoPago('nao-existe')).toBe('ignorado');
      gateway.pagamentos.set('mp-2', { id: 'mp-2', status: 'approved', valor: 1 });
      expect(await uc.processarNotificacaoMercadoPago('mp-2')).toBe('ignorado');
      gateway.simularPagamento('mp-3', 'approved', 'orc-sem-pagamento', 1);
      expect(await uc.processarNotificacaoMercadoPago('mp-3')).toBe('ignorado');
    });

    it('falha do gateway propaga (o MP reenvia o webhook)', async () => {
      gateway.falharProximaChamada = new Error('MP fora');
      await expect(uc.processarNotificacaoMercadoPago('mp-1')).rejects.toThrow('MP fora');
    });
  });

  describe('sincronizar (reconciliação)', () => {
    it('recupera um pagamento aprovado cujo webhook se perdeu', async () => {
      gateway.simularPagamento('mp-1', 'rejected', 'orc-1', 310);
      gateway.simularPagamento('mp-2', 'approved', 'orc-1', 310);
      const r = await uc.sincronizar(pg.id);
      expect(r.resultado).toBe('confirmado');
      expect(r.pagamento).toMatchObject({ status: P.CONFIRMADO, mpPaymentId: 'mp-2' });
    });

    it('sem nada no MP → ignorado; sem pagamento → 404', async () => {
      expect((await uc.sincronizar(pg.id)).resultado).toBe('ignorado');
      await expect(uc.sincronizar('x')).rejects.toThrow(NotFoundError);
    });

    it('sem aprovado usa o mais recente', async () => {
      gateway.simularPagamento('mp-1', 'rejected', 'orc-1', 310);
      expect((await uc.sincronizar(pg.id)).resultado).toBe('recusado');
    });
  });

  it('resumo soma só os confirmados', async () => {
    pg.confirmar('mp-1', AGORA);
    await f.pagamentos.update(pg);
    const outro = Pagamento.criar(
      {
        orcamentoId: 'orc-2',
        ordemServicoId: 'os-2',
        sagaId: 's',
        valor: 90,
        mpPreferenceId: 'p',
        initPoint: 'x',
        expiraEm: AGORA,
      },
      AGORA,
    );
    outro.confirmar('mp-2', AGORA);
    outro.estornar('rf', 'x', AGORA);
    await f.pagamentos.insert(outro);
    expect(await uc.resumo()).toEqual({
      receitaTotal: 310,
      totalEstornado: 90,
      pagamentosConfirmados: 1,
      pagamentosEstornados: 1,
    });
  });
});
