import { randomUUID } from 'node:crypto';
import { InvalidTransitionError } from '@shared/errors/domain.error';

export enum PagamentoStatus {
  PENDENTE = 'PENDENTE',
  CONFIRMADO = 'CONFIRMADO',
  RECUSADO = 'RECUSADO',
  ESTORNADO = 'ESTORNADO',
}

export interface PagamentoProps {
  id: string;
  orcamentoId: string;
  ordemServicoId: string;
  sagaId: string;
  valor: number;
  status: PagamentoStatus;
  mpPreferenceId: string;
  initPoint: string;
  expiraEm: Date;
  mpPaymentId?: string;
  mpRefundId?: string;
  motivo?: string;
  confirmadoEm?: Date;
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface NovoPagamentoInput {
  orcamentoId: string;
  ordemServicoId: string;
  sagaId: string;
  valor: number;
  mpPreferenceId: string;
  initPoint: string;
  expiraEm: Date;
}

/**
 * Pagamento de um orçamento via Checkout Pro. `PENDENTE → CONFIRMADO | RECUSADO`,
 * `CONFIRMADO → ESTORNADO`. Um pagamento aprovado que chega depois de o pendente
 * ter sido recusado/cancelado (cliente pagou tarde) ainda é registrado: o dinheiro
 * entrou, e a Saga decide estornar.
 */
export class Pagamento {
  private constructor(private props: PagamentoProps) {}

  static criar(input: NovoPagamentoInput, agora: Date = new Date()): Pagamento {
    return new Pagamento({
      ...input,
      id: randomUUID(),
      status: PagamentoStatus.PENDENTE,
      criadoEm: agora,
      atualizadoEm: agora,
    });
  }

  static restaurar(props: PagamentoProps): Pagamento {
    return new Pagamento({ ...props });
  }

  get id(): string { return this.props.id; }
  get orcamentoId(): string { return this.props.orcamentoId; }
  get ordemServicoId(): string { return this.props.ordemServicoId; }
  get sagaId(): string { return this.props.sagaId; }
  get valor(): number { return this.props.valor; }
  get status(): PagamentoStatus { return this.props.status; }
  get mpPreferenceId(): string { return this.props.mpPreferenceId; }
  get initPoint(): string { return this.props.initPoint; }
  get expiraEm(): Date { return this.props.expiraEm; }
  get mpPaymentId(): string | undefined { return this.props.mpPaymentId; }
  get mpRefundId(): string | undefined { return this.props.mpRefundId; }
  get motivo(): string | undefined { return this.props.motivo; }
  get confirmadoEm(): Date | undefined { return this.props.confirmadoEm; }
  get criadoEm(): Date { return this.props.criadoEm; }
  get atualizadoEm(): Date { return this.props.atualizadoEm; }

  toProps(): PagamentoProps {
    return { ...this.props };
  }

  confirmar(mpPaymentId: string, agora: Date = new Date()): void {
    this.transitar([PagamentoStatus.PENDENTE, PagamentoStatus.RECUSADO], PagamentoStatus.CONFIRMADO, agora);
    this.props.mpPaymentId = mpPaymentId;
    this.props.confirmadoEm = agora;
    this.props.motivo = undefined;
  }

  recusar(motivo: string, agora: Date = new Date()): void {
    this.transitar([PagamentoStatus.PENDENTE], PagamentoStatus.RECUSADO, agora);
    this.props.motivo = motivo;
  }

  estornar(mpRefundId: string, motivo: string, agora: Date = new Date()): void {
    this.transitar([PagamentoStatus.CONFIRMADO], PagamentoStatus.ESTORNADO, agora);
    this.props.mpRefundId = mpRefundId;
    this.props.motivo = motivo;
  }

  private transitar(origens: PagamentoStatus[], destino: PagamentoStatus, agora: Date): void {
    if (!origens.includes(this.props.status)) {
      throw new InvalidTransitionError(
        `Transição inválida: ${this.props.status} → ${destino} (pagamento ${this.props.id})`,
      );
    }
    this.props.status = destino;
    this.props.atualizadoEm = agora;
  }
}
