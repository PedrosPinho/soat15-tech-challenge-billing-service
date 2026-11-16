import { BillingCommandHandler } from '@application/messaging/billing-command-handler';
import { OrcamentoStatus as O } from '@domain/entities/orcamento.entity';
import { PagamentoStatus as P } from '@domain/entities/pagamento.entity';
import { FakePaymentGateway } from '@infrastructure/payments/fake-payment-gateway';
import { InvalidMessageError, PaymentGatewayError } from '@shared/errors/domain.error';
import { createEnvelope, Envelope } from '@shared/messaging/envelope';
import { makeFakes } from '../../support/fakes';

const AGORA = new Date('2026-11-12T10:00:00Z');
type Extra = { version?: number; messageId?: string };
const cmd = (type: string, payload: object, extra: Extra = {}): Envelope =>
  createEnvelope({ type, sagaId: 'saga-1', correlationId: 'corr-1', payload, ...extra });

const gerar = (over: object = {}, extra: Extra = {}): Envelope =>
  cmd(
    'GerarOrcamento',
    {
      ordemServicoId: 'os-1',
      numeroOS: 'OS-1',
      cliente: { id: 'c1', nome: 'Maria', email: 'maria@x.com', cpfCnpj: '123' },
      itens: [
        {
          tipo: 'SERVICO',
          referenciaId: 's1',
          descricao: 'Revisão',
          quantidade: 1,
          valorUnitario: 250,
        },
        { tipo: 'PECA', referenciaId: 'p1', descricao: 'Filtro', quantidade: 2, valorUnitario: 30 },
      ],
      valorTotal: 310,
      validadeAte: '2026-11-20T00:00:00Z',
      ...over,
    },
    extra,
  );

