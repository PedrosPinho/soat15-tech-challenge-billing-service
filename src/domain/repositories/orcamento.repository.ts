import { Orcamento } from '@domain/entities/orcamento.entity';

export interface IOrcamentoRepository {
  /** `lock` = `SELECT … FOR UPDATE` (dentro de uma transação). */
  findById(id: string, lock?: boolean): Promise<Orcamento | null>;
  findByOrdemServicoId(ordemServicoId: string, lock?: boolean): Promise<Orcamento | null>;
  insert(orcamento: Orcamento): Promise<void>;
  update(orcamento: Orcamento): Promise<void>;
}
