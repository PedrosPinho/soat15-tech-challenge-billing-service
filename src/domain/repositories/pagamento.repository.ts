import { Pagamento } from '@domain/entities/pagamento.entity';

export interface ResumoFinanceiro {
  receitaTotal: number;
  totalEstornado: number;
  pagamentosConfirmados: number;
  pagamentosEstornados: number;
}

export interface IPagamentoRepository {
  findById(id: string, lock?: boolean): Promise<Pagamento | null>;
  findByMpPaymentId(mpPaymentId: string): Promise<Pagamento | null>;
  /** Pagamento "vivo" (PENDENTE ou CONFIRMADO) do orçamento, se houver. */
  findAtivoByOrcamentoId(orcamentoId: string, lock?: boolean): Promise<Pagamento | null>;
  /** Mais recente do orçamento, em qualquer estado. */
  findUltimoByOrcamentoId(orcamentoId: string, lock?: boolean): Promise<Pagamento | null>;
  listarPorOrdemServico(ordemServicoId: string): Promise<Pagamento[]>;
  insert(pagamento: Pagamento): Promise<void>;
  update(pagamento: Pagamento): Promise<void>;
  resumo(): Promise<ResumoFinanceiro>;
}
