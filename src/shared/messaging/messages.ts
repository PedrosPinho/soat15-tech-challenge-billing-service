import { Envelope } from './envelope';

/** Destinos lógicos; a URL/ARN real vem da configuração do adapter. */
export const Destinations = {
  BillingCommands: 'billing-commands',
  EventosTopic: 'oficina-eventos',
} as const;

// ---- Comandos consumidos (OS -> Billing) -----------------------------------
// Contrato: docs/architecture/contratos-mensagens.md (seção 3.2) no OS Service.

export interface ItemOrcamentoPayload {
  tipo: 'SERVICO' | 'PECA';
  referenciaId: string;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
}
export interface GerarOrcamentoPayload {
  ordemServicoId: string;
  numeroOS: string;
  cliente: { id: string; nome: string; email?: string; cpfCnpj: string };
  itens: ItemOrcamentoPayload[];
  valorTotal: number;
  validadeAte: string;
}
export interface CancelarOrcamentoPayload {
  ordemServicoId: string;
  orcamentoId?: string;
  motivo: string;
}
export interface SolicitarPagamentoPayload {
  ordemServicoId: string;
  orcamentoId: string;
}
export interface EstornarPagamentoPayload {
  ordemServicoId: string;
  pagamentoId: string;
  motivo: string;
}

// ---- Eventos publicados (Billing -> oficina-eventos) -----------------------

export interface OrcamentoGeradoPayload {
  ordemServicoId: string;
  orcamentoId: string;
  valorTotal: number;
  validadeAte: string;
}
export interface OrcamentoFalhouPayload {
  ordemServicoId: string;
  motivo: string;
}
export interface OrcamentoAprovadoPayload {
  ordemServicoId: string;
  orcamentoId: string;
  aprovadoEm: string;
}
export interface OrcamentoRecusadoPayload {
  ordemServicoId: string;
  orcamentoId: string;
  motivo?: string;
}
export interface OrcamentoCanceladoPayload {
  ordemServicoId: string;
  orcamentoId?: string;
}
export interface PagamentoSolicitadoPayload {
  ordemServicoId: string;
  orcamentoId: string;
  pagamentoId: string;
  initPoint: string;
  expiraEm: string;
}
export interface PagamentoConfirmadoPayload {
  ordemServicoId: string;
  orcamentoId: string;
  pagamentoId: string;
  mpPaymentId: string;
  valor: number;
  confirmadoEm: string;
}
export interface PagamentoRecusadoPayload {
  ordemServicoId: string;
  orcamentoId: string;
  pagamentoId?: string;
  motivo: string;
}
export interface PagamentoEstornadoPayload {
  ordemServicoId: string;
  pagamentoId: string;
  mpRefundId: string;
}
export interface EstornoFalhouPayload {
  ordemServicoId: string;
  pagamentoId: string;
  motivo: string;
}

export interface MessageCatalog {
  GerarOrcamento: GerarOrcamentoPayload;
  CancelarOrcamento: CancelarOrcamentoPayload;
  SolicitarPagamento: SolicitarPagamentoPayload;
  EstornarPagamento: EstornarPagamentoPayload;
  OrcamentoGerado: OrcamentoGeradoPayload;
  OrcamentoFalhou: OrcamentoFalhouPayload;
  OrcamentoAprovado: OrcamentoAprovadoPayload;
  OrcamentoRecusado: OrcamentoRecusadoPayload;
  OrcamentoCancelado: OrcamentoCanceladoPayload;
  PagamentoSolicitado: PagamentoSolicitadoPayload;
  PagamentoConfirmado: PagamentoConfirmadoPayload;
  PagamentoRecusado: PagamentoRecusadoPayload;
  PagamentoEstornado: PagamentoEstornadoPayload;
  EstornoFalhou: EstornoFalhouPayload;
}

export type MessageType = keyof MessageCatalog;
export type TypedEnvelope<T extends MessageType> = Envelope<MessageCatalog[T], T>;
