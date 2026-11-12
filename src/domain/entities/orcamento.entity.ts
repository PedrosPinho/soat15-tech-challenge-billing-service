import { randomUUID } from 'node:crypto';
import { InvalidTransitionError, ValidationError } from '@shared/errors/domain.error';
import { ItemOrcamentoPayload } from '@shared/messaging/messages';

export enum OrcamentoStatus {
  GERADO = 'GERADO',
  APROVADO = 'APROVADO',
  RECUSADO = 'RECUSADO',
  CANCELADO = 'CANCELADO',
  EXPIRADO = 'EXPIRADO',
}

export interface ClienteOrcamento {
  id: string;
  nome: string;
  email?: string;
  cpfCnpj: string;
}

export interface OrcamentoProps {
  id: string;
  ordemServicoId: string;
  numeroOS: string;
  sagaId: string;
  cliente: ClienteOrcamento;
  itens: ItemOrcamentoPayload[];
  valorTotal: number;
  validadeAte: Date;
  status: OrcamentoStatus;
  motivo?: string;
  aprovadoEm?: Date;
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface NovoOrcamentoInput {
  ordemServicoId: string;
  numeroOS: string;
  sagaId: string;
  cliente: ClienteOrcamento;
  itens: ItemOrcamentoPayload[];
  valorTotal: number;
  validadeAte: string | Date;
}

export const arredondar = (valor: number): number =>
  Math.round((valor + Number.EPSILON) * 100) / 100;

/**
 * Orçamento de uma OS. A precificação é do OS Service: este agregado só valida
 * que o total informado fecha com os itens e registra a decisão do cliente.
 * `GERADO → APROVADO | RECUSADO | CANCELADO | EXPIRADO`; `APROVADO → CANCELADO` (compensação).
 */
export class Orcamento {
  private constructor(private props: OrcamentoProps) {}

  static criar(input: NovoOrcamentoInput, agora: Date = new Date()): Orcamento {
    for (const campo of ['ordemServicoId', 'numeroOS', 'sagaId'] as const) {
      if (!input[campo]) throw new ValidationError(`Campo obrigatório ausente: ${campo}`);
    }
    if (!input.cliente?.id || !input.cliente.nome || !input.cliente.cpfCnpj) {
      throw new ValidationError('Cliente inválido: id, nome e cpfCnpj são obrigatórios');
    }
    if (!Array.isArray(input.itens) || input.itens.length === 0) {
      throw new ValidationError('O orçamento deve ter ao menos um item');
    }
    for (const [i, item] of input.itens.entries()) {
      if (!['SERVICO', 'PECA'].includes(item.tipo) || !item.referenciaId || !item.descricao) {
        throw new ValidationError(
          `Item ${i} inválido: tipo, referenciaId e descricao são obrigatórios`,
        );
      }
      if (!Number.isInteger(item.quantidade) || item.quantidade < 1) {
        throw new ValidationError(`Item ${i} inválido: quantidade deve ser inteira >= 1`);
      }
      if (typeof item.valorUnitario !== 'number' || !(item.valorUnitario >= 0)) {
        throw new ValidationError(`Item ${i} inválido: valorUnitario deve ser >= 0`);
      }
    }
    const soma = arredondar(input.itens.reduce((t, i) => t + i.quantidade * i.valorUnitario, 0));
    if (typeof input.valorTotal !== 'number' || Math.abs(soma - input.valorTotal) > 0.01) {
      throw new ValidationError(
        `valorTotal (${input.valorTotal}) não confere com a soma dos itens (${soma})`,
      );
    }
    if (!(soma > 0))
      throw new ValidationError('O valor total do orçamento deve ser maior que zero');
    const validadeAte = new Date(input.validadeAte);
    if (Number.isNaN(validadeAte.getTime())) throw new ValidationError('validadeAte inválida');

    return new Orcamento({
      id: randomUUID(),
      ordemServicoId: input.ordemServicoId,
      numeroOS: input.numeroOS,
      sagaId: input.sagaId,
      cliente: input.cliente,
      itens: input.itens,
      valorTotal: soma,
      validadeAte,
      status: OrcamentoStatus.GERADO,
      criadoEm: agora,
      atualizadoEm: agora,
    });
  }

  static restaurar(props: OrcamentoProps): Orcamento {
    return new Orcamento({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get ordemServicoId(): string {
    return this.props.ordemServicoId;
  }
  get numeroOS(): string {
    return this.props.numeroOS;
  }
  get sagaId(): string {
    return this.props.sagaId;
  }
  get cliente(): ClienteOrcamento {
    return this.props.cliente;
  }
  get itens(): ItemOrcamentoPayload[] {
    return this.props.itens;
  }
  get valorTotal(): number {
    return this.props.valorTotal;
  }
  get validadeAte(): Date {
    return this.props.validadeAte;
  }
  get status(): OrcamentoStatus {
    return this.props.status;
  }
  get motivo(): string | undefined {
    return this.props.motivo;
  }
  get aprovadoEm(): Date | undefined {
    return this.props.aprovadoEm;
  }
  get criadoEm(): Date {
    return this.props.criadoEm;
  }
  get atualizadoEm(): Date {
    return this.props.atualizadoEm;
  }

  toProps(): OrcamentoProps {
    return { ...this.props };
  }

  expirado(agora: Date = new Date()): boolean {
    return this.props.validadeAte.getTime() < agora.getTime();
  }

  aprovar(agora: Date = new Date()): void {
    if (this.props.status === OrcamentoStatus.GERADO && this.expirado(agora)) {
      throw new InvalidTransitionError('Orçamento expirado');
    }
    this.transitar([OrcamentoStatus.GERADO], OrcamentoStatus.APROVADO, agora);
    this.props.aprovadoEm = agora;
  }

  recusar(motivo: string | undefined, agora: Date = new Date()): void {
    this.transitar([OrcamentoStatus.GERADO], OrcamentoStatus.RECUSADO, agora);
    this.props.motivo = motivo;
  }

  expirar(agora: Date = new Date()): void {
    this.transitar([OrcamentoStatus.GERADO], OrcamentoStatus.EXPIRADO, agora);
    this.props.motivo = 'Validade do orçamento expirada';
  }

  cancelar(motivo: string, agora: Date = new Date()): void {
    this.transitar(
      [OrcamentoStatus.GERADO, OrcamentoStatus.APROVADO],
      OrcamentoStatus.CANCELADO,
      agora,
    );
    this.props.motivo = motivo;
  }

  private transitar(origens: OrcamentoStatus[], destino: OrcamentoStatus, agora: Date): void {
    if (!origens.includes(this.props.status)) {
      throw new InvalidTransitionError(
        `Transição inválida: ${this.props.status} → ${destino} (orçamento ${this.props.id})`,
      );
    }
    this.props.status = destino;
    this.props.atualizadoEm = agora;
  }
}
