import { timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '@shared/errors/domain.error';

/** Aprovação externa de orçamento (herdada do monólito): segredo compartilhado em `x-webhook-secret`. */
export const webhookSecretMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  const expected = process.env.WEBHOOK_SECRET;
  const received = req.header('x-webhook-secret');
  if (!expected || !received) return next(new UnauthorizedError('Assinatura de webhook inválida'));
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return next(new UnauthorizedError('Assinatura de webhook inválida'));
  }
  next();
};
