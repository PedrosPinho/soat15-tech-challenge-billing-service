import { logger, requestContext } from '@shared/logger';

describe('logger', () => {
  it('loga sem contexto de requisição', () => {
    expect(() => logger.info({ a: 1 }, 'sem contexto')).not.toThrow();
    expect(() => logger.warn('w')).not.toThrow();
    expect(() => logger.error('e')).not.toThrow();
    expect(() => logger.debug('d')).not.toThrow();
  });

  it('loga dentro de um contexto com correlationId', () => {
    requestContext.run({ correlationId: 'x' }, () => {
      expect(() => logger.info('com contexto')).not.toThrow();
    });
  });
});
