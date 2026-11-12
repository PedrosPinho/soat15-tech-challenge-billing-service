import { Pool } from 'pg';
import { IInboxRepository } from '@domain/repositories/inbox.repository';
import { txAwarePool } from '../unit-of-work';

export class PostgresInboxRepository implements IInboxRepository {
  constructor(private readonly pool: Pool = txAwarePool()) {}

  async markProcessed(messageId: string, type: string): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO mensagens_processadas (message_id, tipo) VALUES ($1,$2)
       ON CONFLICT (message_id) DO NOTHING`,
      [messageId, type],
    );
    return (result.rowCount ?? 0) === 1;
  }
}
