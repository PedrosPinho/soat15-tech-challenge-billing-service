/**
 * Transactional outbox (mensagens a publicar, gravadas na mesma transação da
 * mudança de estado) e inbox (`mensagens_processadas`, deduplicação por
 * `messageId`) — ADR-010.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('outbox', {
    id: { type: 'uuid', primaryKey: true },
    tipo_destino: { type: 'varchar(5)', notNull: true }, // 'queue' | 'topic'
    destino: { type: 'varchar(120)', notNull: true },
    tipo_mensagem: { type: 'varchar(60)', notNull: true },
    envelope: { type: 'jsonb', notNull: true },
    tentativas: { type: 'integer', notNull: true, default: 0 },
    ultimo_erro: { type: 'text' },
    proxima_tentativa_em: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    publicado_em: { type: 'timestamptz' },
    criado_em: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.sql(
    `CREATE INDEX outbox_pendentes_idx ON outbox (proxima_tentativa_em, criado_em)
       WHERE publicado_em IS NULL`,
  );

  pgm.createTable('mensagens_processadas', {
    message_id: { type: 'uuid', primaryKey: true },
    tipo: { type: 'varchar(60)', notNull: true },
    processado_em: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('mensagens_processadas');
  pgm.dropTable('outbox');
};
