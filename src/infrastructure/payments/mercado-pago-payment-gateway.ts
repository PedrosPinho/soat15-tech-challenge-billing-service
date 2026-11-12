import {
  CriarPreferenciaInput,
  Estorno,
  IPaymentGateway,
  PagamentoGateway,
  Preferencia,
} from '@domain/services/payment-gateway';
import { PaymentGatewayError } from '@shared/errors/domain.error';

export interface MercadoPagoOptions {
  accessToken: string;
  /** URL pública (API Gateway) para onde o MP envia as notificações. */
  notificationUrl?: string;
  /** Para onde o MP devolve o comprador ao final do checkout. */
  backUrl?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Credenciais `TEST-…` abrem o checkout no `sandbox_init_point`. */
  sandbox?: boolean;
}

interface MpPayment {
  id: number | string;
  status: string;
  status_detail?: string;
  external_reference?: string;
  transaction_amount: number;
}

const toGateway = (p: MpPayment): PagamentoGateway => ({
  id: String(p.id),
  status: p.status,
  statusDetail: p.status_detail,
  externalReference: p.external_reference,
  valor: p.transaction_amount,
});

/**
 * Adapter REST do Mercado Pago (Checkout Pro). Escritas levam `X-Idempotency-Key`,
 * então um retry da fila ou do outbox não duplica preferência nem estorno.
 */
export class MercadoPagoPaymentGateway implements IPaymentGateway {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sandbox: boolean;

  constructor(private readonly options: MercadoPagoOptions) {
    if (!options.accessToken) throw new Error('MP_ACCESS_TOKEN é obrigatório');
    this.baseUrl = (options.baseUrl ?? 'https://api.mercadopago.com').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sandbox = options.sandbox ?? options.accessToken.startsWith('TEST-');
  }

  async criarPreferencia(input: CriarPreferenciaInput): Promise<Preferencia> {
    const body = {
      items: [
        {
          id: input.orcamentoId,
          title: input.descricao,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: input.valor,
        },
      ],
      external_reference: input.orcamentoId,
      metadata: { ordemServicoId: input.ordemServicoId, numeroOS: input.numeroOS },
      ...(input.pagadorEmail ? { payer: { email: input.pagadorEmail } } : {}),
      ...(this.options.notificationUrl ? { notification_url: this.options.notificationUrl } : {}),
      ...(this.options.backUrl
        ? {
            back_urls: {
              success: this.options.backUrl,
              failure: this.options.backUrl,
              pending: this.options.backUrl,
            },
          }
        : {}),
      expires: true,
      expiration_date_to: input.expiraEm.toISOString(),
    };
    const res = await this.request('POST', '/checkout/preferences', body, input.idempotencyKey);
    const json = (await res.json()) as {
      id: string;
      init_point?: string;
      sandbox_init_point?: string;
    };
    const initPoint = this.sandbox ? (json.sandbox_init_point ?? json.init_point) : json.init_point;
    if (!json.id || !initPoint) {
      throw new PaymentGatewayError('Resposta do Mercado Pago sem id/init_point');
    }
    return { preferenceId: json.id, initPoint };
  }

  async consultarPagamento(mpPaymentId: string): Promise<PagamentoGateway | null> {
    const res = await this.request(
      'GET',
      `/v1/payments/${encodeURIComponent(mpPaymentId)}`,
      undefined,
      undefined,
      [404],
    );
    if (res.status === 404) return null;
    return toGateway((await res.json()) as MpPayment);
  }

  async buscarPorReferencia(orcamentoId: string): Promise<PagamentoGateway[]> {
    const res = await this.request(
      'GET',
      `/v1/payments/search?external_reference=${encodeURIComponent(orcamentoId)}&sort=date_created&criteria=desc`,
    );
    const json = (await res.json()) as { results?: MpPayment[] };
    return (json.results ?? []).map(toGateway);
  }

  async estornar(mpPaymentId: string, idempotencyKey: string): Promise<Estorno> {
    const res = await this.request(
      'POST',
      `/v1/payments/${encodeURIComponent(mpPaymentId)}/refunds`,
      {},
      idempotencyKey,
    );
    const json = (await res.json()) as { id?: number | string };
    if (json.id === undefined) throw new PaymentGatewayError('Resposta de estorno sem id');
    return { refundId: String(json.id) };
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
    toleratedStatuses: number[] = [],
  ): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.accessToken}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new PaymentGatewayError(
        `Mercado Pago indisponível (${method} ${path}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!res.ok && !toleratedStatuses.includes(res.status)) {
      const detalhe = (await res.text().catch(() => '')).slice(0, 300);
      throw new PaymentGatewayError(
        `Mercado Pago respondeu ${res.status} (${method} ${path}): ${detalhe}`,
      );
    }
    return res;
  }
}
