/**
 * Orçamentos e seus itens. Os ids de outros serviços (ordem de serviço, cliente,
 * serviço/peça) são varchar sem FK: este banco é só do Billing (ADR-012).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('orcamentos', {
    id: { type: 'uuid', primaryKey: true },
    ordem_servico_id: { type: 'varchar(64)', notNull: true, unique: true },
    numero_os: { type: 'varchar(40)', notNull: true },
    saga_id: { type: 'varchar(64)', notNull: true },
    cliente_id: { type: 'varchar(64)', notNull: true },
    cliente_nome: { type: 'varchar(200)', notNull: true },
    cliente_email: { type: 'varchar(200)' },
    cliente_cpf_cnpj: { type: 'varchar(20)', notNull: true },
    valor_total: { type: 'numeric(12,2)', notNull: true },
    validade_ate: { type: 'timestamptz', notNull: true },
    status: { type: 'varchar(20)', notNull: true },
    motivo: { type: 'text' },
    aprovado_em: { type: 'timestamptz' },
    criado_em: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    atualizado_em: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'orcamentos',
    'orcamentos_status_chk',
    "CHECK (status IN ('GERADO','APROVADO','RECUSADO','CANCELADO','EXPIRADO'))",
  );
  pgm.createIndex('orcamentos', 'cliente_id');

  pgm.createTable('orcamento_itens', {
    id: { type: 'serial', primaryKey: true },
    orcamento_id: { type: 'uuid', notNull: true, references: 'orcamentos', onDelete: 'CASCADE' },
    tipo: { type: 'varchar(10)', notNull: true },
    referencia_id: { type: 'varchar(64)', notNull: true },
    descricao: { type: 'varchar(300)', notNull: true },
    quantidade: { type: 'integer', notNull: true },
    valor_unitario: { type: 'numeric(12,2)', notNull: true },
  });
  pgm.createIndex('orcamento_itens', 'orcamento_id');
};

exports.down = (pgm) => {
  pgm.dropTable('orcamento_itens');
  pgm.dropTable('orcamentos');
};
