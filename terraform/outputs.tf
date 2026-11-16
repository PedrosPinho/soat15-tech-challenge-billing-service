output "ecr_repository_url" {
  description = "URL do repositório ECR do Billing Service"
  value       = aws_ecr_repository.billing_service.repository_url
}

output "billing_commands_queue_url" {
  description = "URL da fila billing-commands (consumida por este serviço; o OS envia)"
  value       = aws_sqs_queue.billing_commands.url
}

output "billing_commands_queue_arn" {
  description = "ARN da fila billing-commands"
  value       = aws_sqs_queue.billing_commands.arn
}

output "billing_commands_dlq_url" {
  description = "URL da DLQ de billing-commands"
  value       = aws_sqs_queue.billing_commands_dlq.url
}

output "events_topic_arn" {
  description = "ARN do tópico oficina-eventos (do OS Service), onde este serviço publica"
  value       = data.terraform_remote_state.os.outputs.events_topic_arn
}
