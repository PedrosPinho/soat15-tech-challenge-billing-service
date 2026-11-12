import { randomUUID } from 'crypto';

/**
 * Envelope de todo comando/evento trafegado entre os microsserviços.
 * Contrato em `docs/architecture/contratos-mensagens.md` (seção 2).
 */
export interface Envelope<TPayload = unknown, TType extends string = string> {
  messageId: string;
  type: TType;
  version: number;
  sagaId: string;
  correlationId: string;
  occurredAt: string;
  payload: TPayload;
}

export interface CreateEnvelopeInput<TPayload, TType extends string> {
  type: TType;
  sagaId: string;
  correlationId: string;
  payload: TPayload;
  version?: number;
  messageId?: string;
  occurredAt?: Date;
}

export const createEnvelope = <TPayload, TType extends string>(
  input: CreateEnvelopeInput<TPayload, TType>,
): Envelope<TPayload, TType> => ({
  messageId: input.messageId ?? randomUUID(),
  type: input.type,
  version: input.version ?? 1,
  sagaId: input.sagaId,
  correlationId: input.correlationId,
  occurredAt: (input.occurredAt ?? new Date()).toISOString(),
  payload: input.payload,
});

export class InvalidEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEnvelopeError';
  }
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Valida um corpo de mensagem já desserializado. Erro permanente
 * (`InvalidEnvelopeError`): não adianta reprocessar, a mensagem vai para a DLQ.
 */
export const parseEnvelope = (raw: unknown): Envelope => {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidEnvelopeError('Envelope deve ser um objeto');
  }
  const e = raw as Record<string, unknown>;
  for (const field of ['messageId', 'type', 'sagaId', 'correlationId', 'occurredAt'] as const) {
    if (!isNonEmptyString(e[field])) {
      throw new InvalidEnvelopeError(`Envelope inválido: campo "${field}" ausente`);
    }
  }
  if (!Number.isInteger(e.version) || (e.version as number) < 1) {
    throw new InvalidEnvelopeError('Envelope inválido: "version" deve ser inteiro >= 1');
  }
  if (typeof e.payload !== 'object' || e.payload === null) {
    throw new InvalidEnvelopeError('Envelope inválido: "payload" deve ser um objeto');
  }
  return e as unknown as Envelope;
};

export const parseEnvelopeFromJson = (body: string): Envelope => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new InvalidEnvelopeError('Corpo da mensagem não é um JSON válido');
  }
  return parseEnvelope(parsed);
};
