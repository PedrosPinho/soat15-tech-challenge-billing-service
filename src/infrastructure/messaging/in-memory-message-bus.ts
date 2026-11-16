import { IMessageBus, MessageHandler, Subscription } from '@domain/services/message-bus';
import { Envelope } from '@shared/messaging/envelope';

export interface SentMessage {
  kind: 'send' | 'publish';
  destination: string;
  message: Envelope;
}

/**
 * Adapter para testes/BDD. Entrega **síncrona**: `send`/`publish` aguardam os
 * handlers inscritos. Sem handler, a mensagem fica em `sent` (e em `pending`
 * da fila) até alguém se inscrever — espelha "mensagens aguardam na fila".
 * `publish` entrega às filas inscritas via `bindTopic`.
 */
export class InMemoryMessageBus implements IMessageBus {
  readonly sent: SentMessage[] = [];
  private readonly handlers = new Map<string, MessageHandler[]>();
  private readonly pending = new Map<string, Envelope[]>();
  private readonly topicBindings = new Map<string, string[]>();

  bindTopic(topic: string, queue: string): void {
    this.topicBindings.set(topic, [...(this.topicBindings.get(topic) ?? []), queue]);
  }

  async send(queue: string, message: Envelope): Promise<void> {
    this.sent.push({ kind: 'send', destination: queue, message });
    await this.deliver(queue, message);
  }

  async publish(topic: string, message: Envelope): Promise<void> {
    this.sent.push({ kind: 'publish', destination: topic, message });
    for (const queue of this.topicBindings.get(topic) ?? []) {
      await this.deliver(queue, message);
    }
  }

  async subscribe(queue: string, handler: MessageHandler): Promise<Subscription> {
    this.handlers.set(queue, [...(this.handlers.get(queue) ?? []), handler]);
    const backlog = this.pending.get(queue) ?? [];
    this.pending.delete(queue);
    for (const message of backlog) await handler(message);
    return {
      stop: async (): Promise<void> => {
        this.handlers.set(
          queue,
          (this.handlers.get(queue) ?? []).filter((h) => h !== handler),
        );
      },
    };
  }

  /** Mensagens enviadas de um tipo (atalho para asserts). */
  ofType(type: string): Envelope[] {
    return this.sent.filter((s) => s.message.type === type).map((s) => s.message);
  }

  private async deliver(queue: string, message: Envelope): Promise<void> {
    const handlers = this.handlers.get(queue) ?? [];
    if (handlers.length === 0) {
      this.pending.set(queue, [...(this.pending.get(queue) ?? []), message]);
      return;
    }
    for (const handler of handlers) await handler(message);
  }
}
