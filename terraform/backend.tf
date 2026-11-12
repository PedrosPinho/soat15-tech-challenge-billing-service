# Estado remoto: bucket S3 + trava DynamoDB do bootstrap da Fase 3 (compartilhados
# pelos repositórios; cada um usa a sua própria `key`). O workspace do Terraform
# (homolog/prod) separa o estado por ambiente.
terraform {
  backend "s3" {
    bucket         = "soat15-tc-tfstate-442534931336"
    key            = "billing-service/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "soat15-tc-tfstate-lock"
    encrypt        = true
  }
}
