import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { adicionarAtributos } from './observability/tracing';

export interface RequestContext {
  correlationId: string;
  /** Preenchidos quando o fluxo pertence a uma Saga/OS (consumidor de mensagem, orquestrador). */
  sagaId?: string;
  ordemServicoId?: string;
}

/** Guarda o `correlationId` da requisição corrente para injeção automática nos logs. */
export const requestContext = new AsyncLocalStorage<RequestContext>();

const baseLogger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const withCorrelation = (): pino.Logger => {
  const store = requestContext.getStore();
  if (!store) return baseLogger;
  const { correlationId, sagaId, ordemServicoId } = store;
  return baseLogger.child({
    correlationId,
    ...(sagaId ? { sagaId } : {}),
    ...(ordemServicoId ? { ordemServicoId } : {}),
  });
};

/**
 * Acrescenta `sagaId`/`ordemServicoId` ao contexto corrente (e, portanto, a todo log seguinte) e à
 * transação do APM — assim "tudo da OS X" é uma busca no New Relic Logs/Transactions.
 */
export const vincularSaga = (
  sagaId: string | undefined,
  ordemServicoId: string | undefined,
): void => {
  const store = requestContext.getStore();
  if (store) {
    if (sagaId) store.sagaId = sagaId;
    if (ordemServicoId) store.ordemServicoId = ordemServicoId;
  }
  adicionarAtributos({ sagaId, ordemServicoId });
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
