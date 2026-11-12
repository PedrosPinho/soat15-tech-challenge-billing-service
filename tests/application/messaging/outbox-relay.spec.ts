import { OutboxRelay } from '@application/messaging/outbox-relay';
import { OutboxEntry } from '@domain/repositories/outbox.repository';
import { InMemoryMessageBus } from '@infrastructure/messaging/in-memory-message-bus';
import { createEnvelope } from '@shared/messaging/envelope';
import { FakeDb, FakeOutboxRepo, FakeUow } from '../../support/fakes';

const entry = (id: string, tentativas = 0): OutboxEntry => ({
  id,
  kind: 'topic',
  destination: 'oficina-eventos',
  tentativas,
  envelope: createEnvelope({
    type: 'OrcamentoGerado',
    sagaId: 's',
    correlationId: 'c',
    payload: {},
  }),
});

const setup = (entries: OutboxEntry[]) => {
  const outbox = new FakeOutboxRepo(new FakeDb());
  const published: string[] = [];
  const failed: { id: string; error: string; retryAt: Date }[] = [];
  outbox.claimBatch = async () => entries;
  outbox.markPublished = async (id) => {
    published.push(id);
  };
  outbox.markFailed = async (id: string, error: string, retryAt: Date) => {
    failed.push({ id, error, retryAt });
  };
  const bus = new InMemoryMessageBus();
  const now = new Date('2026-01-01T00:00:00Z');
  const relay = new OutboxRelay(
    new FakeUow(new FakeDb()),
    outbox,
    bus,
    { maxBackoffMs: 5000 },
    () => now,
  );
  return { relay, bus, published, failed, now };
};

describe('OutboxRelay', () => {
  it('publica no tópico e marca como enviada', async () => {
    const { relay, bus, published } = setup([entry('1'), entry('2')]);
    expect(await relay.tick()).toBe(2);
    expect(bus.sent.map((s) => [s.kind, s.destination])).toEqual([
      ['publish', 'oficina-eventos'],
      ['publish', 'oficina-eventos'],
    ]);
    expect(published).toEqual(['1', '2']);
  });

  it('comando para fila vai por send', async () => {
    const { relay, bus } = setup([{ ...entry('1'), kind: 'queue', destination: 'q' }]);
    await relay.tick();
    expect(bus.sent[0]).toMatchObject({ kind: 'send', destination: 'q' });
  });

  it('falha agenda retry com backoff exponencial (com teto) e segue o lote', async () => {
    const e = [entry('1', 2), entry('2'), entry('3', 20)];
    const { relay, bus, published, failed, now } = setup(e);
    bus.publish = async (_t, m) => {
      if (m === e[0].envelope) throw new Error('sns fora');
      if (m === e[2].envelope) throw 'texto';
    };
    expect(await relay.tick()).toBe(1);
    expect(published).toEqual(['2']);
    expect(failed[0]).toMatchObject({ id: '1', error: 'sns fora' });
    expect(failed[0].retryAt.getTime() - now.getTime()).toBe(4000);
    expect(failed[1]).toMatchObject({ id: '3', error: 'texto' });
    expect(failed[1].retryAt.getTime() - now.getTime()).toBe(5000);
  });

  it('start/stop do laço periódico', async () => {
    const { relay } = setup([]);
    relay.start();
    await relay.stop();
  });
});
