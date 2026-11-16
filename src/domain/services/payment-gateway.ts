export interface CriarPreferenciaInput {
  orcamentoId: string;
  ordemServicoId: string;
  numeroOS: string;
  descricao: string;
  valor: number;
  pagadorEmail?: string;
  expiraEm: Date;
  /** Repetir a chamada com a mesma chave não cria outra preferência. */
  idempotencyKey: string;
}

export interface Preferencia {
  preferenceId: string;
  initPoint: string;
}

export type StatusPagamentoGateway =
  | 'approved'
  | 'pending'
  | 'in_process'
  | 'rejected'
  | 'cancelled'
  | 'refunded'
  | 'charged_back'
  | string;

export interface PagamentoGateway {
  id: string;
  status: StatusPagamentoGateway;
  statusDetail?: string;
  /** `external_reference` da preferência = id do orçamento. */
  externalReference?: string;
  valor: number;
}

export interface Estorno {
  refundId: string;
}

/** Port do gateway de pagamento (Mercado Pago Checkout Pro) — ADR-014. */
export interface IPaymentGateway {
  criarPreferencia(input: CriarPreferenciaInput): Promise<Preferencia>;
  /** Fonte da verdade: o corpo do webhook nunca é confiado. */
  consultarPagamento(mpPaymentId: string): Promise<PagamentoGateway | null>;
  /** Reconciliação: pagamentos da preferência de um orçamento (por `external_reference`). */
  buscarPorReferencia(orcamentoId: string): Promise<PagamentoGateway[]>;
  estornar(mpPaymentId: string, idempotencyKey: string): Promise<Estorno>;
}
