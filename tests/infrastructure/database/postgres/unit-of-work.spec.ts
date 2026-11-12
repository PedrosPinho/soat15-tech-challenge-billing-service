import { PoolClient } from 'pg';
import { setPool, disconnectDatabase } from '@infrastructure/database/postgres/pool';
import { PostgresUnitOfWork, txAwarePool } from '@infrastructure/database/postgres/unit-of-work';

interface FakeClient {
  query: jest.Mock;
  release: jest.Mock;
}

const makeFakePool = () => {
  const client: FakeClient = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [{ via: 'pool' }], rowCount: 1 }),
    connect: jest.fn().mockResolvedValue(client as unknown as PoolClient),
    end: jest.fn().mockResolvedValue(undefined),
  };
  setPool(pool as never);
  return { pool, client };
};

afterEach(async () => disconnectDatabase());

const comandos = (c: FakeClient) => c.query.mock.calls.map((x) => x[0] as string);

describe('PostgresUnitOfWork / txAwarePool', () => {
  it('fora de uma transação as queries vão para o pool', async () => {
    const { pool } = makeFakePool();
    await txAwarePool().query('SELECT 1');
    expect(pool.query).toHaveBeenCalledWith('SELECT 1', undefined);
  });

  it('dentro do run as queries usam a conexão da transação: BEGIN … COMMIT', async () => {
    const { pool, client } = makeFakePool();
    await new PostgresUnitOfWork().run(async () => {
      await txAwarePool().query('INSERT x');
    });
    expect(comandos(client)).toEqual(['BEGIN', 'INSERT x', 'COMMIT']);
    expect(pool.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('erro no trabalho faz ROLLBACK, libera a conexão e propaga', async () => {
    const { client } = makeFakePool();
    await expect(
      new PostgresUnitOfWork().run(async () => {
        await txAwarePool().query('INSERT x');
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');
    expect(comandos(client)).toEqual(['BEGIN', 'INSERT x', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('run aninhado reaproveita a transação externa (um único BEGIN/COMMIT)', async () => {
    const { pool, client } = makeFakePool();
    const uow = new PostgresUnitOfWork();
    await uow.run(async () => {
      await uow.run(async () => {
        await txAwarePool().query('INSERT interno');
      });
    });
    expect(comandos(client)).toEqual(['BEGIN', 'INSERT interno', 'COMMIT']);
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });

  it('repositório que abre a própria transação (connect + BEGIN/COMMIT) participa da externa', async () => {
    const { client } = makeFakePool();
    await new PostgresUnitOfWork().run(async () => {
      const c = await txAwarePool().connect();
      await c.query('BEGIN');
      await c.query('INSERT filho');
      await c.query('COMMIT');
      c.release();
    });
    // BEGIN/COMMIT internos viram no-op; só o do UoW chega ao banco; release interno não fecha a conexão
    expect(comandos(client)).toEqual(['BEGIN', 'INSERT filho', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('ROLLBACK interno também é no-op (quem decide é o UoW)', async () => {
    const { client } = makeFakePool();
    await expect(
      new PostgresUnitOfWork().run(async () => {
        const c = await txAwarePool().connect();
        await c.query('ROLLBACK');
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(comandos(client)).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('connect() fora de transação devolve conexão do pool', async () => {
    const { pool, client } = makeFakePool();
    const c = await txAwarePool().connect();
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(c).toBe(client);
  });

  it('transações paralelas não vazam conexão uma para a outra (AsyncLocalStorage)', async () => {
    const clients = [makeClient(), makeClient()];
    let i = 0;
    const pool = {
      query: jest.fn(),
      connect: jest.fn(async () => clients[i++] as unknown as PoolClient),
      end: jest.fn(),
    };
    setPool(pool as never);
    const uow = new PostgresUnitOfWork();
    await Promise.all([
      uow.run(async () => {
        await new Promise((r) => setTimeout(r, 10));
        await txAwarePool().query('A');
      }),
      uow.run(async () => {
        await txAwarePool().query('B');
      }),
    ]);
    expect(clients[0].query.mock.calls.map((x) => x[0])).toContain('A');
    expect(clients[1].query.mock.calls.map((x) => x[0])).toContain('B');
    expect(clients[0].query.mock.calls.map((x) => x[0])).not.toContain('B');
  });
});

function makeClient(): FakeClient {
  return { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: jest.fn() };
}
