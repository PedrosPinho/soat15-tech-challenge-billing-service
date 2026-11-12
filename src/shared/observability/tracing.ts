/**
 * Fachada fina sobre o agente New Relic (carregado primeiro em `src/index.ts`). Sem licença o
 * agente fica desabilitado e todas as chamadas viram no-op; em testes `newrelic` é um mock
 * (`tests/__mocks__/newrelic.js`). Nenhuma função aqui lança: observabilidade nunca derruba o fluxo.
 *
 * Distributed tracing através de SQS/SNS (Etapa 7): quem ENFILEIRA a mensagem captura os headers
 * W3C/NR da transação corrente (`capturarTrace`) e os grava no envelope (`trace`); quem CONSOME
 * abre uma transação em background e aceita esses headers (`emTransacaoDeConsumo`) — o trace
 * de uma OS atravessa OS → Billing/Execution → OS.
 */
export type TraceHeaders = Record<string, string>;
export type AtributoValor = string | number | boolean;

interface TransactionHandle {
  insertDistributedTraceHeaders(headers: TraceHeaders): void;
  acceptDistributedTraceHeaders(transport: string, headers: TraceHeaders): void;
}
interface Agent {
  getTransaction?(): TransactionHandle | undefined;
  startBackgroundTransaction?<T>(name: string, group: string, handle: () => T): T;
  addCustomAttributes?(attrs: Record<string, AtributoValor>): void;
  recordCustomEvent?(name: string, attrs: Record<string, AtributoValor>): void;
  noticeError?(error: Error, attrs?: Record<string, AtributoValor>): void;
}

const agente = (): Agent | undefined => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('newrelic') as Agent;
  } catch {
    return undefined;
  }
};

/** Headers de trace da transação corrente (vazio/undefined fora de uma transação ou sem agente). */
export const capturarTrace = (): TraceHeaders | undefined => {
  try {
    const headers: TraceHeaders = {};
    agente()?.getTransaction?.()?.insertDistributedTraceHeaders(headers);
    return Object.keys(headers).length > 0 ? headers : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Executa `fn` numa transação em background (categoria "Queue") ligada ao trace do produtor.
 * Erros de `fn` são reportados ao New Relic e relançados (a mensagem volta à fila).
 */
export const emTransacaoDeConsumo = <T>(
  nome: string,
  trace: TraceHeaders | undefined,
  fn: () => Promise<T>,
): Promise<T> => {
  const a = agente();
  if (!a?.startBackgroundTransaction) return fn();
  return a.startBackgroundTransaction(nome, 'Queue', async () => {
    try {
      if (trace) a.getTransaction?.()?.acceptDistributedTraceHeaders('Queue', trace);
    } catch {
      /* trace corrompido: segue sem ligar ao produtor */
    }
    try {
      return await fn();
    } catch (error) {
      registrarErro(error);
      throw error;
    }
  });
};

export const adicionarAtributos = (attrs: Record<string, AtributoValor | undefined>): void => {
  try {
    const limpos = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
    agente()?.addCustomAttributes?.(limpos as Record<string, AtributoValor>);
  } catch {
    /* no-op */
  }
};

export const registrarEvento = (nome: string, attrs: Record<string, AtributoValor>): void => {
  try {
    agente()?.recordCustomEvent?.(nome, attrs);
  } catch {
    /* no-op */
  }
};

export const registrarErro = (error: unknown): void => {
  try {
    agente()?.noticeError?.(error instanceof Error ? error : new Error(String(error)));
  } catch {
    /* no-op */
  }
};
