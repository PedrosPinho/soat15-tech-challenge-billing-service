import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { correlationIdMiddleware } from '@presentation/middlewares/correlation-id.middleware';
import { errorHandler } from '@presentation/middlewares/error.middleware';
import { createHealthRouter, ReadinessProbe } from '@presentation/routes/health.routes';
import { swaggerSpec, swaggerUiOptions, DOCS_PATH } from './swagger';

export interface AppDependencies {
  /** Dependência cuja conectividade define a readiness do pod (banco, DynamoDB...). */
  readiness?: ReadinessProbe;
}

/**
 * Monta a aplicação Express sem abrir porta nem conectar a nada — facilita os
 * testes (supertest) e deixa o bootstrap (conexões, relays, consumidores) em
 * `src/index.ts`. As rotas de negócio de cada etapa do plano são registradas aqui.
 */
export const createApp = (deps: AppDependencies = {}): Application => {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
  app.use(correlationIdMiddleware);
  app.use(
    '/api',
    rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
      limit: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
      message: 'Too many requests from this IP, please try again later.',
    }),
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(DOCS_PATH, swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
  app.get(`${DOCS_PATH}.json`, (_req, res) => res.json(swaggerSpec));

  app.use('/health', createHealthRouter(deps.readiness));

  app.use(errorHandler);
  return app;
};
