import { InMemoryMessageBus } from '@infrastructure/messaging/in-memory-message-bus';
import { createEnvelope } from '@shared/messaging/envelope';

const msg = (type = 'X') => createEnvelope({ type, sagaId: 's', correlationId: 'c', payload: {} });

describe('InMemoryMessageBus', () => {
  it('entrega send ao handler inscrito', async () => {
    const bus = new InMemoryMessageBus();
    const handler = jest.fn();
    await bus.subscribe('q', handler);
    const m = msg();
    await bus.send('q', m);
    expect(handler).toHaveBeenCalledWith(m);
    expect(bus.ofType('X')).toEqual([m]);
  });

  it('mantém a mensagem pendente até alguém se inscrever', async () => {
    const bus = new InMemoryMessageBus();
    const m = msg();
    await bus.send('q', m);
    const handler = jest.fn();
    await bus.subscribe('q', handler);
    expect(handler).toHaveBeenCalledTimes(1);
    await bus.subscribe('q', jest.fn());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('publish faz fan-out apenas para filas ligadas ao tópico', async () => {
    const bus = new InMemoryMessageBus();
    bus.bindTopic('t', 'q1');
    const h1 = jest.fn();
    const h2 = jest.fn();
    await bus.subscribe('q1', h1);
    await bus.subscribe('q2', h2);
    await bus.publish('t', msg());
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).not.toHaveBeenCalled();
  });

  it('publish sem binding apenas registra', async () => {
    const bus = new InMemoryMessageBus();
    await bus.publish('t', msg());
    expect(bus.sent).toHaveLength(1);
  });

  it('stop remove o handler', async () => {
    const bus = new InMemoryMessageBus();
    const handler = jest.fn();
    const sub = await bus.subscribe('q', handler);
    await sub.stop();
    await bus.send('q', msg());
    expect(handler).not.toHaveBeenCalled();
  });
});
