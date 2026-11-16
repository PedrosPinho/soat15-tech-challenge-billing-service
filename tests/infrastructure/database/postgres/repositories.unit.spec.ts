import { Orcamento, OrcamentoStatus as O } from '@domain/entities/orcamento.entity';
import { Pagamento, PagamentoStatus as P } from '@domain/entities/pagamento.entity';
import { PostgresInboxRepository } from '@infrastructure/database/postgres/repositories/inbox.repository.impl';
import { PostgresOrcamentoRepository } from '@infrastructure/database/postgres/repositories/orcamento.repository.impl';
import { PostgresOutboxRepository } from '@infrastructure/database/postgres/repositories/outbox.repository.impl';
import { PostgresPagamentoRepository } from '@infrastructure/database/postgres/repositories/pagamento.repository.impl';
import { createEnvelope } from '@shared/messaging/envelope';

/** Contrato SQL/mapeamento com pool simulado (os testes contra Postgres real: integration.postgres.spec.ts). */
const poolWith = (...results: object[]): { query: jest.Mock; pool: never } => {
  const query = jest.fn();
  results.forEach((r) => query.mockResolvedValueOnce(r));
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  return { query, pool: { query } as never };
};

const orcRow = {
  id: 'o1',
  ordem_servico_id: 'os1',
  numero_os: 'OS-1',
  saga_id: 'sg',
  cliente_id: 'c1',
  cliente_nome: 'Maria',
  cliente_email: null,
  cliente_cpf_cnpj: '123',
  valor_total: '310.50',
  validade_ate: new Date('2026-11-20'),
  status: 'APROVADO',
  motivo: null,
  aprovado_em: new Date('2026-11-12'),
  criado_em: new Date('2026-11-11'),
  atualizado_em: new Date('2026-11-12'),
};
const pgRow = {
  id: 'p1',
  orcamento_id: 'o1',
  ordem_servico_id: 'os1',
  saga_id: 'sg',
  valor: '310.50',
  status: 'CONFIRMADO',
  mp_preference_id: 'pref',
  init_point: 'http://mp',
  expira_em: new Date('2026-11-13'),
  mp_payment_id: 'mp1',
  mp_refund_id: null,
  motivo: null,
  confirmado_em: new Date('2026-11-12'),
  criado_em: new Date('2026-11-11'),
  atualizado_em: new Date('2026-11-12'),
};

