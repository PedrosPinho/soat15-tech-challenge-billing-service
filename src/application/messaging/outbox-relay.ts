import { IOutboxRepository } from '@domain/repositories/outbox.repository';
import { IMessageBus } from '@domain/services/message-bus';
import { IUnitOfWork } from '@domain/services/unit-of-work';
import { logger } from '@shared/logger';
import { PeriodicTask } from './periodic-task';

export interface OutboxRelayOptions {
  batchSize?: number;
  intervalMs?: number;
  /** Teto do backoff exponencial entre tentativas de uma mesma mensagem. */
  maxBackoffMs?: number;
}

/**
 * Publica as mensagens do outbox. Cada `tick` é uma transação: trava um lote
 * com `FOR UPDATE SKIP LOCKED` (2+ réplicas não publicam a mesma linha),
 * publica e marca como enviada. Se publicar falhar, agenda nova tentativa com
 * backoff e segue para a próxima — o `messageId` não muda entre tentativas,
 * então o consumidor (inbox) deduplica um reenvio.
 */
export class OutboxRelay {
  private readonly batchSize: number;
  private readonly maxBackoffMs: number;
  private readonly task: PeriodicTask;

  constructor(
    private readonly uow: IUnitOfWork,
    private readonly outbox: IOutboxRepository,
    private readonly bus: IMessageBus,
    options: OutboxRelayOptions = {},
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.batchSize = options.batchSize ?? 20;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
    this.task = new PeriodicTask('outbox-relay', options.intervalMs ?? 1000, () => this.tick());
  }

  start(): void {
    this.task.start();
  }

  stop(): Promise<void> {
    return this.task.stop();
  }

  /** Processa um lote; devolve quantas mensagens foram publicadas. */
  async tick(): Promise<number> {
    return this.uow.run(async () => {
      const batch = await this.outbox.claimBatch(this.batchSize);
      let publicadas = 0;
      for (const entry of batch) {
        try {
          if (entry.kind === 'queue') await this.bus.send(entry.destination, entry.envelope);
          else await this.bus.publish(entry.destination, entry.envelope);
          await this.outbox.markPublished(entry.id);
          publicadas++;
        } catch (error) {
          const backoff = Math.min(2 ** entry.tentativas * 1000, this.maxBackoffMs);
          const message = error instanceof Error ? error.message : String(error);
          logger.warn(
            { error: message, outboxId: entry.id, type: entry.envelope.type },
            'Falha ao publicar mensagem do outbox: nova tentativa agendada',
          );
          await this.outbox.markFailed(
            entry.id,
            message,
            new Date(this.clock().getTime() + backoff),
          );
        }
      }
      return publicadas;
    });
  }
}
