/**
 * Pagamentos (Mercado Pago Checkout Pro). O índice parcial único garante no máximo
 * um pagamento "vivo" (PENDENTE ou CONFIRMADO) por orçamento, mesmo com
 * `SolicitarPagamento` duplicado/concorrente.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('pagamentos', {
    id: { type: 'uuid', primaryKey: true },
    orcamento_id: { type: 'uuid', notNull: true, references: 'orcamentos' },
    ordem_servico_id: { type: 'varchar(64)', notNull: true },
    saga_id: { type: 'varchar(64)', notNull: true },
    valor: { type: 'numeric(12,2)', notNull: true },
    status: { type: 'varchar(20)', notNull: true },
    mp_preference_id: { type: 'varchar(100)', notNull: true },
    init_point: { type: 'text', notNull: true },
    expira_em: { type: 'timestamptz', notNull: true },
    mp_payment_id: { type: 'varchar(40)' },
    mp_refund_id: { type: 'varchar(40)' },
    motivo: { type: 'text' },
    confirmado_em: { type: 'timestamptz' },
    criado_em: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    atualizado_em: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'pagamentos',
    'pagamentos_status_chk',
    "CHECK (status IN ('PENDENTE','CONFIRMADO','RECUSADO','ESTORNADO'))",
  );
  pgm.createIndex('pagamentos', 'ordem_servico_id');
  pgm.createIndex('pagamentos', 'mp_payment_id');
  pgm.sql(
    `CREATE UNIQUE INDEX pagamentos_ativo_por_orcamento_idx ON pagamentos (orcamento_id)
       WHERE status IN ('PENDENTE','CONFIRMADO')`,
  );
};

exports.down = (pgm) => {
  pgm.dropTable('pagamentos');
};
