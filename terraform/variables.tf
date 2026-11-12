# Restrição do AWS Academy Learner Lab: região fixa.
variable "aws_region" {
  description = "Região AWS (fixa, restrição do Learner Lab)"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefixo usado no nome dos recursos"
  type        = string
  default     = "soat15-tc"
}

variable "max_receive_count" {
  description = "Recebimentos antes de a mensagem ir para a DLQ"
  type        = number
  default     = 5
}

variable "message_retention_seconds" {
  description = "Retenção das mensagens (4 dias)"
  type        = number
  default     = 345600
}

variable "visibility_timeout_seconds" {
  description = "Visibility timeout da fila de comandos (>= 6x o tempo de processamento do consumidor)"
  type        = number
  default     = 60
}

variable "tfstate_bucket" {
  description = "Bucket do estado remoto (bootstrap da Fase 3); usado para ler as saídas do OS Service"
  type        = string
  default     = "soat15-tc-tfstate-442534931336"
}
