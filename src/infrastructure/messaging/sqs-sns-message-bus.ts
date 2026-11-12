import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { IMessageBus, MessageHandler, Subscription } from '@domain/services/message-bus';
import { Envelope, parseEnvelopeFromJson } from '@shared/messaging/envelope';
import { logger } from '@shared/logger';

export interface SqsSnsMessageBusConfig {
  sqs: SQSClient;
  sns: SNSClient;
  /** nome lógico -> URL da fila */
  queues: Record<string, string>;
  /** nome lógico -> ARN do tópico */
  topics: Record<string, string>;
  waitTimeSeconds?: number;
  maxMessages?: number;
  /** Espera após erro inesperado de polling (evita loop quente). */
  pollErrorBackoffMs?: number;
}

const attributesOf = (
  message: Envelope,
): Record<string, { DataType: string; StringValue: string }> => ({
  type: { DataType: 'String', StringValue: message.type },
  sagaId: { DataType: 'String', StringValue: message.sagaId },
  correlationId: { DataType: 'String', StringValue: message.correlationId },
});

/**
 * Adapter SQS/SNS. Long polling; a mensagem só é apagada **depois** que o
 * handler conclui (commit). Falha => `ChangeMessageVisibility` com backoff
 * crescente pelo `ApproximateReceiveCount`; após `maxReceiveCount` a própria
 * fila move para a DLQ. Envelope inválido é erro permanente: visibilidade 0
 * para acelerar o caminho até a DLQ (nunca descarta em silêncio).
 */
export class SqsSnsMessageBus implements IMessageBus {
  private readonly waitTimeSeconds: number;
  private readonly maxMessages: number;
  private readonly pollErrorBackoffMs: number;

  constructor(private readonly config: SqsSnsMessageBusConfig) {
    this.waitTimeSeconds = config.waitTimeSeconds ?? 20;
    this.maxMessages = config.maxMessages ?? 10;
    this.pollErrorBackoffMs = config.pollErrorBackoffMs ?? 5000;
  }

  async send(queue: string, message: Envelope): Promise<void> {
    await this.config.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl(queue),
        MessageBody: JSON.stringify(message),
        MessageAttributes: attributesOf(message),
      }),
    );
  }

  async publish(topic: string, message: Envelope): Promise<void> {
    const arn = this.config.topics[topic];
    if (!arn) throw new Error(`Tópico SNS "${topic}" não configurado`);
    await this.config.sns.send(
      new PublishCommand({
        TopicArn: arn,
        Message: JSON.stringify(message),
        MessageAttributes: attributesOf(message),
      }),
    );
  }

  async subscribe(queue: string, handler: MessageHandler): Promise<Subscription> {
    const queueUrl = this.queueUrl(queue);
    let running = true;
    const loop = (async (): Promise<void> => {
      while (running) {
        try {
          const { Messages } = await this.config.sqs.send(
            new ReceiveMessageCommand({
              QueueUrl: queueUrl,
              MaxNumberOfMessages: this.maxMessages,
              WaitTimeSeconds: this.waitTimeSeconds,
              MessageSystemAttributeNames: ['ApproximateReceiveCount'],
              MessageAttributeNames: ['All'],
            }),
          );
          for (const raw of Messages ?? []) {
            if (!running) break;
            await this.process(queue, queueUrl, raw, handler);
          }
        } catch (error) {
          logger.error({ error, queue }, 'Falha no polling da fila');
          await new Promise((resolve) => setTimeout(resolve, this.pollErrorBackoffMs));
        }
      }
    })();
    return {
      stop: async (): Promise<void> => {
        running = false;
        await loop;
      },
    };
  }

  private async process(
    queue: string,
    queueUrl: string,
    raw: Message,
    handler: MessageHandler,
  ): Promise<void> {
    let envelope: Envelope;
    try {
      envelope = parseEnvelopeFromJson(raw.Body ?? '');
    } catch (error) {
      logger.error(
        { error, queue, sqsMessageId: raw.MessageId },
        'Mensagem inválida: encaminhando para a DLQ',
      );
      await this.changeVisibility(queueUrl, raw, 0);
      return;
    }

    try {
      await handler(envelope);
    } catch (error) {
      const receiveCount = Number(raw.Attributes?.ApproximateReceiveCount ?? '1');
      const backoff = Math.min(2 ** receiveCount * 5, 300);
      logger.warn(
        { error, queue, messageId: envelope.messageId, type: envelope.type, receiveCount },
        'Falha ao processar mensagem: será reentregue',
      );
      await this.changeVisibility(queueUrl, raw, backoff);
      return;
    }

    await this.config.sqs.send(
      new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: raw.ReceiptHandle }),
    );
  }

  private async changeVisibility(queueUrl: string, raw: Message, seconds: number): Promise<void> {
    await this.config.sqs
      .send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: raw.ReceiptHandle,
          VisibilityTimeout: seconds,
        }),
      )
      .catch((error) => logger.warn({ error }, 'Falha ao ajustar visibilidade da mensagem'));
  }

  private queueUrl(queue: string): string {
    const url = this.config.queues[queue];
    if (!url) throw new Error(`Fila SQS "${queue}" não configurada`);
    return url;
  }
}
