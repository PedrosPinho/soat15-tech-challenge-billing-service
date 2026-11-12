import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { PublishCommand } from '@aws-sdk/client-sns';
import { SqsSnsMessageBus } from '@infrastructure/messaging/sqs-sns-message-bus';
import { createEnvelope } from '@shared/messaging/envelope';

const envelope = createEnvelope({ type: 'T', sagaId: 's', correlationId: 'c', payload: { a: 1 } });

const build = (receive: () => unknown) => {
  const sqsSend = jest.fn(async (cmd: unknown) => {
    if (cmd instanceof ReceiveMessageCommand) {
      // simula o long polling: cede o event loop (senão o loop vira busy-wait)
      await new Promise((r) => setTimeout(r, 1));
      return receive();
    }
    return {};
  });
  const snsSend = jest.fn(async (_cmd: unknown) => ({}));
  const bus = new SqsSnsMessageBus({
    sqs: { send: sqsSend } as never,
    sns: { send: snsSend } as never,
    queues: { q: 'http://q' },
    topics: { t: 'arn:t' },
    waitTimeSeconds: 0,
    pollErrorBackoffMs: 1,
  });
  return { bus, sqsSend, snsSend };
};

/** Resolve quando `predicate` vale (polling curto). */
const until = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !predicate(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(predicate()).toBe(true);
};

describe('SqsSnsMessageBus', () => {
  it('send grava o envelope e os atributos', async () => {
    const { bus, sqsSend } = build(() => ({}));
    await bus.send('q', envelope);
    const cmd = sqsSend.mock.calls[0][0] as SendMessageCommand;
    expect(cmd.input.QueueUrl).toBe('http://q');
    expect(JSON.parse(cmd.input.MessageBody as string)).toEqual(envelope);
    expect(cmd.input.MessageAttributes?.type.StringValue).toBe('T');
  });

  it('send/publish falham para destino não configurado', async () => {
    const { bus } = build(() => ({}));
    await expect(bus.send('nope', envelope)).rejects.toThrow(/não configurada/);
    await expect(bus.publish('nope', envelope)).rejects.toThrow(/não configurado/);
  });

  it('publish envia ao tópico', async () => {
    const { bus, snsSend } = build(() => ({}));
    await bus.publish('t', envelope);
    const cmd = snsSend.mock.calls[0][0] as unknown as PublishCommand;
    expect(cmd.input.TopicArn).toBe('arn:t');
  });

  it('subscribe: apaga a mensagem só depois do handler concluir', async () => {
    let delivered = false;
    const { bus, sqsSend } = build(() => {
      if (delivered) return {};
      delivered = true;
      return { Messages: [{ Body: JSON.stringify(envelope), ReceiptHandle: 'rh' }] };
    });
    const order: string[] = [];
    const sub = await bus.subscribe('q', async () => {
      order.push('handler');
    });
    await until(() => sqsSend.mock.calls.some(([c]) => c instanceof DeleteMessageCommand));
    await sub.stop();
    expect(order).toEqual(['handler']);
  });

  it('subscribe: erro no handler não apaga e aplica backoff de visibilidade', async () => {
    let delivered = false;
    const { bus, sqsSend } = build(() => {
      if (delivered) return {};
      delivered = true;
      return {
        Messages: [
          {
            Body: JSON.stringify(envelope),
            ReceiptHandle: 'rh',
            Attributes: { ApproximateReceiveCount: '2' },
          },
        ],
      };
    });
    const sub = await bus.subscribe('q', async () => {
      throw new Error('boom');
    });
    await until(() =>
      sqsSend.mock.calls.some(([c]) => c instanceof ChangeMessageVisibilityCommand),
    );
    await sub.stop();
    const change = sqsSend.mock.calls
      .map(([c]) => c)
      .find((c) => c instanceof ChangeMessageVisibilityCommand) as ChangeMessageVisibilityCommand;
    expect(change.input.VisibilityTimeout).toBe(20);
    expect(sqsSend.mock.calls.some(([c]) => c instanceof DeleteMessageCommand)).toBe(false);
  });

  it('subscribe: envelope inválido vai à DLQ (visibilidade 0) sem chamar o handler', async () => {
    let delivered = false;
    const { bus, sqsSend } = build(() => {
      if (delivered) return {};
      delivered = true;
      return { Messages: [{ Body: '{oops', ReceiptHandle: 'rh' }] };
    });
    const handler = jest.fn();
    const sub = await bus.subscribe('q', handler);
    await until(() =>
      sqsSend.mock.calls.some(([c]) => c instanceof ChangeMessageVisibilityCommand),
    );
    await sub.stop();
    const change = sqsSend.mock.calls
      .map(([c]) => c)
      .find((c) => c instanceof ChangeMessageVisibilityCommand) as ChangeMessageVisibilityCommand;
    expect(change.input.VisibilityTimeout).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('subscribe: erro de polling não derruba o loop', async () => {
    let calls = 0;
    const { bus, sqsSend } = build(() => {
      calls++;
      if (calls === 1) throw new Error('rede');
      return {};
    });
    const sub = await bus.subscribe('q', jest.fn());
    await until(() => calls >= 2);
    await sub.stop();
    expect(sqsSend).toHaveBeenCalled();
  });
});
