# Fila de comandos do Billing (OS -> Billing) + DLQ (ADR-010). O Billing é dono
# desta fila; o OS só envia. Eventos saem pelo tópico SNS do OS (local.events_topic_arn).

resource "aws_sqs_queue" "billing_commands_dlq" {
  name                      = "${local.name_prefix}-billing-commands-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "billing_commands" {
  name                       = "${local.name_prefix}-billing-commands"
  message_retention_seconds  = var.message_retention_seconds
  visibility_timeout_seconds = var.visibility_timeout_seconds
  receive_wait_time_seconds  = 20

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.billing_commands_dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# Libera o envio pelo OS Service. No Learner Lab o pod usa a LabRole da mesma conta,
# então o principal é a conta (a autorização efetiva continua sendo a da role).
resource "aws_sqs_queue_policy" "billing_commands" {
  queue_url = aws_sqs_queue.billing_commands.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowOsServiceToSend"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
      Action    = ["sqs:SendMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"]
      Resource  = aws_sqs_queue.billing_commands.arn
    }]
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "billing_commands_dlq" {
  queue_url = aws_sqs_queue.billing_commands_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.billing_commands.arn]
  })
}
