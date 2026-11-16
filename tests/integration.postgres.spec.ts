/**
 * Integração com PostgreSQL real: migrations + repositórios + transação. Roda só com
 * `TEST_DATABASE_URL` (CI sobe um service container `postgres`; local:
 * `docker compose up -d postgres` + `TEST_DATABASE_URL=postgres://oficina:senha123@localhost:5433/oficina_billing`).
 * Cria e derruba um schema próprio, sem tocar nos dados do banco.
 */
import { execSync } from 'node:child_process';
import { Pool } from 'pg';
import { BillingCommandHandler } from '@application/messaging/billing-command-handler';
import { PagamentoUseCases } from '@application/use-cases/pagamento.use-cases';
import { PagamentoStatus } from '@domain/entities/pagamento.entity';
import { disconnectDatabase, setPool } from '@infrastructure/database/postgres/pool';
import { PostgresInboxRepository } from '@infrastructure/database/postgres/repositories/inbox.repository.impl';
import { PostgresOrcamentoRepository } from '@infrastructure/database/postgres/repositories/orcamento.repository.impl';
import { PostgresOutboxRepository } from '@infrastructure/database/postgres/repositories/outbox.repository.impl';
import { PostgresPagamentoRepository } from '@infrastructure/database/postgres/repositories/pagamento.repository.impl';
import { PostgresUnitOfWork } from '@infrastructure/database/postgres/unit-of-work';
import { FakePaymentGateway } from '@infrastructure/payments/fake-payment-gateway';
import { createEnvelope } from '@shared/messaging/envelope';

const url = process.env.TEST_DATABASE_URL;
const describePg = url ? describe : describe.skip;

describePg('Billing × PostgreSQL', () => {
  const schema = `billing_it_${Date.now()}`;
  let pool: Pool;
  const uow = new PostgresUnitOfWork();
  const orcamentos = new PostgresOrcamentoRepository();
  const pagamentos = new PostgresPagamentoRepository();
  const outbox = new PostgresOutboxRepository();
  const inbox = new PostgresInboxRepository();
  const gateway = new FakePaymentGateway();
  const handler = new BillingCommandHandler({
    uow,
    orcamentos,
    pagamentos,
    outbox,
    inbox,
    gateway,
    notifications: { enviarOrcamentoDisponivel: async () => undefined },
  });

  const cmd = (type: string, payload: object, messageId?: string) =>
    createEnvelope({ type, sagaId: 'saga-it', correlationId: 'corr-it', payload, messageId });
  const tipos = async (): Promise<string[]> =>
    (await pool.query('SELECT tipo_mensagem FROM outbox ORDER BY criado_em, id')).rows.map(
      (r) => r.tipo_mensagem,
    );

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const withSchema = `${url}${url!.includes('?') ? '&' : '?'}options=-c%20search_path%3D${schema}`;
    execSync(
      `npx node-pg-migrate up -m src/infrastructure/database/postgres/migrations --schema ${schema}`,
      {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      },
    );
    pool = new Pool({ connectionString: withSchema });
    setPool(pool);
  }, 120_000);

  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
    await disconnectDatabase();
  });

  const gerar = (osId: string, messageId?: string) =>
    cmd(
      'GerarOrcamento',
      {
        ordemServicoId: osId,
        numeroOS: osId,
        cliente: { id: 'c1', nome: 'Maria', cpfCnpj: '1' },
        itens: [
          {
            tipo: 'SERVICO',
            referenciaId: 's1',
            descricao: 'Revisão',
            quantidade: 2,
            valorUnitario: 125.25,
          },
        ],
        valorTotal: 250.5,
        validadeAte: '2030-01-01T00:00:00Z',
      },
      messageId,
    );

  it('GerarOrcamento grava orçamento, itens e outbox; reentrega não duplica', async () => {
    const msg = gerar('os-pg-1');
    await handler.handle(msg);
    await handler.handle(msg);
    const o = (await orcamentos.findByOrdemServicoId('os-pg-1'))!;
    expect(o.valorTotal).toBe(250.5);
    expect(o.itens).toHaveLength(1);
    expect((await tipos()).filter((t) => t === 'OrcamentoGerado')).toHaveLength(1);
  });

  it('erro no meio da transação faz rollback de tudo (orçamento, inbox e outbox)', async () => {
    jest.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('falha'));
    await expect(handler.handle(gerar('os-pg-2'))).rejects.toThrow('falha');
    expect(await orcamentos.findByOrdemServicoId('os-pg-2')).toBeNull();
  });

  it('índice parcial impede dois pagamentos vivos para o mesmo orçamento', async () => {
    await handler.handle(gerar('os-pg-3'));
    const o = (await orcamentos.findByOrdemServicoId('os-pg-3'))!;
    o.aprovar();
    await orcamentos.update(o);
    await handler.handle(
      cmd('SolicitarPagamento', { ordemServicoId: 'os-pg-3', orcamentoId: o.id }),
    );
    const ativo = (await pagamentos.findAtivoByOrcamentoId(o.id))!;
    const duplicado = { ...ativo.toProps(), id: '00000000-0000-4000-8000-000000000001' };
    const { Pagamento } = await import('@domain/entities/pagamento.entity');
    await expect(pagamentos.insert(Pagamento.restaurar(duplicado))).rejects.toThrow(
      /pagamentos_ativo_por_orcamento_idx/,
    );
  });

  it('webhooks concorrentes confirmam uma única vez (FOR UPDATE) e o resumo soma a receita', async () => {
    await handler.handle(gerar('os-pg-4'));
    const o = (await orcamentos.findByOrdemServicoId('os-pg-4'))!;
    o.aprovar();
    await orcamentos.update(o);
    await handler.handle(
      cmd('SolicitarPagamento', { ordemServicoId: 'os-pg-4', orcamentoId: o.id }),
    );
    gateway.simularPagamento('mp-pg-4', 'approved', o.id, 250.5);

    const uc = new PagamentoUseCases({ uow, pagamentos, outbox, gateway });
    const r = await Promise.all([
      uc.processarNotificacaoMercadoPago('mp-pg-4'),
      uc.processarNotificacaoMercadoPago('mp-pg-4'),
    ]);
    expect(r.filter((x) => x === 'confirmado')).toHaveLength(1);
    expect((await tipos()).filter((t) => t === 'PagamentoConfirmado')).toHaveLength(1);
    expect((await pagamentos.findAtivoByOrcamentoId(o.id))!.status).toBe(
      PagamentoStatus.CONFIRMADO,
    );
    expect((await pagamentos.resumo()).receitaTotal).toBeGreaterThanOrEqual(250.5);
  });

  it('dois relays concorrentes nunca reivindicam a mesma mensagem (SKIP LOCKED)', async () => {
    const a = await uow.run(async () => {
      const lote = await outbox.claimBatch(100);
      const outro = new Pool({ connectionString: pool.options.connectionString });
      const c = await outro.connect();
      try {
        await c.query('BEGIN');
        const { rows } = await c.query(
          'SELECT id FROM outbox WHERE publicado_em IS NULL FOR UPDATE SKIP LOCKED',
        );
        await c.query('ROLLBACK');
        return { lote: lote.map((l) => l.id), rivais: rows.map((r) => r.id as string) };
      } finally {
        c.release();
        await outro.end();
      }
    });
    expect(a.lote.length).toBeGreaterThan(0);
    expect(a.rivais.filter((id) => a.lote.includes(id))).toEqual([]);
  });
});
