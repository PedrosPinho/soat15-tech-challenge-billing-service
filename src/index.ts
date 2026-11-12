// Precisa ser o primeiro require do processo — o agente New Relic instrumenta módulos
// (http, pg...) ao serem carregados. Sem NEW_RELIC_LICENSE_KEY, o agente fica desabilitado.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('newrelic');

import dotenv from 'dotenv';
import {
  connectDatabase,
  disconnectDatabase,
  getPool,
} from '@infrastructure/database/postgres/pool';
import { createApp } from './app';
import { makeRuntime, Runtime } from '@main/factories/runtime';
import { Subscription } from '@domain/services/message-bus';
import { Destinations } from '@shared/messaging/messages';
import { logger } from '@shared/logger';

dotenv.config();

const PORT = process.env.PORT || 3001;
let runtime: Runtime | undefined;
let subscription: Subscription | undefined;
let httpServer: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;

const startServer = async (): Promise<void> => {
  try {
    await connectDatabase();
    logger.info('Database connected successfully');
    runtime = makeRuntime();
    const app = createApp({
      billingController: runtime.controller,
      readiness: { name: 'database', check: async () => !!(await getPool().query('SELECT 1')) },
    });
    httpServer = app.listen(PORT, () => {
      logger.info({ port: PORT }, 'Server running');
    });
    // MESSAGING_ENABLED=false roda só a API (útil para depurar sem filas).
    if (process.env.MESSAGING_ENABLED !== 'false') {
      const rt = runtime;
      rt.relay.start();
      subscription = await rt.bus.subscribe(Destinations.BillingCommands, (envelope) =>
        rt.commandHandler.handle(envelope),
      );
      logger.info('Consumidor de billing-commands e outbox relay iniciados');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
};

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Signal received: closing server');
  httpServer?.close();
  await subscription?.stop();
  await runtime?.relay.stop();
  await disconnectDatabase();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void startServer();
