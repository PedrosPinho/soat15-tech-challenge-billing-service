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
  tags: [
    { name: 'Health', description: 'Saúde do serviço' },
    { name: 'Orçamentos', description: 'Orçamento da OS: consulta, aprovação e recusa' },
    { name: 'Pagamentos', description: 'Pagamento via Mercado Pago (Checkout Pro)' },
    {
      name: 'Internal',
      description: 'Serviço-a-serviço (`x-internal-token`); fora do API Gateway',
    },
  ],
  components: {
    schemas: {
      ItemOrcamento: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['SERVICO', 'PECA'] },
          referenciaId: { type: 'string' },
          descricao: { type: 'string' },
          quantidade: { type: 'integer', minimum: 1 },
          valorUnitario: { type: 'number', example: 250.0 },
        },
      },
      Pagamento: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          orcamentoId: { type: 'string', format: 'uuid' },
          ordemServicoId: { type: 'string' },
          valor: { type: 'number', example: 610.0 },
          status: { type: 'string', enum: ['PENDENTE', 'CONFIRMADO', 'RECUSADO', 'ESTORNADO'] },
          initPoint: {
            type: 'string',
            description: 'URL do Checkout Pro (sandbox em credencial de teste)',
          },
          expiraEm: { type: 'string', format: 'date-time' },
          mpPaymentId: { type: 'string' },
          mpRefundId: { type: 'string' },
          motivo: { type: 'string' },
          confirmadoEm: { type: 'string', format: 'date-time' },
        },
      },
      Orcamento: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          ordemServicoId: { type: 'string' },
          numeroOS: { type: 'string', example: 'OS-20261111-0007' },
          cliente: {
            type: 'object',
            properties: { id: { type: 'string' }, nome: { type: 'string' } },
          },
          itens: { type: 'array', items: { $ref: '#/components/schemas/ItemOrcamento' } },
          valorTotal: { type: 'number', example: 610.0 },
          validadeAte: { type: 'string', format: 'date-time' },
          status: {
            type: 'string',
            enum: ['GERADO', 'APROVADO', 'RECUSADO', 'CANCELADO', 'EXPIRADO'],
          },
          motivo: { type: 'string' },
          aprovadoEm: { type: 'string', format: 'date-time' },
          pagamento: { allOf: [{ $ref: '#/components/schemas/Pagamento' }], nullable: true },
        },
      },
      Motivo: { type: 'object', properties: { motivo: { type: 'string', maxLength: 500 } } },
      DecisaoExterna: {
        type: 'object',
        required: ['aprovado'],
        properties: { aprovado: { type: 'boolean' }, motivo: { type: 'string' } },
      },
    },
    securitySchemes: {
      internalToken: { type: 'apiKey', in: 'header', name: 'x-internal-token' },
      webhookSecret: { type: 'apiKey', in: 'header', name: 'x-webhook-secret' },
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
    '/api/orcamentos': {
      get: {
        tags: ['Orçamentos'],
        summary: 'Orçamento de uma OS',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'ordemServicoId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Orçamento (com o pagamento e o `initPoint`, se houver)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Orcamento' } } },
          },
          '403': { description: 'Orçamento de outro cliente' },
          '404': { description: 'Não encontrado' },
        },
      },
    },
    '/api/orcamentos/{id}': {
      get: {
        tags: ['Orçamentos'],
        summary: 'Consulta o orçamento',
        description:
          'Cliente só enxerga o próprio; interno enxerga todos. Inclui o pagamento mais recente com o `initPoint` do checkout.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Orçamento',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Orcamento' } } },
          },
          '403': { description: 'Orçamento de outro cliente' },
          '404': { description: 'Não encontrado' },
        },
      },
    },
    '/api/orcamentos/{id}/aprovar': {
      post: {
        tags: ['Orçamentos'],
        summary: 'Aprova o orçamento',
        description:
          'GERADO → APROVADO e publica `OrcamentoAprovado` (a Saga então pede o pagamento). Idempotente. Orçamento vencido vira EXPIRADO (422) e a Saga é compensada.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Aprovado' },
          '403': { description: 'Orçamento de outro cliente' },
          '404': { description: 'Não encontrado' },
          '422': { description: 'Estado inválido ou orçamento expirado' },
        },
      },
    },
    '/api/orcamentos/{id}/recusar': {
      post: {
        tags: ['Orçamentos'],
        summary: 'Recusa o orçamento',
        description:
          'GERADO → RECUSADO e publica `OrcamentoRecusado` (a Saga compensa e cancela a OS).',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Motivo' } } },
        },
        responses: {
          '200': { description: 'Recusado' },
          '403': { description: 'Orçamento de outro cliente' },
          '404': { description: 'Não encontrado' },
          '422': { description: 'Estado inválido' },
        },
      },
    },
    '/api/orcamentos/{id}/webhook': {
      post: {
        tags: ['Orçamentos'],
        summary: 'Aprovação/recusa por sistema externo',
        description:
          'Autenticada pelo segredo compartilhado `x-webhook-secret` (herdado do monólito).',
        security: [{ webhookSecret: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/DecisaoExterna' } },
          },
        },
        responses: {
          '200': { description: 'Decisão aplicada' },
          '400': { description: 'Corpo inválido' },
          '401': { description: 'Segredo inválido' },
        },
      },
    },
    '/api/pagamentos': {
      get: {
        tags: ['Pagamentos'],
        summary: 'Pagamentos de uma OS',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'ordemServicoId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Lista de pagamentos' },
          '400': { description: 'ordemServicoId ausente' },
          '403': { description: 'OS de outro cliente' },
        },
      },
    },
    '/api/pagamentos/webhooks/mercadopago': {
      post: {
        tags: ['Pagamentos'],
        summary: 'Webhook do Mercado Pago (público)',
        description:
          'Valida a assinatura `x-signature` (HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com o secret do webhook). O corpo nunca é confiado: o estado vem de `GET /v1/payments/:id`. Responde 200 rápido e é idempotente.',
        parameters: [
          { name: 'data.id', in: 'query', schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string', example: 'payment' } },
          { name: 'x-signature', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'x-request-id', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Processada ou ignorada' },
          '401': { description: 'Assinatura inválida' },
          '500': { description: 'Falha ao consultar o MP (o MP reenvia)' },
        },
      },
    },
    '/internal/financeiro/resumo': {
      get: {
        tags: ['Internal'],
        summary: 'Resumo financeiro (receita total)',
        description: 'Consumido pelo OS Service no dashboard (`receitaTotal`).',
        security: [{ internalToken: [] }],
        responses: {
          '200': {
            description:
              '{ receitaTotal, totalEstornado, pagamentosConfirmados, pagamentosEstornados }',
          },
          '401': { description: 'Token interno inválido' },
        },
      },
    },
    '/internal/dev/mercadopago/pagamentos': {
      post: {
        tags: ['Internal'],
        summary: '[dev] Simula um pagamento no gateway fake',
        description:
          'Só existe com `PAYMENT_GATEWAY=fake` (smoke local). Depois use `/internal/pagamentos/{id}/sincronizar`.',
        security: [{ internalToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['mpPaymentId', 'status', 'orcamentoId', 'valor'],
                properties: {
                  mpPaymentId: { type: 'string' },
                  status: { type: 'string', example: 'approved' },
                  orcamentoId: { type: 'string' },
                  valor: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Pagamento simulado' },
          '400': { description: 'Corpo inválido' },
          '401': { description: 'Token interno inválido' },
        },
      },
    },
    '/internal/pagamentos/{id}/sincronizar': {
      post: {
        tags: ['Internal'],
        summary: 'Reconcilia o pagamento com o Mercado Pago',
        description:
          'Use quando o webhook se perdeu: consulta o MP por `external_reference` e aplica o resultado.',
        security: [{ internalToken: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Resultado + pagamento atualizado' },
          '401': { description: 'Token interno inválido' },
          '404': { description: 'Pagamento não encontrado' },
        },
      },
    },
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
