data "aws_caller_identity" "current" {}

locals {
  name_prefix = var.project_name

  ecr_repository_names = [
    "${var.project_name}-gateway",
    "${var.project_name}-auth",
    "${var.project_name}-memories",
    "${var.project_name}-social",
    "${var.project_name}-sharing",
  ]

  gateway_nodeport = 30090
  mongodb_port     = 27017

  media_bucket_name    = var.media_bucket_name != null ? var.media_bucket_name : "${local.name_prefix}-media-${data.aws_caller_identity.current.account_id}"
  frontend_bucket_name = var.frontend_bucket_name != null ? var.frontend_bucket_name : "${local.name_prefix}-frontend-${data.aws_caller_identity.current.account_id}"
}
