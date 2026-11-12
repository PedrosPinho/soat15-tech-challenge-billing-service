import { Pool } from 'pg';
import { Orcamento, OrcamentoProps, OrcamentoStatus } from '@domain/entities/orcamento.entity';
import { IOrcamentoRepository } from '@domain/repositories/orcamento.repository';
import { ItemOrcamentoPayload } from '@shared/messaging/messages';
import { txAwarePool } from '../unit-of-work';

interface OrcamentoRow {
  id: string;
  ordem_servico_id: string;
  numero_os: string;
  saga_id: string;
  cliente_id: string;
  cliente_nome: string;
  cliente_email: string | null;
  cliente_cpf_cnpj: string;
  valor_total: string;
  validade_ate: Date;
  status: OrcamentoStatus;
  motivo: string | null;
  aprovado_em: Date | null;
  criado_em: Date;
  atualizado_em: Date;
}

interface ItemRow {
  tipo: 'SERVICO' | 'PECA';
  referencia_id: string;
  descricao: string;
  quantidade: number;
  valor_unitario: string;
}

export class PostgresOrcamentoRepository implements IOrcamentoRepository {
  constructor(private readonly pool: Pool = txAwarePool()) {}

  findById(id: string, lock = false): Promise<Orcamento | null> {
    return this.findOne('id = $1', id, lock);
  }

  findByOrdemServicoId(ordemServicoId: string, lock = false): Promise<Orcamento | null> {
    return this.findOne('ordem_servico_id = $1', ordemServicoId, lock);
  }

  async insert(o: Orcamento): Promise<void> {
    await this.pool.query(
      `INSERT INTO orcamentos (id, ordem_servico_id, numero_os, saga_id, cliente_id, cliente_nome,
         cliente_email, cliente_cpf_cnpj, valor_total, validade_ate, status, motivo, aprovado_em,
         criado_em, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        o.id,
        o.ordemServicoId,
        o.numeroOS,
        o.sagaId,
        o.cliente.id,
        o.cliente.nome,
        o.cliente.email ?? null,
        o.cliente.cpfCnpj,
        o.valorTotal,
        o.validadeAte,
        o.status,
        o.motivo ?? null,
        o.aprovadoEm ?? null,
        o.criadoEm,
        o.atualizadoEm,
      ],
    );
    for (const item of o.itens) {
      await this.pool.query(
        `INSERT INTO orcamento_itens (orcamento_id, tipo, referencia_id, descricao, quantidade, valor_unitario)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [o.id, item.tipo, item.referenciaId, item.descricao, item.quantidade, item.valorUnitario],
      );
    }
  }

  async update(o: Orcamento): Promise<void> {
    await this.pool.query(
      `UPDATE orcamentos SET status = $2, motivo = $3, aprovado_em = $4, atualizado_em = $5
        WHERE id = $1`,
      [o.id, o.status, o.motivo ?? null, o.aprovadoEm ?? null, o.atualizadoEm],
    );
  }

  private async findOne(where: string, value: string, lock: boolean): Promise<Orcamento | null> {
    const { rows } = await this.pool.query<OrcamentoRow>(
      `SELECT * FROM orcamentos WHERE ${where}${lock ? ' FOR UPDATE' : ''}`,
      [value],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    const { rows: itens } = await this.pool.query<ItemRow>(
      'SELECT tipo, referencia_id, descricao, quantidade, valor_unitario FROM orcamento_itens WHERE orcamento_id = $1 ORDER BY id',
      [row.id],
    );
    return Orcamento.restaurar(toProps(row, itens));
  }
}

const toProps = (r: OrcamentoRow, itens: ItemRow[]): OrcamentoProps => ({
  id: r.id,
  ordemServicoId: r.ordem_servico_id,
  numeroOS: r.numero_os,
  sagaId: r.saga_id,
  cliente: {
    id: r.cliente_id,
    nome: r.cliente_nome,
    email: r.cliente_email ?? undefined,
    cpfCnpj: r.cliente_cpf_cnpj,
  },
  itens: itens.map(
    (i): ItemOrcamentoPayload => ({
      tipo: i.tipo,
      referenciaId: i.referencia_id,
      descricao: i.descricao,
      quantidade: i.quantidade,
      valorUnitario: Number(i.valor_unitario),
    }),
  ),
  valorTotal: Number(r.valor_total),
  validadeAte: r.validade_ate,
  status: r.status,
  motivo: r.motivo ?? undefined,
  aprovadoEm: r.aprovado_em ?? undefined,
  criadoEm: r.criado_em,
  atualizadoEm: r.atualizado_em,
});
