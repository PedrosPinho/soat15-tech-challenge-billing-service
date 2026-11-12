import { Envelope } from '@shared/messaging/envelope';

/**
 * Handler de mensagem. Se resolver, a mensagem é confirmada (removida da
 * fila); se lançar, volta à fila para nova tentativa (e, após
 * `maxReceiveCount`, vai para a DLQ).
 */
export type MessageHandler = (message: Envelope) => Promise<void>;

export interface Subscription {
  stop(): Promise<void>;
}

/**
 * Port de mensageria. `send` = comando ponto a ponto (SQS); `publish` = evento
 * em fan-out (SNS); `subscribe` = consumo contínuo de uma fila.
 * `queue`/`topic` são nomes lógicos — o adapter resolve URL/ARN.
 */
export interface IMessageBus {
  send(queue: string, message: Envelope): Promise<void>;
  publish(topic: string, message: Envelope): Promise<void>;
  subscribe(queue: string, handler: MessageHandler): Promise<Subscription>;
}
