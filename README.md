# Billing Service — Oficina Mecânica

Orçamento e pagamento das ordens de serviço (integração com o Mercado Pago). Um dos **três microsserviços** da Fase 4 do Tech Challenge SOAT
(FIAP Pós-Tech), ao lado do OS Service
([`soat15-tech-challenge-01`](https://github.com/PedrosPinho/soat15-tech-challenge-01),
orquestrador da Saga) e do Execution Service.

> **Status**: esqueleto (Etapa 1 do [`PHASE_4_PLAN`](https://github.com/PedrosPinho/soat15-tech-challenge-01/blob/main/docs/PHASE_4_PLAN.md)).
> Estão prontos: estrutura DDD, healthchecks, logs com `correlationId`, Swagger,
> Docker, CI (build + testes com cobertura ≥ 80%). Regras de negócio e mensageria entram nas Etapas 4 em diante.

## Responsabilidades

- **Orçamento**: gerar a partir dos itens/preços recebidos do OS Service, enviar ao cliente (e-mail), aprovar/recusar, cancelar (compensação).
- **Pagamento**: criar a preferência de pagamento no **Mercado Pago** (Checkout Pro), receber o webhook, verificar o pagamento no MP, estornar (compensação).
- **Resumo financeiro** para o dashboard do OS Service (`GET /internal/financeiro/resumo`).

## Banco de dados

**PostgreSQL 16** — database `oficina_billing`, role `billing_service`, na mesma instância RDS do OS Service (isolamento lógico, [ADR-012](https://github.com/PedrosPinho/soat15-tech-challenge-01/blob/main/docs/architecture/adrs/ADR-012-isolamento-de-banco-por-database-e-role.md)). Dados transacionais e relacionais (orçamento ↔ itens ↔ pagamento).

Nenhum outro serviço acessa este banco diretamente — dados trafegam por
mensagens e pelas rotas `/internal/*`.

## Comunicação

- **Consome**: `GerarOrcamento`, `CancelarOrcamento`, `SolicitarPagamento`, `EstornarPagamento` (fila `billing-commands`)
- **Publica**: `OrcamentoGerado`, `OrcamentoFalhou`, `OrcamentoAprovado`, `OrcamentoRecusado`, `OrcamentoCancelado`, `PagamentoSolicitado`, `PagamentoConfirmado`, `PagamentoRecusado`, `PagamentoEstornado`, `EstornoFalhou` (tópico SNS `oficina-eventos`)
- Contratos, envelope e regras de consumo (idempotência, DLQ): [`contratos-mensagens.md`](https://github.com/PedrosPinho/soat15-tech-challenge-01/blob/main/docs/architecture/contratos-mensagens.md)
- Saga **orquestrada** pelo OS Service — justificativa em [`ADR-009`](https://github.com/PedrosPinho/soat15-tech-challenge-01/blob/main/docs/architecture/adrs/ADR-009-saga-orquestrada.md) e [`RFC-005`](https://github.com/PedrosPinho/soat15-tech-challenge-01/blob/main/docs/architecture/rfcs/RFC-005-microsservicos-e-saga.md). Este serviço não conhece o fluxo global: recebe comandos e responde com eventos.

## Endpoints (planejados)

| Método | Rota | Escopo | Descrição |
|---|---|---|---|
| GET | `/api/orcamentos/:id` | interno / cliente dono | Orçamento (inclui `initPoint` quando há pagamento) |
| POST | `/api/orcamentos/:id/aprovar` | interno / cliente dono | Aprova |
| POST | `/api/orcamentos/:id/recusar` | interno / cliente dono | Recusa |
| POST | `/api/orcamentos/:id/webhook` | segredo compartilhado | Aprovação externa |
| GET | `/api/pagamentos?ordemServicoId=` | interno | Pagamentos da OS |
| POST | `/api/pagamentos/webhooks/mercadopago` | público (HMAC `x-signature`) | Webhook do Mercado Pago |
| GET | `/internal/financeiro/resumo` | `x-internal-token` | Receita total (usado pelo OS Service) |
| POST | `/internal/pagamentos/:id/sincronizar` | `x-internal-token` | Reconciliação com o MP |

Swagger em `/api/orcamentos/docs` (JSON em `/api/orcamentos/docs.json`). Healthchecks: `GET /health/live`, `GET /health/ready`.

## Arquitetura do serviço

```
src/
├── domain/           # Entidades, value objects, ports (repositórios, mensageria)
├── application/      # Casos de uso, handlers de comandos
├── infrastructure/   # Adapters: banco, SQS/SNS, segurança, notificações
├── presentation/     # Controllers, rotas, middlewares, validators
├── main/             # Composition root
└── shared/           # Erros de domínio, logger (pino + correlationId)
```

## Stack

Node.js 20 · TypeScript (strict) · Express 5 · PostgreSQL 16 (`pg` + `node-pg-migrate`) · SQS/SNS · pino · Jest + Supertest · New Relic · Docker · Kubernetes (EKS)

## Executando localmente

```bash
cp .env.example .env
docker compose up -d postgres localstack   # dependências
npm ci
npm run db:migrate
npm run dev                                # http://localhost:3001
```

Testes: `npm test` · cobertura: `npm run test:coverage` (threshold 80%) · lint: `npm run lint` · tipos: `npm run type-check`.

## Qualidade, CI/CD e cobertura

- CI em GitHub Actions (`.github/workflows/ci-cd.yml`): `Build` (tipos, lint, build) e `Test` (cobertura com threshold de 80%).
- Etapa 8: SonarCloud com quality gate, Terraform do serviço, build/push no ECR e deploy no EKS.
- Evidência de cobertura: _a preencher_ (badge SonarCloud + relatório do CI).
- `main` e `homolog` protegidas: PR obrigatório e status checks `Build` e `Test`.

## Documentação da arquitetura

Documentação geral (diagrama de componentes, Saga, ADRs, RFCs, modelo de dados) no
repositório [`soat15-tech-challenge-01`](https://github.com/PedrosPinho/soat15-tech-challenge-01/tree/main/docs/architecture).
