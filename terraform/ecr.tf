resource "aws_ecr_repository" "billing_service" {
  name                 = "${var.project_name}-billing-service"
  image_tag_mutability = "MUTABLE"
  # Learner Lab: o destroy não pode falhar por causa de imagens.
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "billing_service" {
  repository = aws_ecr_repository.billing_service.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Mantém só as 10 imagens mais recentes"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
