import { JwtService } from '@infrastructure/security/jwt.service';

describe('JwtService', () => {
  const secret = 'test-secret-key';
  const service = new JwtService(secret, '1h');

  it('should sign and verify an interno token', () => {
    const payload = { sub: 'abc-123', email: 'test@test.com', scope: 'interno' as const };
    const token = service.sign(payload);
    const decoded = service.verify(token);
    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.scope).toBe('interno');
    expect(decoded).toMatchObject({ email: payload.email });
  });

  it('should verify a cliente token signed elsewhere (Lambda, mesmo secret)', () => {
    const jwt = jest.requireActual('jsonwebtoken');
    const token = jwt.sign({ sub: 'cliente-1', cpf: '52998224725', scope: 'cliente' }, secret, {
      expiresIn: '15m',
    });
    const decoded = service.verify(token);
    expect(decoded.sub).toBe('cliente-1');
    expect(decoded.scope).toBe('cliente');
    expect(decoded).toMatchObject({ cpf: '52998224725' });
  });

  it('should throw for invalid token', () => {
    expect(() => service.verify('invalid.token.here')).toThrow();
  });

  it('should throw for tampered token', () => {
    const token = service.sign({ sub: '1', email: 't@t.com', scope: 'interno' });
    expect(() => service.verify(token + 'tampered')).toThrow();
  });
});

describe('JwtService.fromEnv', () => {
  const original = { s: process.env.JWT_SECRET, e: process.env.JWT_EXPIRES_IN };
  afterEach(() => {
    process.env.JWT_SECRET = original.s;
    process.env.JWT_EXPIRES_IN = original.e;
  });

  it('lança sem JWT_SECRET', () => {
    delete process.env.JWT_SECRET;
    expect(() => JwtService.fromEnv()).toThrow('JWT_SECRET is not defined');
  });

  it('constrói a partir do ambiente (expiração padrão 1d)', () => {
    process.env.JWT_SECRET = 'segredo';
    delete process.env.JWT_EXPIRES_IN;
    const svc = JwtService.fromEnv();
    const token = svc.sign({ sub: 'u', email: 'a@b.c', scope: 'interno' });
    expect(svc.verify(token).sub).toBe('u');
  });
});
