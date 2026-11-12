import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { Envelope } from '@shared/messaging/envelope';
import {
  IOutboxRepository,
  NewOutboxEntry,
  OutboxEntry,
} from '@domain/repositories/outbox.repository';
import { txAwarePool } from '../unit-of-work';

interface OutboxRow {
  id: string;
  tipo_destino: 'queue' | 'topic';
  destino: string;
  envelope: Envelope;
  tentativas: number;
}

export class PostgresOutboxRepository implements IOutboxRepository {
  constructor(private readonly pool: Pool = txAwarePool()) {}

  async enqueue(entry: NewOutboxEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO outbox (id, tipo_destino, destino, tipo_mensagem, envelope)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        randomUUID(),
        entry.kind,
        entry.destination,
        entry.envelope.type,
        JSON.stringify(entry.envelope),
      ],
    );
  }

  /**
   * `FOR UPDATE SKIP LOCKED`: dois relays (réplicas) nunca pegam a mesma linha.
   * Deve ser chamado dentro de `PostgresUnitOfWork.run` — o lock vale até o commit.
   */
  async claimBatch(limit: number): Promise<OutboxEntry[]> {
    const { rows } = await this.pool.query<OutboxRow>(
      `SELECT id, tipo_destino, destino, envelope, tentativas FROM outbox
        WHERE publicado_em IS NULL AND proxima_tentativa_em <= now()
        ORDER BY criado_em
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.tipo_destino,
      destination: r.destino,
      envelope: r.envelope,
      tentativas: r.tentativas,
    }));
  }

  async markPublished(id: string): Promise<void> {
    await this.pool.query('UPDATE outbox SET publicado_em = now() WHERE id = $1', [id]);
  }

  async markFailed(id: string, error: string, retryAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE outbox SET tentativas = tentativas + 1, ultimo_erro = $2, proxima_tentativa_em = $3
        WHERE id = $1`,
      [id, error.slice(0, 1000), retryAt],
    );
  }
}
