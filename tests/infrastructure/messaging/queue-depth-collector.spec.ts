import { SQSClient } from '@aws-sdk/client-sqs';
import { filaComDlq, QueueDepthCollector } from '@infrastructure/messaging/queue-depth-collector';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nr = require('newrelic');

describe('QueueDepthCollector', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deriva a DLQ pela convenção de nome', () => {
    expect(filaComDlq('billing-commands', 'http://q/000/billing-commands')).toEqual([
      { nome: 'billing-commands', url: 'http://q/000/billing-commands', tipo: 'principal' },
      { nome: 'billing-commands-dlq', url: 'http://q/000/billing-commands-dlq', tipo: 'dlq' },
    ]);
  });

  it('publica FilaProfundidade por fila (principal e DLQ)', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: '3',
          ApproximateNumberOfMessagesNotVisible: '1',
        },
      })
      .mockResolvedValueOnce({ Attributes: { ApproximateNumberOfMessages: '2' } });
    const c = new QueueDepthCollector(
      { send } as unknown as SQSClient,
      'billing-service',
      filaComDlq('q', 'http://x/q'),
    );
    expect(await c.coletar()).toBe(2);
    expect(nr.recordCustomEvent).toHaveBeenNthCalledWith(1, 'FilaProfundidade', {
      servico: 'billing-service',
      fila: 'q',
      tipo: 'principal',
      mensagens: 3,
      emVoo: 1,
      atrasadas: 0,
    });
    expect(nr.recordCustomEvent).toHaveBeenNthCalledWith(2, 'FilaProfundidade', {
      servico: 'billing-service',
      fila: 'q-dlq',
      tipo: 'dlq',
      mensagens: 2,
      emVoo: 0,
      atrasadas: 0,
    });
  });

  it('uma fila inacessível não impede medir as demais', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('NonExistentQueue'))
      .mockResolvedValueOnce({});
    const c = new QueueDepthCollector(
      { send } as unknown as SQSClient,
      's',
      filaComDlq('q', 'http://x/q'),
    );
    expect(await c.coletar()).toBe(1);
    expect(nr.recordCustomEvent).toHaveBeenCalledTimes(1);
  });

  it('start/stop controlam o laço periódico', async () => {
    jest.useFakeTimers();
    try {
      const send = jest.fn().mockResolvedValue({ Attributes: {} });
      const c = new QueueDepthCollector(
        { send } as unknown as SQSClient,
        's',
        [{ nome: 'q', url: 'u', tipo: 'principal' }],
        100,
      );
      c.start();
      await jest.advanceTimersByTimeAsync(250);
      expect(send).toHaveBeenCalled();
      await c.stop();
    } finally {
      jest.useRealTimers();
    }
  });
});
