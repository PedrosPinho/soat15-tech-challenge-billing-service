import { MercadoPagoPaymentGateway } from '@infrastructure/payments/mercado-pago-payment-gateway';
import { PaymentGatewayError } from '@shared/errors/domain.error';

const resposta = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

const entrada = {
  orcamentoId: 'orc-1',
  ordemServicoId: 'os-1',
  numeroOS: 'OS-1',
  descricao: 'OS OS-1',
  valor: 310.5,
  pagadorEmail: 'c@x.com',
  expiraEm: new Date('2026-11-13T00:00:00Z'),
  idempotencyKey: 'preferencia-orc-1',
};

describe('MercadoPagoPaymentGateway', () => {
  const fetchImpl = jest.fn();
  const make = (extra: object = {}): MercadoPagoPaymentGateway =>
    new MercadoPagoPaymentGateway({
      accessToken: 'TEST-123',
      notificationUrl: 'https://api/webhook',
      backUrl: 'https://app/volta',
      fetchImpl: fetchImpl as never,
      ...extra,
    });
  beforeEach(() => fetchImpl.mockReset());

  it('exige access token', () => {
    expect(() => new MercadoPagoPaymentGateway({ accessToken: '' })).toThrow('MP_ACCESS_TOKEN');
  });

  describe('criarPreferencia', () => {
    it('envia external_reference, notification_url, expiração e X-Idempotency-Key; devolve o sandbox_init_point', async () => {
      fetchImpl.mockResolvedValue(
        resposta(201, {
          id: 'pref-1',
          init_point: 'https://prod',
          sandbox_init_point: 'https://sandbox',
        }),
      );
      const r = await make().criarPreferencia(entrada);
      expect(r).toEqual({ preferenceId: 'pref-1', initPoint: 'https://sandbox' });

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://api.mercadopago.com/checkout/preferences');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer TEST-123',
        'X-Idempotency-Key': 'preferencia-orc-1',
      });
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({
        external_reference: 'orc-1',
        notification_url: 'https://api/webhook',
        items: [{ unit_price: 310.5, quantity: 1, currency_id: 'BRL' }],
        payer: { email: 'c@x.com' },
        expires: true,
        expiration_date_to: '2026-11-13T00:00:00.000Z',
        back_urls: { success: 'https://app/volta' },
        metadata: { ordemServicoId: 'os-1' },
      });
    });

    it('credencial de produção usa init_point; omite campos opcionais ausentes', async () => {
      fetchImpl.mockResolvedValue(
        resposta(201, {
          id: 'p',
          init_point: 'https://prod',
          sandbox_init_point: 'https://sandbox',
        }),
      );
      const gw = new MercadoPagoPaymentGateway({
        accessToken: 'APP_USR-1',
        fetchImpl: fetchImpl as never,
      });
      expect((await gw.criarPreferencia({ ...entrada, pagadorEmail: undefined })).initPoint).toBe(
        'https://prod',
      );
      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      expect(body.payer).toBeUndefined();
      expect(body.notification_url).toBeUndefined();
      expect(body.back_urls).toBeUndefined();
    });

    it('sandbox sem sandbox_init_point cai para init_point; resposta incompleta falha', async () => {
      fetchImpl.mockResolvedValueOnce(resposta(201, { id: 'p', init_point: 'https://prod' }));
      expect((await make().criarPreferencia(entrada)).initPoint).toBe('https://prod');
      fetchImpl.mockResolvedValueOnce(resposta(201, { id: 'p' }));
      await expect(make().criarPreferencia(entrada)).rejects.toThrow('sem id/init_point');
    });
  });

  describe('consultarPagamento / buscarPorReferencia', () => {
    const mp = {
      id: 987,
      status: 'approved',
      status_detail: 'accredited',
      external_reference: 'orc-1',
      transaction_amount: 310.5,
    };

    it('mapeia o pagamento e usa GET sem corpo nem chave de idempotência', async () => {
      fetchImpl.mockResolvedValue(resposta(200, mp));
      expect(await make().consultarPagamento('987')).toEqual({
        id: '987',
        status: 'approved',
        statusDetail: 'accredited',
        externalReference: 'orc-1',
        valor: 310.5,
      });
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://api.mercadopago.com/v1/payments/987');
      expect(init.body).toBeUndefined();
      expect(init.headers['X-Idempotency-Key']).toBeUndefined();
    });

    it('404 → null; outros erros viram PaymentGatewayError', async () => {
      fetchImpl.mockResolvedValueOnce(resposta(404, { message: 'not found' }));
      expect(await make().consultarPagamento('1')).toBeNull();
      fetchImpl.mockResolvedValueOnce(resposta(401, { message: 'invalid token' }));
      await expect(make().consultarPagamento('1')).rejects.toThrow(/respondeu 401/);
    });

    it('busca por external_reference', async () => {
      fetchImpl.mockResolvedValue(resposta(200, { results: [mp] }));
      expect(await make().buscarPorReferencia('orc 1')).toHaveLength(1);
      expect(fetchImpl.mock.calls[0][0]).toContain('external_reference=orc%201');
      fetchImpl.mockResolvedValue(resposta(200, {}));
      expect(await make().buscarPorReferencia('x')).toEqual([]);
    });
  });

  describe('estornar', () => {
    it('POST /refunds com X-Idempotency-Key', async () => {
      fetchImpl.mockResolvedValue(resposta(201, { id: 555 }));
      expect(await make().estornar('987', 'estorno-pg-1')).toEqual({ refundId: '555' });
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://api.mercadopago.com/v1/payments/987/refunds');
      expect(init.headers['X-Idempotency-Key']).toBe('estorno-pg-1');
    });

    it('resposta sem id e erro HTTP falham', async () => {
      fetchImpl.mockResolvedValueOnce(resposta(201, {}));
      await expect(make().estornar('1', 'k')).rejects.toThrow('sem id');
      fetchImpl.mockResolvedValueOnce(resposta(400, { message: 'already refunded' }));
      await expect(make().estornar('1', 'k')).rejects.toThrow(PaymentGatewayError);
    });
  });

  it('erro de rede/timeout vira PaymentGatewayError; baseUrl com barra final é normalizada', async () => {
    fetchImpl.mockRejectedValue(new Error('ECONNRESET'));
    await expect(make().consultarPagamento('1')).rejects.toThrow(/indisponível.*ECONNRESET/);
    fetchImpl.mockRejectedValue('texto');
    await expect(make().consultarPagamento('1')).rejects.toThrow(/indisponível/);

    fetchImpl.mockResolvedValue(resposta(200, { id: 1, status: 'x', transaction_amount: 1 }));
    await make({ baseUrl: 'http://mp.local/' }).consultarPagamento('1');
    expect(fetchImpl.mock.calls.pop()[0]).toBe('http://mp.local/v1/payments/1');
  });

  it('erro HTTP sem corpo legível ainda gera mensagem', async () => {
    fetchImpl.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => {
        throw new Error('x');
      },
    });
    await expect(make().estornar('1', 'k')).rejects.toThrow(/respondeu 502/);
  });
});
