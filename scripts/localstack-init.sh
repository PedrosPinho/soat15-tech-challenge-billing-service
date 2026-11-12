#!/bin/bash
# Cria no LocalStack a topologia de terraform/ (fila de comandos + DLQ) e o tópico oficina-eventos
# do OS Service, para testar o fluxo sem AWS. Executado pelo LocalStack no estado "ready".
set -euo pipefail

REGION=us-east-1
name=billing-commands

awslocal sns create-topic --name oficina-eventos --region "$REGION" >/dev/null
awslocal sqs create-queue --queue-name "${name}-dlq" --region "$REGION" >/dev/null
dlq_arn=$(awslocal sqs get-queue-attributes --queue-url "http://localhost:4566/000000000000/${name}-dlq" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)
awslocal sqs create-queue --queue-name "$name" --region "$REGION" \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${dlq_arn}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\",\"ReceiveMessageWaitTimeSeconds\":\"20\"}" >/dev/null

echo "LocalStack: fila billing-commands e tópico oficina-eventos criados"
