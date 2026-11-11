import { Request, Response } from 'express';
import { correlationIdMiddleware } from '@presentation/middlewares/correlation-id.middleware';
import { requestContext } from '@shared/logger';

const makeRes = () => ({ setHeader: jest.fn() }) as unknown as Response;
const makeReq = (header?: string) =>
  ({ header: (name: string) => (name === 'x-correlation-id' ? header : undefined) }) as Request;

describe('correlationIdMiddleware', () => {
  it('reaproveita o header recebido e o expõe no contexto', (done) => {
    const res = makeRes();
    correlationIdMiddleware(makeReq('  corr-1  '), res, () => {
      expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'corr-1');
      expect(requestContext.getStore()?.correlationId).toBe('corr-1');
      done();
    });
  });

  it('gera um UUID quando o header está ausente ou vazio', (done) => {
    const res = makeRes();
    correlationIdMiddleware(makeReq('   '), res, () => {
      const id = requestContext.getStore()?.correlationId;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', id);
      done();
    });
  });
});
