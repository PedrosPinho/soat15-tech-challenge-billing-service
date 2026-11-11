import { Request, Response, NextFunction } from 'express';
import { errorHandler, AppError } from '@presentation/middlewares/error.middleware';
import {
  DomainError,
  NotFoundError,
  ValidationError,
  ConflictError,
  UnauthorizedError,
} from '@shared/errors/domain.error';

const makeRes = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
};

const req = {} as Request;
const next = jest.fn() as NextFunction;

describe('errorHandler middleware', () => {
  it('handles UnauthorizedError with 401', () => {
    const res = makeRes();
    errorHandler(new UnauthorizedError('unauthorized'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', message: 'unauthorized' });
  });

  it('handles NotFoundError with 404', () => {
    const res = makeRes();
    errorHandler(new NotFoundError('not found'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', message: 'not found' });
  });

  it('handles ValidationError with 400', () => {
    const res = makeRes();
    errorHandler(new ValidationError('bad input'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', message: 'bad input' });
  });

  it('handles ConflictError with 400', () => {
    const res = makeRes();
    errorHandler(new ConflictError('conflict'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', message: 'conflict' });
  });

  it('handles generic DomainError with 422', () => {
    const res = makeRes();
    errorHandler(new DomainError('domain err'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', message: 'domain err' });
  });

  it('handles AppError with its statusCode', () => {
    const res = makeRes();
    errorHandler(new AppError(409, 'app error'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', message: 'app error' });
  });

  it('handles unknown errors with 500', () => {
    const res = makeRes();
    errorHandler(new Error('boom'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', message: 'Internal server error' });
  });
});
