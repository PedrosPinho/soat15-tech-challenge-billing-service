import { Pool, PoolConfig } from 'pg';
import { logger } from '@shared/logger';

let pool: Pool | undefined;

export interface ConnectOptions {
  retries?: number;
  retryDelayMs?: number;
}

/**
 * Cria (ou retorna, se já existir) o pool de conexões com o PostgreSQL,
 * verificando a conectividade com um `connect`/`release` de teste e
 * aplicando retry com backoff fixo — espelha o comportamento esperado do
 * `connection.ts` do Mongo, mas adaptado ao modelo de pool do driver `pg`
 * (não há um único "connect" global, e sim um pool reaproveitado por toda
 * a aplicação).
 */
export const connectDatabase = async (options: ConnectOptions = {}): Promise<Pool> => {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URI;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not defined');
  }

  const config: PoolConfig = {
    connectionString,
    max: 10,
    min: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  const candidate = new Pool(config);

  candidate.on('error', (error) => {
    logger.error({ error }, 'PostgreSQL pool error');
  });

  const retries = options.retries ?? 5;
  const retryDelayMs = options.retryDelayMs ?? 2000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await candidate.connect();
      client.release();
      pool = candidate;
      return pool;
    } catch (error) {
      lastError = error;
      logger.warn(
        { attempt, retries, retryDelayMs },
        'PostgreSQL connection attempt failed, retrying',
      );
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  await candidate.end().catch(() => undefined);
  throw lastError instanceof Error ? lastError : new Error('Failed to connect to PostgreSQL');
};

/** Retorna o pool ativo. Lança se `connectDatabase` ainda não foi chamado. */
export const getPool = (): Pool => {
  if (!pool) {
    throw new Error('PostgreSQL pool não inicializado. Chame connectDatabase() antes.');
  }
  return pool;
};

/** Permite injetar um pool já existente (usado pelos testes com Testcontainers). */
export const setPool = (newPool: Pool): void => {
  pool = newPool;
};

export const disconnectDatabase = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
};
