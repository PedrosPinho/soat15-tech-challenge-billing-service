import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { IUnitOfWork } from '@domain/services/unit-of-work';
import { getPool } from './pool';

/** Conexão da transação corrente (propagada por `AsyncLocalStorage`). */
const txStorage = new AsyncLocalStorage<PoolClient>();

const CONTROLE_TX = /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/i;

/**
 * Faz o papel de `Pool` para os repositórios: dentro de `PostgresUnitOfWork.run`
 * todas as queries vão para a conexão da transação; fora dela, para o pool.
 * Assim os repositórios não precisam receber o `tx` e seguem usando
 * `this.pool.query(...)`.
 */
class TxAwarePool {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>> {
    return (txStorage.getStore() ?? getPool()).query<R>(text, params);
  }

  async connect(): Promise<PoolClient> {
    const tx = txStorage.getStore();
    if (!tx) return getPool().connect();
    return new Proxy(tx, {
      get(target, prop): unknown {
        if (prop === 'release') return () => undefined;
        if (prop === 'query') {
          return (text: unknown, params?: unknown[]) =>
            typeof text === 'string' && CONTROLE_TX.test(text)
              ? Promise.resolve({ rows: [], rowCount: 0 })
              : (target.query as (...a: unknown[]) => unknown)(text, params);
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
}

export const txAwarePool = (): Pool => new TxAwarePool() as unknown as Pool;

export class PostgresUnitOfWork implements IUnitOfWork {
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (txStorage.getStore()) return work();

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await txStorage.run(client, work);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
