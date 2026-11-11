import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@infrastructure/security/jwt.service';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/domain.error';

export interface AuthenticatedRequest extends Request {
  scope?: 'interno' | 'cliente';
  userId?: string;
  userEmail?: string;
  clienteId?: string;
  cpfCnpj?: string;
}

/**
 * Aceita os dois tipos de token emitidos no ecossistema (RFC-003): o interno
 * (`POST /api/auth/login`, e-mail/senha) e o de cliente por CPF (emitido pela
 * Lambda de `soat15-tech-challenge-auth-lambda`, nunca por esta aplicação).
 * Valida a assinatura localmente mesmo quando a requisição já passou pelo
 * Lambda Authorizer na borda — defesa em profundidade, este middleware não
 * confia apenas no API Gateway.
 *
 * Só verifica que o token é válido e popula os dados do escopo no request;
 * não decide autorização — isso é papel de `requireInternalScope` (ou de
 * checagens específicas de rota, como a de CPF próprio em `/buscar`).
 */
export const authMiddleware = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header'));
  }

  const token = authHeader.split(' ')[1];
  try {
    const jwtService = JwtService.fromEnv();
    const payload = jwtService.verify(token);

    if (payload.scope === 'cliente') {
      req.scope = 'cliente';
      req.clienteId = payload.sub;
      req.cpfCnpj = payload.cpf;
    } else {
      req.scope = 'interno';
      req.userId = payload.sub;
      req.userEmail = payload.email;
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Encadear depois de `authMiddleware` nas rotas de gestão (peças, catálogo,
 * relatórios, criação/gestão de OS etc.) — um token de cliente válido, mas de
 * escopo errado, é uma requisição autenticada porém sem privilégio, daí 403
 * (`ForbiddenError`), não 401.
 */
export const requireInternalScope = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void => {
  if (req.scope !== 'interno') {
    return next(new ForbiddenError('Rota restrita a usuários internos'));
  }
  next();
};
