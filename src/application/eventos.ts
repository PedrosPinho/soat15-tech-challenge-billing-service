import { randomUUID } from 'node:crypto';
import { IOutboxRepository } from '@domain/repositories/outbox.repository';
import { requestContext } from '@shared/logger';
import { createEnvelope } from '@shared/messaging/envelope';
import { Destinations, MessageCatalog } from '@shared/messaging/messages';

export type EventoPublicavel =
  | 'OrcamentoGerado'
  | 'OrcamentoFalhou'
  | 'OrcamentoAprovado'
  | 'OrcamentoRecusado'
  | 'OrcamentoCancelado'
  | 'PagamentoSolicitado'
  | 'PagamentoConfirmado'
  | 'PagamentoRecusado'
  | 'PagamentoEstornado'
  | 'EstornoFalhou';

/** Grava o evento no outbox (mesma transação da mudança de estado) para o relay publicar no SNS. */
export const publicarEvento = <T extends EventoPublicavel>(
  outbox: IOutboxRepository,
  type: T,
  sagaId: string,
  correlationId: string,
  payload: MessageCatalog[T],
): Promise<void> =>
  outbox.enqueue({
    kind: 'topic',
    destination: Destinations.EventosTopic,
    envelope: createEnvelope({ type, sagaId, correlationId, payload }),
  });

/** `correlationId` da requisição HTTP corrente, ou um novo (webhooks sem cabeçalho). */
export const correlationIdAtual = (): string =>
  requestContext.getStore()?.correlationId ?? randomUUID();
