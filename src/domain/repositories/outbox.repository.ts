import { Envelope } from '@shared/messaging/envelope';

export interface OutboxEntry {
  id: string;
  kind: 'queue' | 'topic';
  destination: string;
  envelope: Envelope;
  tentativas: number;
}

export type NewOutboxEntry = Pick<OutboxEntry, 'kind' | 'destination' | 'envelope'>;

/**
 * Transactional outbox: `enqueue` participa da transação corrente (mesma
 * transação da mudança de estado). O relay usa `claimBatch` (FOR UPDATE SKIP
 * LOCKED) dentro de uma transação própria.
 */
export interface IOutboxRepository {
  enqueue(entry: NewOutboxEntry): Promise<void>;
  /** Trava e devolve até `limit` mensagens vencidas e não publicadas. */
  claimBatch(limit: number): Promise<OutboxEntry[]>;
  markPublished(id: string): Promise<void>;
  /** Registra a falha e agenda a próxima tentativa (backoff). */
  markFailed(id: string, error: string, retryAt: Date): Promise<void>;
}
