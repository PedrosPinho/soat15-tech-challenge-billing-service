locals {
  name_prefix = "${var.project_name}-${terraform.workspace}"
}

data "aws_caller_identity" "current" {}

# O OS Service é dono do tópico SNS `oficina-eventos` (onde este serviço publica).
# Ordem de deploy: OS Service antes do Billing (PHASE_4_PLAN.md, "Ordem de deploy").
data "terraform_remote_state" "os" {
  backend   = "s3"
  workspace = terraform.workspace

  config = {
    bucket = var.tfstate_bucket
    key    = "os-service/terraform.tfstate"
    region = var.aws_region
  }
}
