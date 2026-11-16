import {
  CriarPreferenciaInput,
  Estorno,
  IPaymentGateway,
  PagamentoGateway,
  Preferencia,
} from '@domain/services/payment-gateway';
import { PaymentGatewayError } from '@shared/errors/domain.error';

/**
 * Gateway em memória para testes unitários/BDD e desenvolvimento sem conta no
 * Mercado Pago (`PAYMENT_GATEWAY=fake`). Respeita idempotência por chave e permite
 * simular o comprador pagando/sendo recusado via `simularPagamento`.
 */
export class FakePaymentGateway implements IPaymentGateway {
  readonly preferencias = new Map<string, Preferencia & { input: CriarPreferenciaInput }>();
  readonly pagamentos = new Map<string, PagamentoGateway>();
  readonly estornos = new Map<string, Estorno>();
  falharProximaChamada?: Error;
  private sequencia = 0;
  chamadas = { criarPreferencia: 0, consultarPagamento: 0, estornar: 0 };

  async criarPreferencia(input: CriarPreferenciaInput): Promise<Preferencia> {
    this.chamadas.criarPreferencia++;
    this.lancarSeFalha();
    const existente = this.preferencias.get(input.idempotencyKey);
    if (existente) return { preferenceId: existente.preferenceId, initPoint: existente.initPoint };
    const preferenceId = `pref-${++this.sequencia}`;
    const pref = {
      preferenceId,
      initPoint: `https://fake.mercadopago.test/checkout/${preferenceId}`,
    };
    this.preferencias.set(input.idempotencyKey, { ...pref, input });
    return pref;
  }

  async consultarPagamento(mpPaymentId: string): Promise<PagamentoGateway | null> {
    this.chamadas.consultarPagamento++;
    this.lancarSeFalha();
    return this.pagamentos.get(mpPaymentId) ?? null;
  }

  async buscarPorReferencia(orcamentoId: string): Promise<PagamentoGateway[]> {
    this.lancarSeFalha();
    return [...this.pagamentos.values()].filter((p) => p.externalReference === orcamentoId);
  }

  async estornar(mpPaymentId: string, idempotencyKey: string): Promise<Estorno> {
    this.chamadas.estornar++;
    this.lancarSeFalha();
    const existente = this.estornos.get(idempotencyKey);
    if (existente) return existente;
    const pagamento = this.pagamentos.get(mpPaymentId);
    if (!pagamento)
      throw new PaymentGatewayError(`Pagamento ${mpPaymentId} inexistente no gateway`);
    const estorno = { refundId: `refund-${++this.sequencia}` };
    this.estornos.set(idempotencyKey, estorno);
    pagamento.status = 'refunded';
    return estorno;
  }

  /** Simula o comprador no checkout (ex.: cartão APRO = approved, OTHE = rejected). */
  simularPagamento(
    mpPaymentId: string,
    status: string,
    orcamentoId: string,
    valor: number,
  ): PagamentoGateway {
    const p: PagamentoGateway = { id: mpPaymentId, status, externalReference: orcamentoId, valor };
    this.pagamentos.set(mpPaymentId, p);
    return p;
  }

  private lancarSeFalha(): void {
    if (this.falharProximaChamada) {
      const e = this.falharProximaChamada;
      this.falharProximaChamada = undefined;
      throw e;
    }
  }
}
