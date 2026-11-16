# Manifests Kubernetes — Billing Service

Namespaces `oficina-homolog` (branch `homolog`) e `oficina-prod` (branch `main`), no EKS
compartilhado de `soat15-tech-challenge-k8s-infra`. O CI troca `namespace: oficina` e
`oficina-ENV` por ambiente.

| Arquivo | Recurso |
|---|---|
| `deployment.yaml` | 1 réplica (HPA 1–2); probes `/health/live` e `/health/ready` (esta consulta o PostgreSQL) |
| `service.yaml` | `ClusterIP` na porta 3003 (o OS chama `http://billing-service:3003/internal/...`) |
| `hpa.yaml` | CPU 70 %, 1–2 réplicas (2+ é seguro: inbox, `FOR UPDATE SKIP LOCKED` no relay) |
| `ingress.yaml` | ALB interno compartilhado (`group oficina-<env>`): `/api/orcamentos` e `/api/pagamentos`. `/internal` **não** é publicado |
| `job-migrate.yaml` | `npm run db:migrate` antes do rollout |
| `configmap.yaml` | Configuração estática |
| `secret.example.yaml` | Chaves esperadas do Secret (o real é montado pelo CI) |

`billing-service-messaging` (ConfigMap) **não é versionado**: o CI o cria com
`BILLING_COMMANDS_QUEUE_URL` e `EVENTS_TOPIC_ARN` (saídas do Terraform).

## Banco e segredos

- Database `oficina_billing` e role `billing_service` na mesma instância RDS (ADR-012), criados
  pelo bootstrap da Etapa 5 (senha em `/soat15-tc/<env>/db/billing-service-password`).
- Mercado Pago: `/soat15-tc/<env>/billing/mp-access-token` e `.../mp-webhook-secret` (SSM,
  publicados à mão — ver PHASE_4_EXECUTION_GUIDE.md, Passo 2).
- `MP_NOTIFICATION_URL` (URL pública do webhook no API Gateway): GitHub Secret, definido após
  o primeiro deploy do API Gateway.
