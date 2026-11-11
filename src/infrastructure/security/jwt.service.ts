import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '@shared/errors/domain.error';

/**
 * Token de usuário interno da oficina (fluxo `POST /api/auth/login`,
 * e-mail/senha). `email` é conveniência da aplicação — não faz parte do
 * contrato mínimo (`sub`+`scope`) que o Lambda Authorizer de
 * `soat15-tech-challenge-auth-lambda` valida, mas não atrapalha por lá.
 */
export interface InternoTokenPayload {
  sub: string;
  email: string;
  scope: 'interno';
  iat?: number;
  exp?: number;
}

/**
 * Token de cliente por CPF, emitido pela Lambda `POST /auth/token` do
 * repositório `soat15-tech-challenge-auth-lambda` — nunca por esta aplicação.
 * O formato (`sub`, `cpf`, `scope`) precisa bater exatamente com o que o
 * Lambda Authorizer usa (`ClienteTokenClaims`), já que ambos assinam/validam
 * com o mesmo `JWT_SECRET` (defesa em profundidade — ver RFC-003).
 */
export interface ClienteTokenPayload {
  sub: string;
  cpf: string;
  scope: 'cliente';
  iat?: number;
  exp?: number;
}

export type JwtPayload = InternoTokenPayload | ClienteTokenPayload;

export class JwtService {
  constructor(
    private readonly secret: string,
    private readonly expiresIn: string,
  ) {}

  /** Esta aplicação só emite tokens internos — os de cliente vêm da Lambda de CPF. */
  sign(payload: Omit<InternoTokenPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, this.secret, { expiresIn: this.expiresIn } as jwt.SignOptions);
  }

  verify(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.secret) as JwtPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }

  static fromEnv(): JwtService {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not defined');
    return new JwtService(secret, process.env.JWT_EXPIRES_IN ?? '1d');
  }
}
