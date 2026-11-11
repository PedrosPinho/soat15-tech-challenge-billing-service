import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';

export interface RequestContext {
  correlationId: string;
}

/** Guarda o `correlationId` da requisição corrente para injeção automática nos logs. */
export const requestContext = new AsyncLocalStorage<RequestContext>();

const baseLogger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const withCorrelation = (): pino.Logger => {
  const store = requestContext.getStore();
  return store ? baseLogger.child({ correlationId: store.correlationId }) : baseLogger;
};

/**
 * Logger estruturado em JSON. Cada chamada busca o `correlationId` corrente em
 * `requestContext` (populado por `correlation-id.middleware.ts`) e injeta no log,
 * sem precisar passá-lo explicitamente em cada call site.
 */
export const logger = {
  info: (...args: Parameters<pino.Logger['info']>): void => withCorrelation().info(...args),
  warn: (...args: Parameters<pino.Logger['warn']>): void => withCorrelation().warn(...args),
  error: (...args: Parameters<pino.Logger['error']>): void => withCorrelation().error(...args),
  debug: (...args: Parameters<pino.Logger['debug']>): void => withCorrelation().debug(...args),
};