describe('PostgresOrcamentoRepository', () => {
  const orc = Orcamento.criar({
    ordemServicoId: 'os1',
    numeroOS: 'OS-1',
    sagaId: 'sg',
    cliente: { id: 'c1', nome: 'Maria', email: 'm@x.com', cpfCnpj: '123' },
    itens: [
      { tipo: 'SERVICO', referenciaId: 's1', descricao: 'a', quantidade: 1, valorUnitario: 10 },
      { tipo: 'PECA', referenciaId: 'p1', descricao: 'b', quantidade: 2, valorUnitario: 5 },
    ],
    valorTotal: 20,
    validadeAte: '2026-11-20T00:00:00Z',
  });

  it('insert grava o orçamento e cada item', async () => {
    const { query, pool } = poolWith();
    await new PostgresOrcamentoRepository(pool).insert(orc);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][0]).toContain('INSERT INTO orcamentos');
    expect(query.mock.calls[0][1].slice(0, 3)).toEqual([orc.id, 'os1', 'OS-1']);
    expect(query.mock.calls[1][0]).toContain('INSERT INTO orcamento_itens');
    expect(query.mock.calls[2][1]).toEqual([orc.id, 'PECA', 'p1', 'b', 2, 5]);
  });

  it('insert sem e-mail grava NULL', async () => {
    const { query, pool } = poolWith();
    const sem = Orcamento.restaurar({
      ...orc.toProps(),
      cliente: { id: 'c', nome: 'n', cpfCnpj: '1' },
    });
    await new PostgresOrcamentoRepository(pool).insert(sem);
    expect(query.mock.calls[0][1][6]).toBeNull();
  });

  it('update persiste só o que muda', async () => {
    const { query, pool } = poolWith();
    orc.cancelar('saga');
    await new PostgresOrcamentoRepository(pool).update(orc);
    expect(query.mock.calls[0][0]).toContain('UPDATE orcamentos SET status');
    expect(query.mock.calls[0][1][1]).toBe(O.CANCELADO);
  });

  it('findById mapeia linha + itens (numeric vem como string) e FOR UPDATE só quando pedido', async () => {
    const itens = [
      {
        tipo: 'PECA',
        referencia_id: 'p1',
        descricao: 'b',
        quantidade: 2,
        valor_unitario: '155.25',
      },
    ];
    const a = poolWith({ rows: [orcRow] }, { rows: itens });
    const o = (await new PostgresOrcamentoRepository(a.pool).findById('o1'))!;
    expect(a.query.mock.calls[0][0]).not.toContain('FOR UPDATE');
    expect(o).toMatchObject({ id: 'o1', valorTotal: 310.5, status: O.APROVADO });
    expect(o.cliente).toEqual({ id: 'c1', nome: 'Maria', email: undefined, cpfCnpj: '123' });
    expect(o.itens[0]).toEqual({
      tipo: 'PECA',
      referenciaId: 'p1',
      descricao: 'b',
      quantidade: 2,
      valorUnitario: 155.25,
    });

    const b = poolWith({ rows: [orcRow] }, { rows: [] });
    await new PostgresOrcamentoRepository(b.pool).findByOrdemServicoId('os1', true);
    expect(b.query.mock.calls[0][0]).toContain('ordem_servico_id = $1 FOR UPDATE');
  });

  it('inexistente → null (sem consultar itens)', async () => {
    const { query, pool } = poolWith({ rows: [] });
    expect(await new PostgresOrcamentoRepository(pool).findById('x')).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('PostgresPagamentoRepository', () => {
  const pg = Pagamento.criar({
    orcamentoId: 'o1',
    ordemServicoId: 'os1',
    sagaId: 'sg',
    valor: 310.5,
    mpPreferenceId: 'pref',
    initPoint: 'http://mp',
    expiraEm: new Date('2026-11-13'),
  });

  it('insert e update', async () => {
    const { query, pool } = poolWith();
    const repo = new PostgresPagamentoRepository(pool);
    await repo.insert(pg);
    expect(query.mock.calls[0][0]).toContain('INSERT INTO pagamentos');
    pg.confirmar('mp1');
    await repo.update(pg);
    expect(query.mock.calls[1][0]).toContain('UPDATE pagamentos SET status');
    expect(query.mock.calls[1][1].slice(0, 3)).toEqual([pg.id, P.CONFIRMADO, 'mp1']);
  });

  it('consultas usam as cláusulas certas e mapeiam a linha', async () => {
    const quando = [
      (r: PostgresPagamentoRepository) => r.findById('p1', true),
      (r: PostgresPagamentoRepository) => r.findByMpPaymentId('mp1'),
      (r: PostgresPagamentoRepository) => r.findAtivoByOrcamentoId('o1'),
      (r: PostgresPagamentoRepository) => r.findUltimoByOrcamentoId('o1', true),
    ];
    const trechos = [
      'WHERE id = $1 FOR UPDATE',
      'mp_payment_id = $1',
      "status IN ('PENDENTE','CONFIRMADO')",
      'ORDER BY criado_em DESC LIMIT 1 FOR UPDATE',
    ];
    for (const [i, consulta] of quando.entries()) {
      const { query, pool } = poolWith({ rows: [pgRow] });
      const r = (await consulta(new PostgresPagamentoRepository(pool)))!;
      expect(query.mock.calls[0][0]).toContain(trechos[i]);
      expect(r).toMatchObject({ id: 'p1', valor: 310.5, mpPaymentId: 'mp1', status: P.CONFIRMADO });
      expect(r.mpRefundId).toBeUndefined();
    }
    expect(
      await new PostgresPagamentoRepository(poolWith({ rows: [] }).pool).findById('x'),
    ).toBeNull();
  });

  it('listarPorOrdemServico', async () => {
    const { pool } = poolWith({ rows: [pgRow, pgRow] });
    expect(await new PostgresPagamentoRepository(pool).listarPorOrdemServico('os1')).toHaveLength(
      2,
    );
  });

  it('resumo converte os agregados', async () => {
    const { pool } = poolWith({
      rows: [{ confirmados: '2', receita: '620.50', estornados: '1', estornado: '90.00' }],
    });
    expect(await new PostgresPagamentoRepository(pool).resumo()).toEqual({
      receitaTotal: 620.5,
      totalEstornado: 90,
      pagamentosConfirmados: 2,
      pagamentosEstornados: 1,
    });
  });
});

describe('outbox / inbox', () => {
  it('enqueue grava o envelope serializado', async () => {
    const { query, pool } = poolWith();
    const env = createEnvelope({
      type: 'OrcamentoGerado',
      sagaId: 's',
      correlationId: 'c',
      payload: {},
    });
    await new PostgresOutboxRepository(pool).enqueue({
      kind: 'topic',
      destination: 'oficina-eventos',
      envelope: env,
    });
    expect(query.mock.calls[0][0]).toContain('INSERT INTO outbox');
    expect(query.mock.calls[0][1].slice(1)).toEqual([
      'topic',
      'oficina-eventos',
      'OrcamentoGerado',
      JSON.stringify(env),
    ]);
  });

  it('claimBatch usa FOR UPDATE SKIP LOCKED; markPublished/markFailed', async () => {
    const env = createEnvelope({ type: 'X', sagaId: 's', correlationId: 'c', payload: {} });
    const { query, pool } = poolWith({
      rows: [{ id: '1', tipo_destino: 'topic', destino: 't', envelope: env, tentativas: 2 }],
    });
    const repo = new PostgresOutboxRepository(pool);
    expect(await repo.claimBatch(5)).toEqual([
      { id: '1', kind: 'topic', destination: 't', envelope: env, tentativas: 2 },
    ]);
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    await repo.markPublished('1');
    await repo.markFailed('1', 'x'.repeat(2000), new Date('2026-01-01'));
    expect(query.mock.calls[1][0]).toContain('publicado_em = now()');
    expect(query.mock.calls[2][1][1]).toHaveLength(1000);
  });

  it('inbox: true na primeira vez, false se já existia', async () => {
    const repo = (n: number): PostgresInboxRepository =>
      new PostgresInboxRepository(poolWith({ rowCount: n }).pool);
    expect(await repo(1).markProcessed('m', 'T')).toBe(true);
    expect(await repo(0).markProcessed('m', 'T')).toBe(false);
    expect(await new PostgresInboxRepository(poolWith({}).pool).markProcessed('m', 'T')).toBe(
      false,
    );
  });
});
