/**
 * Fronteira transacional. Tudo que o `work` fizer pelos repositórios ocorre
 * na mesma transação (o adapter Postgres propaga a conexão por
 * `AsyncLocalStorage`, então os repositórios não precisam receber o `tx`).
 * Chamadas aninhadas reaproveitam a transação externa.
 */
export interface IUnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>;
}
