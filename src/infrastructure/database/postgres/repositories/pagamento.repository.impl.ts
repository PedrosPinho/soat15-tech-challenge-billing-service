import { Pool } from 'pg';
import { Pagamento, PagamentoProps, PagamentoStatus } from '@domain/entities/pagamento.entity';
import { IPagamentoRepository, ResumoFinanceiro } from '@domain/repositories/pagamento.repository';
import { txAwarePool } from '../unit-of-work';

interface PagamentoRow {
  id: string;
  orcamento_id: string;
  ordem_servico_id: string;
  saga_id: string;
  valor: string;
  status: PagamentoStatus;
  mp_preference_id: string;
  init_point: string;
  expira_em: Date;
  mp_payment_id: string | null;
  mp_refund_id: string | null;
  motivo: string | null;
  confirmado_em: Date | null;
  criado_em: Date;
  atualizado_em: Date;
}

const toEntity = (r: PagamentoRow): Pagamento => {
  const props: PagamentoProps = {
    id: r.id,
    orcamentoId: r.orcamento_id,
    ordemServicoId: r.ordem_servico_id,
    sagaId: r.saga_id,
    valor: Number(r.valor),
    status: r.status,
    mpPreferenceId: r.mp_preference_id,
    initPoint: r.init_point,
    expiraEm: r.expira_em,
    mpPaymentId: r.mp_payment_id ?? undefined,
    mpRefundId: r.mp_refund_id ?? undefined,
    motivo: r.motivo ?? undefined,
    confirmadoEm: r.confirmado_em ?? undefined,
    criadoEm: r.criado_em,
    atualizadoEm: r.atualizado_em,
  };
  return Pagamento.restaurar(props);
};

export class PostgresPagamentoRepository implements IPagamentoRepository {
  constructor(private readonly pool: Pool = txAwarePool()) {}

  findById(id: string, lock = false): Promise<Pagamento | null> {
    return this.findOne('WHERE id = $1', [id], lock);
  }

  findByMpPaymentId(mpPaymentId: string): Promise<Pagamento | null> {
    return this.findOne('WHERE mp_payment_id = $1', [mpPaymentId], false);
  }

  findAtivoByOrcamentoId(orcamentoId: string, lock = false): Promise<Pagamento | null> {
    return this.findOne(
      "WHERE orcamento_id = $1 AND status IN ('PENDENTE','CONFIRMADO')",
      [orcamentoId],
      lock,
    );
  }

  findUltimoByOrcamentoId(orcamentoId: string, lock = false): Promise<Pagamento | null> {
    return this.findOne(
      'WHERE orcamento_id = $1 ORDER BY criado_em DESC LIMIT 1',
      [orcamentoId],
      lock,
    );
  }

  async listarPorOrdemServico(ordemServicoId: string): Promise<Pagamento[]> {
    const { rows } = await this.pool.query<PagamentoRow>(
      'SELECT * FROM pagamentos WHERE ordem_servico_id = $1 ORDER BY criado_em',
      [ordemServicoId],
    );
    return rows.map(toEntity);
  }

  async insert(p: Pagamento): Promise<void> {
    await this.pool.query(
      `INSERT INTO pagamentos (id, orcamento_id, ordem_servico_id, saga_id, valor, status,
         mp_preference_id, init_point, expira_em, mp_payment_id, mp_refund_id, motivo,
         confirmado_em, criado_em, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        p.id,
        p.orcamentoId,
        p.ordemServicoId,
        p.sagaId,
        p.valor,
        p.status,
        p.mpPreferenceId,
        p.initPoint,
        p.expiraEm,
        p.mpPaymentId ?? null,
        p.mpRefundId ?? null,
        p.motivo ?? null,
        p.confirmadoEm ?? null,
        p.criadoEm,
        p.atualizadoEm,
      ],
    );
  }

  async update(p: Pagamento): Promise<void> {
    await this.pool.query(
      `UPDATE pagamentos SET status = $2, mp_payment_id = $3, mp_refund_id = $4, motivo = $5,
         confirmado_em = $6, atualizado_em = $7
        WHERE id = $1`,
      [
        p.id,
        p.status,
        p.mpPaymentId ?? null,
        p.mpRefundId ?? null,
        p.motivo ?? null,
        p.confirmadoEm ?? null,
        p.atualizadoEm,
      ],
    );
  }

  async resumo(): Promise<ResumoFinanceiro> {
    const { rows } = await this.pool.query<{
      confirmados: string;
      receita: string;
      estornados: string;
      estornado: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'CONFIRMADO') AS confirmados,
         COALESCE(SUM(valor) FILTER (WHERE status = 'CONFIRMADO'), 0) AS receita,
         COUNT(*) FILTER (WHERE status = 'ESTORNADO') AS estornados,
         COALESCE(SUM(valor) FILTER (WHERE status = 'ESTORNADO'), 0) AS estornado
       FROM pagamentos`,
    );
    const r = rows[0];
    return {
      receitaTotal: Number(r.receita),
      totalEstornado: Number(r.estornado),
      pagamentosConfirmados: Number(r.confirmados),
      pagamentosEstornados: Number(r.estornados),
    };
  }

  private async findOne(
    clause: string,
    params: unknown[],
    lock: boolean,
  ): Promise<Pagamento | null> {
    // FOR UPDATE vem depois de ORDER BY/LIMIT no SQL.
    const { rows } = await this.pool.query<PagamentoRow>(
      `SELECT * FROM pagamentos ${clause}${lock ? ' FOR UPDATE' : ''}`,
      params,
    );
    return rows[0] ? toEntity(rows[0]) : null;
  }
}
