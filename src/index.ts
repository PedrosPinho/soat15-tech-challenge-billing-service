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
import { logger } from '@shared/logger';

dotenv.config();

const PORT = process.env.PORT || 3001;
const app = createApp({
  readiness: { name: 'database', check: async () => !!(await getPool().query('SELECT 1')) },
});

let httpServer: ReturnType<typeof app.listen> | undefined;

const startServer = async (): Promise<void> => {
  try {
    await connectDatabase();
    logger.info('Database connected successfully');
    httpServer = app.listen(PORT, () => {
      logger.info({ port: PORT }, 'Server running');
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
};

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Signal received: closing server');
  httpServer?.close();
  await disconnectDatabase();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void startServer();
