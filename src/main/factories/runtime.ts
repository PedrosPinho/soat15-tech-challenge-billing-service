import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { BillingCommandHandler } from '@application/messaging/billing-command-handler';
import { OutboxRelay } from '@application/messaging/outbox-relay';
import { OrcamentoUseCases } from '@application/use-cases/orcamento.use-cases';
import { PagamentoUseCases } from '@application/use-cases/pagamento.use-cases';
import { IMessageBus } from '@domain/services/message-bus';
import { IPaymentGateway } from '@domain/services/payment-gateway';
import { PostgresInboxRepository } from '@infrastructure/database/postgres/repositories/inbox.repository.impl';
import { PostgresOrcamentoRepository } from '@infrastructure/database/postgres/repositories/orcamento.repository.impl';
import { PostgresOutboxRepository } from '@infrastructure/database/postgres/repositories/outbox.repository.impl';
import { PostgresPagamentoRepository } from '@infrastructure/database/postgres/repositories/pagamento.repository.impl';
import { PostgresUnitOfWork } from '@infrastructure/database/postgres/unit-of-work';
import { InMemoryMessageBus } from '@infrastructure/messaging/in-memory-message-bus';
import { SqsSnsMessageBus } from '@infrastructure/messaging/sqs-sns-message-bus';
import { FakePaymentGateway } from '@infrastructure/payments/fake-payment-gateway';
import { MercadoPagoPaymentGateway } from '@infrastructure/payments/mercado-pago-payment-gateway';
import { BillingController } from '@presentation/controllers/billing.controller';
import { Destinations } from '@shared/messaging/messages';
import { makeNotificationService } from './notification.factory';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} é obrigatória`);
  return value;
};

/** `MESSAGING_DRIVER=memory` (testes/dev sem AWS) ou `sqs` (default). `AWS_ENDPOINT_URL` = LocalStack. */
export const makeMessageBus = (): IMessageBus => {
  if (process.env.MESSAGING_DRIVER === 'memory') return new InMemoryMessageBus();
  const region = process.env.AWS_REGION ?? 'us-east-1';
  return new SqsSnsMessageBus({
    sqs: new SQSClient({ region }),
    sns: new SNSClient({ region }),
    queues: { [Destinations.BillingCommands]: required('BILLING_COMMANDS_QUEUE_URL') },
    topics: { [Destinations.EventosTopic]: required('EVENTS_TOPIC_ARN') },
  });
};

/** `PAYMENT_GATEWAY=fake` (dev/BDD) ou `mercadopago` (default; exige `MP_ACCESS_TOKEN`). */
export const makePaymentGateway = (): IPaymentGateway => {
  if (process.env.PAYMENT_GATEWAY === 'fake') return new FakePaymentGateway();
  return new MercadoPagoPaymentGateway({
    accessToken: required('MP_ACCESS_TOKEN'),
    notificationUrl: process.env.MP_NOTIFICATION_URL,
    backUrl: process.env.MP_BACK_URL,
  });
};

export interface Runtime {
  controller: BillingController;
  commandHandler: BillingCommandHandler;
  relay: OutboxRelay;
  bus: IMessageBus;
}

/** Composition root. Exige o pool já conectado (`connectDatabase`). */
export const makeRuntime = (
  bus: IMessageBus = makeMessageBus(),
  gateway: IPaymentGateway = makePaymentGateway(),
): Runtime => {
  const uow = new PostgresUnitOfWork();
  const orcamentos = new PostgresOrcamentoRepository();
  const pagamentos = new PostgresPagamentoRepository();
  const outbox = new PostgresOutboxRepository();
  const inbox = new PostgresInboxRepository();

  return {
    bus,
    controller: new BillingController(
      new OrcamentoUseCases({ uow, orcamentos, pagamentos, outbox }),
      new PagamentoUseCases({ uow, pagamentos, outbox, gateway }),
    ),
    commandHandler: new BillingCommandHandler({
      uow,
      orcamentos,
      pagamentos,
      outbox,
      inbox,
      gateway,
      notifications: makeNotificationService(),
      pagamentoTtlMinutos: Number(process.env.PAGAMENTO_TTL_MINUTOS ?? 60),
      publicBaseUrl: process.env.PUBLIC_BASE_URL,
    }),
    relay: new OutboxRelay(uow, outbox, bus, {
      intervalMs: Number(process.env.OUTBOX_RELAY_INTERVAL_MS ?? 1000),
    }),
  };
};
