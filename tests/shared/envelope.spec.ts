import {
  createEnvelope,
  InvalidEnvelopeError,
  parseEnvelope,
  parseEnvelopeFromJson,
} from '@shared/messaging/envelope';

describe('envelope', () => {
  const base = { type: 'GerarOrcamento', sagaId: 's1', correlationId: 'c1', payload: { a: 1 } };

  it('cria envelope com defaults (messageId uuid, version 1, occurredAt ISO)', () => {
    const e = createEnvelope(base);
    expect(e.messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.version).toBe(1);
    expect(new Date(e.occurredAt).toISOString()).toBe(e.occurredAt);
  });

  it('respeita messageId, version e occurredAt informados', () => {
    const e = createEnvelope({
      ...base,
      messageId: 'm1',
      version: 2,
      occurredAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(e).toMatchObject({
      messageId: 'm1',
      version: 2,
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('round-trip por JSON', () => {
    const e = createEnvelope(base);
    expect(parseEnvelopeFromJson(JSON.stringify(e))).toEqual(e);
  });

  it.each([
    ['null', null],
    ['string', 'x'],
    ['sem messageId', { ...createEnvelope(base), messageId: '' }],
    ['sem type', { ...createEnvelope(base), type: undefined }],
    ['version 0', { ...createEnvelope(base), version: 0 }],
    ['version não inteira', { ...createEnvelope(base), version: 1.5 }],
    ['payload ausente', { ...createEnvelope(base), payload: undefined }],
    ['payload nulo', { ...createEnvelope(base), payload: null }],
  ])('rejeita envelope inválido (%s)', (_nome, raw) => {
    expect(() => parseEnvelope(raw)).toThrow(InvalidEnvelopeError);
  });

  it('rejeita JSON malformado', () => {
    expect(() => parseEnvelopeFromJson('{oops')).toThrow(InvalidEnvelopeError);
  });
});
