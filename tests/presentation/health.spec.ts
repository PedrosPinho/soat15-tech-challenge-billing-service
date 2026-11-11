import request from 'supertest';
import { createApp } from '../../src/app';

describe('Health endpoints', () => {
  it('GET /health/live responde UP sem tocar dependências', async () => {
    const res = await request(createApp()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'UP' });
    expect(res.body).toHaveProperty('timestamp');
  });

  it('GET /health/ready responde 200 quando a dependência está alcançável', async () => {
    const app = createApp({ readiness: { name: 'database', check: async () => true } });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'UP', database: 'CONNECTED' });
  });

  it('GET /health/ready responde 503 quando a dependência está fora', async () => {
    const app = createApp({ readiness: { name: 'database', check: async () => false } });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'DOWN', database: 'DISCONNECTED' });
  });

  it('trata exceção na verificação como dependência fora (nunca propaga 500)', async () => {
    const app = createApp({
      readiness: {
        name: 'database',
        check: async () => {
          throw new Error('boom');
        },
      },
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
  });

  it('GET /health é alias de /health/ready; sem probe configurada responde 200', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'UP' });
  });
});
