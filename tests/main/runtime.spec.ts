import { InMemoryMessageBus } from '@infrastructure/messaging/in-memory-message-bus';
import { SqsSnsMessageBus } from '@infrastructure/messaging/sqs-sns-message-bus';
import { FakePaymentGateway } from '@infrastructure/payments/fake-payment-gateway';
import { MercadoPagoPaymentGateway } from '@infrastructure/payments/mercado-pago-payment-gateway';
import { makeMessageBus, makePaymentGateway, makeRuntime } from '@main/factories/runtime';

describe('composition root', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('MESSAGING_DRIVER=memory usa o bus em memória; sqs exige as URLs', () => {
    process.env.MESSAGING_DRIVER = 'memory';
    expect(makeMessageBus()).toBeInstanceOf(InMemoryMessageBus);
    delete process.env.MESSAGING_DRIVER;
    delete process.env.BILLING_COMMANDS_QUEUE_URL;
    expect(() => makeMessageBus()).toThrow('BILLING_COMMANDS_QUEUE_URL');
    process.env.BILLING_COMMANDS_QUEUE_URL = 'http://localhost:4566/000000000000/billing-commands';
    expect(() => makeMessageBus()).toThrow('EVENTS_TOPIC_ARN');
    process.env.EVENTS_TOPIC_ARN = 'arn:aws:sns:us-east-1:000000000000:oficina-eventos';
    expect(makeMessageBus()).toBeInstanceOf(SqsSnsMessageBus);
  });

  it('PAYMENT_GATEWAY=fake ou Mercado Pago (exige o token)', () => {
    process.env.PAYMENT_GATEWAY = 'fake';
    expect(makePaymentGateway()).toBeInstanceOf(FakePaymentGateway);
    delete process.env.PAYMENT_GATEWAY;
    delete process.env.MP_ACCESS_TOKEN;
    expect(() => makePaymentGateway()).toThrow('MP_ACCESS_TOKEN');
    process.env.MP_ACCESS_TOKEN = 'TEST-1';
    expect(makePaymentGateway()).toBeInstanceOf(MercadoPagoPaymentGateway);
  });

  it('makeRuntime monta controller, handler e relay', () => {
    const rt = makeRuntime(new InMemoryMessageBus(), new FakePaymentGateway());
    expect(rt.controller).toBeDefined();
    expect(rt.commandHandler).toBeDefined();
    expect(rt.relay).toBeDefined();
  });
});
