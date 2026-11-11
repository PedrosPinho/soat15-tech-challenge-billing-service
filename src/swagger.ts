export const DOCS_PATH = process.env.DOCS_PATH ?? '/api/orcamentos/docs';

export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Billing Service — Oficina',
    description: 'Orçamento e pagamento das ordens de serviço (integração com o Mercado Pago).',
    version: '1.0.0',
    contact: { name: 'Tech Challenge SOAT FIAP' },
  },
  servers: [{ url: 'http://localhost:3003', description: 'Desenvolvimento local' }],
  tags: [{ name: 'Health', description: 'Saúde do serviço' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'JWT assinado com o JWT_SECRET compartilhado (RFC-003): `scope: interno` (usuários da oficina) ou `scope: cliente` (emitido pela Lambda de CPF).',
      },
    },
  },
  paths: {
    '/health/live': {
      get: {
        tags: ['Health'],
        summary: 'Liveness — o processo está vivo',
        responses: { '200': { description: 'UP' } },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness — dependências alcançáveis',
        responses: { '200': { description: 'UP' }, '503': { description: 'DOWN' } },
      },
    },
  },
};

export const swaggerUiOptions = {
  customSiteTitle: 'Billing Service — API Docs',
};
