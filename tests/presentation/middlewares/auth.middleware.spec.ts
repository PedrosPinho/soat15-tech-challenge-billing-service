import { Response, NextFunction } from 'express';
import {
  AuthenticatedRequest,
  authMiddleware,
  requireInternalScope,
} from '@presentation/middlewares/auth.middleware';
import { JwtService } from '@infrastructure/security/jwt.service';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/domain.error';

jest.mock('@infrastructure/security/jwt.service');

const MockJwtService = JwtService as jest.MockedClass<typeof JwtService>;

const makeReq = (authHeader?: string): AuthenticatedRequest =>
  ({
    headers: authHeader ? { authorization: authHeader } : {},
  }) as AuthenticatedRequest;

const res = {} as Response;
const next = jest.fn() as NextFunction;

beforeEach(() => jest.clearAllMocks());

describe('authMiddleware', () => {
  it('calls next(err) when no Authorization header', () => {
    authMiddleware(makeReq(), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('calls next(err) when Authorization does not start with Bearer', () => {
    authMiddleware(makeReq('Basic abc'), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('sets scope=interno, userId e userEmail on valid token', () => {
    MockJwtService.fromEnv = jest.fn().mockReturnValue({
      verify: jest.fn().mockReturnValue({ sub: 'u1', email: 'test@test.com', scope: 'interno' }),
    });

    const req = makeReq('Bearer valid.token.here');
    authMiddleware(req, res, next);

    expect(req.scope).toBe('interno');
    expect(req.userId).toBe('u1');
    expect(req.userEmail).toBe('test@test.com');
    expect(req.clienteId).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it('sets scope=cliente, clienteId e cpfCnpj on valid client token', () => {
    MockJwtService.fromEnv = jest.fn().mockReturnValue({
      verify: jest.fn().mockReturnValue({ sub: 'c1', cpf: '52998224725', scope: 'cliente' }),
    });

    const req = makeReq('Bearer valid.client.token');
    authMiddleware(req, res, next);

    expect(req.scope).toBe('cliente');
    expect(req.clienteId).toBe('c1');
    expect(req.cpfCnpj).toBe('52998224725');
    expect(req.userId).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(err) when token verification throws', () => {
    const error = new Error('invalid token');
    MockJwtService.fromEnv = jest.fn().mockReturnValue({
      verify: jest.fn().mockImplementation(() => {
        throw error;
      }),
    });

    authMiddleware(makeReq('Bearer bad.token'), res, next);
    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('requireInternalScope', () => {
  it('calls next() when scope is interno', () => {
    const req = { scope: 'interno' } as AuthenticatedRequest;
    requireInternalScope(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(ForbiddenError) when scope is cliente', () => {
    const req = { scope: 'cliente' } as AuthenticatedRequest;
    requireInternalScope(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it('calls next(ForbiddenError) when scope is undefined', () => {
    const req = {} as AuthenticatedRequest;
    requireInternalScope(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });
});
