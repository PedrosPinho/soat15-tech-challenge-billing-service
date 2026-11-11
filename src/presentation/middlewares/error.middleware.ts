import { Request, Response, NextFunction } from 'express';
import {
  DomainError,
  NotFoundError,
  ValidationError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
} from '@shared/errors/domain.error';
import { logger } from '@shared/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational: boolean = true,
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof UnauthorizedError) {
    res.status(401).json({ status: 'error', message: err.message });
    return;
  }

  if (err instanceof ForbiddenError) {
    res.status(403).json({ status: 'error', message: err.message });
    return;
  }

  if (err instanceof NotFoundError) {
    res.status(404).json({ status: 'error', message: err.message });
    return;
  }

  if (err instanceof ValidationError || err instanceof ConflictError) {
    res.status(400).json({ status: 'error', message: err.message });
    return;
  }

  if (err instanceof DomainError) {
    res.status(422).json({ status: 'error', message: err.message });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ status: 'error', message: err.message });
    return;
  }

  logger.error({ err }, 'Unexpected error');
  res.status(500).json({ status: 'error', message: 'Internal server error' });
};
