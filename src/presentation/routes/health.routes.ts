import { Router } from 'express';
import { HealthController, ReadinessProbe } from '@presentation/controllers/health.controller';

export type { ReadinessProbe };

export const createHealthRouter = (probe?: ReadinessProbe): Router => {
  const router = Router();
  const controller = new HealthController(probe);
  router.get('/live', (req, res) => controller.live(req, res));
  router.get('/ready', (req, res) => void controller.ready(req, res));
  // Alias de compatibilidade com o padrão da Fase 3.
  router.get('/', (req, res) => void controller.ready(req, res));
  return router;
};
