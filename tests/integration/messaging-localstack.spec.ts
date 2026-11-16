/**
 * Adapter de mensageria contra SQS/SNS REAIS do LocalStack: raw delivery + filter policy do SNS,
 * entrega só após o commit (delete), e DLQ para mensagem inválida. Roda só com
 * `LOCALSTACK_ENDPOINT` (CI: service container; local: `docker compose up -d localstack` e
 * `LOCALSTACK_ENDPOINT=http://localhost:4566`). Idêntico nos 3 serviços (cópia deliberada).
 */
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { CreateTopicCommand, SNSClient, SubscribeCommand } from '@aws-sdk/client-sns';
import { SqsSnsMessageBus } from '@infrastructure/messaging/sqs-sns-message-bus';
import { createEnvelope, Envelope } from '@shared/messaging/envelope';

const endpoint = process.env.LOCALSTACK_ENDPOINT;
const describeLocalstack = endpoint ? describe : describe.skip;

describeLocalstack('SqsSnsMessageBus × LocalStack', () => {
  const base = {
    region: 'us-east-1',
    endpoint,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  };
  const sqs = new SQSClient(base);
  const sns = new SNSClient(base);
  const sufixo = `${Date.now()}`;
  let bus: SqsSnsMessageBus;
  let comandosUrl: string;
  let dlqUrl: string;
  let respostasUrl: string;

  const env = (type: string, payload: object = {}): Envelope =>
    createEnvelope({
      type,
      sagaId: 'saga-it',
      correlationId: 'corr-it',
      payload: { ordemServicoId: 'os-it', ...payload },
    });
  const esperar = async <T>(fn: () => Promise<T | undefined>, ms = 15_000): Promise<T> => {
    const limite = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v !== undefined) return v;
      if (Date.now() > limite) throw new Error('timeout aguardando condição');
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const arn = async (url: string): Promise<string> =>
    (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn'] })))
      .Attributes!.QueueArn as string;

  beforeAll(async () => {
    dlqUrl = (await sqs.send(new CreateQueueCommand({ QueueName: `it-dlq-${sufixo}` }))).QueueUrl!;
    comandosUrl = (
      await sqs.send(
        new CreateQueueCommand({
          QueueName: `it-comandos-${sufixo}`,
          Attributes: {
            VisibilityTimeout: '5',
            RedrivePolicy: JSON.stringify({
              deadLetterTargetArn: await arn(dlqUrl),
              maxReceiveCount: '2',
            }),
          },
        }),
      )
    ).QueueUrl!;
    respostasUrl = (await sqs.send(new CreateQueueCommand({ QueueName: `it-respostas-${sufixo}` })))
      .QueueUrl!;
    const topicArn = (await sns.send(new CreateTopicCommand({ Name: `it-eventos-${sufixo}` })))
      .TopicArn!;
    await sns.send(
      new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: 'sqs',
        Endpoint: await arn(respostasUrl),
        Attributes: {
          RawMessageDelivery: 'true',
          FilterPolicy: JSON.stringify({ type: ['EventoPermitido'] }),
          FilterPolicyScope: 'MessageAttributes',
        },
      }),
    );
    bus = new SqsSnsMessageBus({
      sqs,
      sns,
      waitTimeSeconds: 1,
      queues: { comandos: comandosUrl },
      topics: { eventos: topicArn },
    });
  }, 60_000);

  const lerRespostas = async (): Promise<Envelope[]> => {
    const r = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: respostasUrl,
        WaitTimeSeconds: 1,
        MaxNumberOfMessages: 10,
      }),
    );
    return (r.Messages ?? []).map((m) => JSON.parse(m.Body!) as Envelope);
  };

  it('publish: o corpo chega CRU (raw delivery) e a filter policy descarta tipos não assinados', async () => {
    await bus.publish('eventos', env('EventoIgnorado'));
    const permitido = env('EventoPermitido');
    await bus.publish('eventos', permitido);

    const recebido = await esperar(async () =>
      (await lerRespostas()).find((e) => e.type === 'EventoPermitido'),
    );
    expect(recebido).toMatchObject({
      messageId: permitido.messageId,
      sagaId: 'saga-it',
      correlationId: 'corr-it',
    });
    expect((await lerRespostas()).find((e) => e.type === 'EventoIgnorado')).toBeUndefined();
  }, 40_000);

  it('send + subscribe: o handler recebe o envelope e a mensagem é apagada depois do sucesso', async () => {
    const recebidas: Envelope[] = [];
    const sub = await bus.subscribe('comandos', async (m) => {
      recebidas.push(m);
    });
    const cmd = env('ComandoOk');
    await bus.send('comandos', cmd);
    await esperar(async () => (recebidas.length > 0 ? true : undefined));
    await sub.stop();
    expect(recebidas[0].messageId).toBe(cmd.messageId);

    // apagada: depois do visibility timeout não volta
    await new Promise((r) => setTimeout(r, 6_000));
    const r = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: comandosUrl, WaitTimeSeconds: 1 }),
    );
    expect(r.Messages ?? []).toHaveLength(0);
  }, 40_000);

  it('envelope inválido nunca é descartado em silêncio: vai para a DLQ após maxReceiveCount', async () => {
    const sub = await bus.subscribe('comandos', async () => undefined);
    await sqs.send(
      new SendMessageCommand({ QueueUrl: comandosUrl, MessageBody: '{isto-nao-e-json' }),
    );
    const naDlq = await esperar(async () => {
      const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl: dlqUrl, WaitTimeSeconds: 1 }));
      return r.Messages?.[0]?.Body;
    }, 30_000);
    await sub.stop();
    expect(naDlq).toBe('{isto-nao-e-json');
  }, 60_000);
});
