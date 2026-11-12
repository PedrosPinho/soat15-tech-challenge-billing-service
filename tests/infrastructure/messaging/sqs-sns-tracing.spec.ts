import { ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SqsSnsMessageBus } from '@infrastructure/messaging/sqs-sns-message-bus';
import { Envelope } from '@shared/messaging/envelope';
import { requestContext } from '@shared/logger';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nr = require('newrelic');

const trace = {
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
  newrelic: 'abc',
};
const envelope: Envelope = {
  messageId: 'm1',
  type: 'T',
  version: 1,
  sagaId: 'saga-1',
  correlationId: 'corr-1',
  occurredAt: '2026-01-01T00:00:00.000Z',
  payload: { ordemServicoId: 'os-1' },
  trace,
};

describe('SqsSnsMessageBus × distributed tracing', () => {
  beforeEach(() => jest.clearAllMocks());

  it('os headers de trace do envelope viajam como MessageAttributes', async () => {
    const send = jest.fn(async () => ({}));
    const bus = new SqsSnsMessageBus({
      sqs: { send } as never,
      sns: { send } as never,
      queues: { q: 'http://q' },
      topics: {},
    });
    await bus.send('q', envelope);
    const attrs = (send.mock.calls[0] as unknown as [SendMessageCommand])[0].input
      .MessageAttributes!;
    expect(attrs.traceparent.StringValue).toBe(trace.traceparent);
    expect(attrs.newrelic.StringValue).toBe('abc');
    expect(attrs.sagaId.StringValue).toBe('saga-1');
  });

  it('o consumo roda numa transação ligada ao trace do produtor, com saga/OS no contexto de log', async () => {
    let entregue = false;
    let contexto: unknown;
    const send = jest.fn(async (cmd: unknown) => {
      if (cmd instanceof ReceiveMessageCommand) {
        await new Promise((r) => setTimeout(r, 1));
        if (entregue) return {};
        entregue = true;
        return { Messages: [{ Body: JSON.stringify(envelope), ReceiptHandle: 'rh' }] };
      }
      return {};
    });
    const bus = new SqsSnsMessageBus({
      sqs: { send } as never,
      sns: { send } as never,
      queues: { q: 'http://q' },
      topics: {},
      waitTimeSeconds: 0,
    });
    const sub = await bus.subscribe('q', async () => {
      contexto = requestContext.getStore();
    });
    for (let i = 0; i < 200 && !contexto; i++) await new Promise((r) => setTimeout(r, 5));
    await sub.stop();

    expect(nr.startBackgroundTransaction).toHaveBeenCalledWith(
      'q/T',
      'Queue',
      expect.any(Function),
    );
    expect(nr.__transaction.acceptDistributedTraceHeaders).toHaveBeenCalledWith('Queue', trace);
    expect(contexto).toMatchObject({
      correlationId: 'corr-1',
      sagaId: 'saga-1',
      ordemServicoId: 'os-1',
    });
    expect(nr.addCustomAttributes).toHaveBeenCalledWith({
      sagaId: 'saga-1',
      ordemServicoId: 'os-1',
    });
  });
});
