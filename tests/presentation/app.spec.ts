import request from 'supertest';
import { createApp } from '../../src/app';
import { DOCS_PATH } from '../../src/swagger';

describe('createApp', () => {
  it('gera x-correlation-id quando ausente e ecoa o recebido', async () => {
    const app = createApp();
    const gerado = await request(app).get('/health/live');
    expect(gerado.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);

    const recebido = await request(app).get('/health/live').set('x-correlation-id', 'abc-123');
    expect(recebido.headers['x-correlation-id']).toBe('abc-123');
  });

  it('publica o spec OpenAPI em JSON', async () => {
    const res = await request(createApp()).get(`${DOCS_PATH}.json`);
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.paths).toHaveProperty('/health/live');
  });

  it('rota inexistente responde 404 (handler padrão do Express)', async () => {
    const res = await request(createApp()).get('/nao-existe');
    expect(res.status).toBe(404);
  });
});