describe('BillingCommandHandler', () => {
  let f: ReturnType<typeof makeFakes>;
  let gateway: FakePaymentGateway;
  let handler: BillingCommandHandler;

  beforeEach(() => {
    f = makeFakes();
    gateway = new FakePaymentGateway();
    handler = new BillingCommandHandler({
      ...f,
      gateway,
      clock: () => AGORA,
      publicBaseUrl: 'https://api.test/',
      pagamentoTtlMinutos: 30,
    });
  });

  const orcamento = async (): Promise<
    NonNullable<Awaited<ReturnType<typeof f.orcamentos.findByOrdemServicoId>>>
  > => (await f.orcamentos.findByOrdemServicoId('os-1'))!;
  const aprovar = async (): Promise<string> => {
    await handler.handle(gerar());
    const o = await orcamento();
    o.aprovar(AGORA);
    await f.orcamentos.update(o);
    return o.id;
  };
  const solicitar = (orcamentoId: string, extra: Extra = {}): Envelope =>
    cmd('SolicitarPagamento', { ordemServicoId: 'os-1', orcamentoId }, extra);
  const confirmarPagamento = async (orcId: string): Promise<string> => {
    await handler.handle(solicitar(orcId));
    const pg = (await f.pagamentos.findAtivoByOrcamentoId(orcId))!;
    pg.confirmar('mp-1', AGORA);
    await f.pagamentos.update(pg);
    gateway.simularPagamento('mp-1', 'approved', orcId, pg.valor);
    return pg.id;
  };

  describe('GerarOrcamento', () => {
    it('cria o orçamento, responde OrcamentoGerado e notifica o cliente', async () => {
      await handler.handle(gerar());
      const o = await orcamento();
      expect(o).toMatchObject({ status: O.GERADO, valorTotal: 310, sagaId: 'saga-1' });
      expect(f.db.tipos()).toEqual(['OrcamentoGerado']);
      expect(f.db.ultimo()).toMatchObject({
        sagaId: 'saga-1',
        correlationId: 'corr-1',
        payload: {
          ordemServicoId: 'os-1',
          orcamentoId: o.id,
          valorTotal: 310,
          validadeAte: '2026-11-20T00:00:00.000Z',
        },
      });
      expect(f.notifications.enviados).toHaveLength(1);
      expect(f.notifications.enviados[0]).toMatchObject({
        para: 'maria@x.com',
        dados: {
          numeroOS: 'OS-1',
          valorTotal: 310,
          link: `https://api.test/api/orcamentos/${o.id}`,
        },
      });
    });

    it('é idempotente (mesmo messageId) e repete a resposta no reenvio com novo messageId', async () => {
      const msg = gerar();
      await handler.handle(msg);
      await handler.handle(msg);
      expect(f.db.orcamentos.size).toBe(1);
      expect(f.db.outbox).toHaveLength(1);
      expect(f.notifications.enviados).toHaveLength(1);

      await handler.handle(gerar());
      expect(f.db.orcamentos.size).toBe(1);
      expect(f.db.tipos()).toEqual(['OrcamentoGerado', 'OrcamentoGerado']);
      expect(f.notifications.enviados).toHaveLength(1);
    });

    it('orçamento da OS já cancelado/recusado responde OrcamentoFalhou', async () => {
      await handler.handle(gerar());
      const o = await orcamento();
      o.cancelar('x', AGORA);
      await f.orcamentos.update(o);
      await handler.handle(gerar());
      expect(f.db.ultimo()).toMatchObject({
        type: 'OrcamentoFalhou',
        payload: { motivo: expect.stringContaining('CANCELADO') },
      });
    });

    it('dados inválidos respondem OrcamentoFalhou sem criar nada', async () => {
      await handler.handle(gerar({ valorTotal: 1 }));
      expect(f.db.orcamentos.size).toBe(0);
      expect(f.db.ultimo()).toMatchObject({
        type: 'OrcamentoFalhou',
        payload: { ordemServicoId: 'os-1' },
      });
      expect(f.notifications.enviados).toHaveLength(0);
    });

    it('cliente sem e-mail não é notificado; falha de e-mail não desfaz o orçamento', async () => {
      await handler.handle(gerar({ cliente: { id: 'c1', nome: 'M', cpfCnpj: '1' } }));
      expect(f.notifications.enviados).toHaveLength(0);

      f.notifications.falhar = true;
      await handler.handle(gerar({ ordemServicoId: 'os-2' }));
      expect(f.db.orcamentos.size).toBe(2);
    });

    it('erro inesperado faz rollback (nem orçamento, nem inbox, nem outbox) e propaga', async () => {
      jest.spyOn(f.outbox, 'enqueue').mockRejectedValueOnce(new Error('db caiu'));
      const msg = gerar();
      await expect(handler.handle(msg)).rejects.toThrow('db caiu');
      expect(f.db.orcamentos.size).toBe(0);
      expect(f.db.inbox.size).toBe(0);
      await handler.handle(msg); // a reentrega funciona
      expect(f.db.orcamentos.size).toBe(1);
    });

    it('sem ordemServicoId é erro permanente', async () => {
      await expect(handler.handle(cmd('GerarOrcamento', {}))).rejects.toThrow(InvalidMessageError);
    });
  });

  describe('CancelarOrcamento', () => {
    const cancelar = (payload: object = {}, extra: Extra = {}): Envelope =>
      cmd(
        'CancelarOrcamento',
        { ordemServicoId: 'os-1', motivo: 'cliente desistiu', ...payload },
        extra,
      );

    it.each([
      ['GERADO', false],
      ['APROVADO', true],
    ])('cancela orçamento %s e responde', async (_s, aprovado) => {
      const id = aprovado
        ? await aprovar()
        : (await handler.handle(gerar()), (await orcamento()).id);
      await handler.handle(cancelar({ orcamentoId: id }));
      expect((await orcamento()).status).toBe(O.CANCELADO);
      expect(f.db.ultimo()).toMatchObject({
        type: 'OrcamentoCancelado',
        payload: { orcamentoId: id },
      });
    });

    it('recusa o pagamento pendente (link deixa de valer)', async () => {
      const id = await aprovar();
      await handler.handle(solicitar(id));
      await handler.handle(cancelar());
      const pg = (await f.pagamentos.findUltimoByOrcamentoId(id))!;
      expect(pg).toMatchObject({ status: P.RECUSADO, motivo: 'Orçamento cancelado' });
    });

    it('não mexe em pagamento já confirmado (o estorno é outro comando)', async () => {
      const id = await aprovar();
      const pgId = await confirmarPagamento(id);
      await handler.handle(cancelar());
      expect((await f.pagamentos.findById(pgId))!.status).toBe(P.CONFIRMADO);
    });

    it('inexistente, de outra OS ou já terminal: no-op que responde', async () => {
      await handler.handle(cancelar());
      expect(f.db.ultimo()).toMatchObject({
        type: 'OrcamentoCancelado',
        payload: { ordemServicoId: 'os-1' },
      });

      await handler.handle(gerar());
      const id = (await orcamento()).id;
      await handler.handle(cancelar({ ordemServicoId: 'outra', orcamentoId: id }));
      expect((await orcamento()).status).toBe(O.GERADO);

      const o = await orcamento();
      o.recusar('x', AGORA);
      await f.orcamentos.update(o);
      await handler.handle(cancelar());
      expect((await orcamento()).status).toBe(O.RECUSADO);
    });

    it('é idempotente para o mesmo messageId e usa motivo padrão', async () => {
      await handler.handle(gerar());
      const msg = cmd('CancelarOrcamento', { ordemServicoId: 'os-1' });
      await handler.handle(msg);
      const n = f.db.outbox.length;
      await handler.handle(msg);
      expect(f.db.outbox).toHaveLength(n);
      expect((await orcamento()).motivo).toBe('Cancelado pela Saga');
    });
  });

  describe('SolicitarPagamento', () => {
    it('cria a preferência e o pagamento PENDENTE e responde PagamentoSolicitado', async () => {
      const id = await aprovar();
      await handler.handle(solicitar(id));
      const pg = (await f.pagamentos.findAtivoByOrcamentoId(id))!;
      expect(pg).toMatchObject({ status: P.PENDENTE, valor: 310 });
      expect(pg.expiraEm).toEqual(new Date(AGORA.getTime() + 30 * 60_000));
      expect(f.db.ultimo()).toMatchObject({
        type: 'PagamentoSolicitado',
        payload: {
          orcamentoId: id,
          pagamentoId: pg.id,
          initPoint: pg.initPoint,
          expiraEm: pg.expiraEm.toISOString(),
        },
      });
      const pref = [...gateway.preferencias.values()][0];
      expect(pref.input).toMatchObject({
        valor: 310,
        pagadorEmail: 'maria@x.com',
        idempotencyKey: `preferencia-${id}`,
      });
    });

    it('é idempotente: mesmo messageId e reenvio repetem a resposta sem nova preferência', async () => {
      const id = await aprovar();
      const msg = solicitar(id);
      await handler.handle(msg);
      await handler.handle(msg);
      await handler.handle(solicitar(id));
      expect(f.db.pagamentos.size).toBe(1);
      expect(gateway.chamadas.criarPreferencia).toBe(1);
      expect(f.db.tipos().filter((t) => t === 'PagamentoSolicitado')).toHaveLength(2);
    });

    it('com pagamento já confirmado repete PagamentoConfirmado', async () => {
      const id = await aprovar();
      const pgId = await confirmarPagamento(id);
      await handler.handle(solicitar(id));
      expect(f.db.ultimo()).toMatchObject({
        type: 'PagamentoConfirmado',
        payload: { pagamentoId: pgId, mpPaymentId: 'mp-1', valor: 310 },
      });
    });

    it.each([
      ['orçamento inexistente', () => 'nao-existe', 'não encontrado'],
      [
        'orçamento de outra OS',
        async () => {
          await handler.handle(gerar({ ordemServicoId: 'os-9' }));
          return (await f.orcamentos.findByOrdemServicoId('os-9'))!.id;
        },
        'não encontrado',
      ],
    ])('%s → PagamentoRecusado', async (_n, obterId, motivo) => {
      const id = await obterId();
      await handler.handle(solicitar(id));
      expect(f.db.ultimo()).toMatchObject({
        type: 'PagamentoRecusado',
        payload: { motivo: expect.stringContaining(motivo) },
      });
      expect(gateway.chamadas.criarPreferencia).toBe(0);
    });

    it('orçamento não aprovado → PagamentoRecusado', async () => {
      await handler.handle(gerar());
      await handler.handle(solicitar((await orcamento()).id));
      expect(f.db.ultimo()).toMatchObject({
        type: 'PagamentoRecusado',
        payload: { motivo: expect.stringContaining('GERADO') },
      });
    });

    it('falha do Mercado Pago propaga (a mensagem volta à fila) sem gravar o inbox', async () => {
      const id = await aprovar();
      gateway.falharProximaChamada = new PaymentGatewayError('MP fora');
      const msg = solicitar(id);
      await expect(handler.handle(msg)).rejects.toThrow('MP fora');
      expect(f.db.inbox.has(msg.messageId)).toBe(false);
      await handler.handle(msg);
      expect(f.db.pagamentos.size).toBe(1);
    });

    it('corrida: outro comando criou o pagamento depois da 1ª leitura → reaproveita o existente', async () => {
      const id = await aprovar();
      await handler.handle(solicitar(id));
      jest.spyOn(f.pagamentos, 'findAtivoByOrcamentoId').mockResolvedValueOnce(null); // 1ª leitura (fora da tx)
      await handler.handle(solicitar(id));
      expect(f.db.pagamentos.size).toBe(1);
      expect(f.db.tipos().filter((t) => t === 'PagamentoSolicitado')).toHaveLength(2);
    });

    it('pagamento ativo que sumiu entre as leituras gera erro para reentrega', async () => {
      const id = await aprovar();
      await handler.handle(solicitar(id));
      const real = await f.pagamentos.findAtivoByOrcamentoId(id);
      jest
        .spyOn(f.pagamentos, 'findAtivoByOrcamentoId')
        .mockResolvedValueOnce(real) // 1ª leitura: existe, então não cria preferência
        .mockResolvedValueOnce(null); // 2ª (sob lock): sumiu
      await expect(handler.handle(solicitar(id))).rejects.toThrow('reentregar');
    });
  });

  describe('EstornarPagamento', () => {
    const estornar = (pagamentoId: string, extra: Extra = {}): Envelope =>
      cmd(
        'EstornarPagamento',
        { ordemServicoId: 'os-1', pagamentoId, motivo: 'reparo falhou' },
        extra,
      );

    it('estorna no MP, marca ESTORNADO e responde PagamentoEstornado', async () => {
      const id = await aprovar();
      const pgId = await confirmarPagamento(id);
      await handler.handle(estornar(pgId));
      const pg = (await f.pagamentos.findById(pgId))!;
      expect(pg).toMatchObject({ status: P.ESTORNADO, motivo: 'reparo falhou' });
      expect(f.db.ultimo()).toMatchObject({
        type: 'PagamentoEstornado',
        payload: { pagamentoId: pgId, mpRefundId: pg.mpRefundId },
      });
      expect(gateway.estornos.has(`estorno-${pgId}`)).toBe(true);
    });

    it('é idempotente: mesmo messageId, e novo comando após estornado repete o refundId', async () => {
      const id = await aprovar();
      const pgId = await confirmarPagamento(id);
      const msg = estornar(pgId);
      await handler.handle(msg);
      await handler.handle(msg);
      await handler.handle(estornar(pgId));
      expect(gateway.chamadas.estornar).toBe(1);
      expect(f.db.tipos()).toContain('PagamentoEstornado');
      expect(f.db.outbox.filter((e) => e.type === 'PagamentoEstornado')).toHaveLength(2);
    });

    it('falha do gateway responde EstornoFalhou (a Saga decide o retry)', async () => {
      const id = await aprovar();
      const pgId = await confirmarPagamento(id);
      gateway.falharProximaChamada = new PaymentGatewayError('MP 500');
      await handler.handle(estornar(pgId));
      expect(f.db.ultimo()).toMatchObject({
        type: 'EstornoFalhou',
        payload: { pagamentoId: pgId, motivo: 'MP 500' },
      });
      expect((await f.pagamentos.findById(pgId))!.status).toBe(P.CONFIRMADO);
      await handler.handle(estornar(pgId)); // retry da Saga
      expect((await f.pagamentos.findById(pgId))!.status).toBe(P.ESTORNADO);
    });

    it('erro inesperado do gateway propaga', async () => {
      const id = await aprovar();
      const pgId = await confirmarPagamento(id);
      gateway.falharProximaChamada = new Error('bug');
      await expect(handler.handle(estornar(pgId))).rejects.toThrow('bug');
    });

    it('pagamento inexistente, de outra OS ou não confirmado → EstornoFalhou', async () => {
      await handler.handle(estornar('nao-existe'));
      expect(f.db.ultimo()).toMatchObject({
        type: 'EstornoFalhou',
        payload: { motivo: 'Pagamento não encontrado' },
      });

      const id = await aprovar();
      await handler.handle(solicitar(id));
      const pg = (await f.pagamentos.findAtivoByOrcamentoId(id))!;
      await handler.handle(estornar(pg.id));
      expect(f.db.ultimo()).toMatchObject({
        type: 'EstornoFalhou',
        payload: { motivo: expect.stringContaining('PENDENTE') },
      });

      await handler.handle(
        cmd('EstornarPagamento', { ordemServicoId: 'outra', pagamentoId: pg.id, motivo: 'x' }),
      );
      expect(f.db.ultimo().type).toBe('EstornoFalhou');
    });

    it('pagamento some entre o estorno e a gravação → EstornoFalhou', async () => {
      const id = await aprovar();
      const pgId = await confirmarPagamento(id);
      const real = f.pagamentos.findById.bind(f.pagamentos);
      jest
        .spyOn(f.pagamentos, 'findById')
        .mockImplementation(async (pid, lock) => (lock ? null : real(pid)));
      await handler.handle(estornar(pgId));
      expect(f.db.ultimo().type).toBe('EstornoFalhou');
    });
  });

  describe('mensagens inválidas', () => {
    it('versão e tipo desconhecidos são erro permanente', async () => {
      await expect(handler.handle(gerar({}, { version: 2 }))).rejects.toThrow(InvalidMessageError);
      await expect(handler.handle(cmd('Abracadabra', { ordemServicoId: 'os-1' }))).rejects.toThrow(
        /desconhecido/,
      );
    });
  });
});
