import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '@shared/errors/domain.error';

/**
 * Protege `/internal/*` (chamadas serviço-a-serviço, ex.: Lambda de auth).
 * Essas rotas não são expostas pelo API Gateway; o token é defesa em
 * profundidade. Comparação em tempo constante.
 */
export const internalTokenMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  const expected = process.env.INTERNAL_API_TOKEN;
  const received = req.header('x-internal-token');
  if (!expected || !received) {
    return next(new UnauthorizedError('Token interno ausente ou inválido'));
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return next(new UnauthorizedError('Token interno ausente ou inválido'));
  }
  next();
};
