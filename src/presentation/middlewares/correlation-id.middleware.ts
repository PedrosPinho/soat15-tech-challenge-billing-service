import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { requestContext } from '@shared/logger';

const HEADER = 'x-correlation-id';

/**
 * Lê `x-correlation-id` da requisição (gerado no API Gateway em produção) ou
 * cria um novo, ecoa no response e disponibiliza para todo log da requisição
 * via `AsyncLocalStorage` — ver `@shared/logger`.
 */
export const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.header(HEADER);
  const correlationId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
  res.setHeader(HEADER, correlationId);
  requestContext.run({ correlationId }, next);
};
