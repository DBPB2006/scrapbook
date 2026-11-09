# ==============================================================================
# Foundation Outputs for Subsequent Infrastructure Phases & Automation
# ==============================================================================

output "aws_account_id" {
  description = "Active AWS Account ID resolved by the AWS provider caller identity."
  value       = data.aws_caller_identity.current.account_id
}

output "aws_region" {
  description = "Configured AWS region for Memory Book deployment."
  value       = data.aws_region.current.name
}

output "project_name" {
  description = "Canonical lowercase project name."
  value       = var.project_name
}

output "environment" {
  description = "Active environment name."
  value       = var.environment
}

output "name_prefix" {
  description = "Standard resource naming prefix for downstream modules."
  value       = local.name_prefix
}

output "common_tags" {
  description = "Standard tags applied across Memory Book AWS resources."
  value       = local.common_tags
}

output "availability_zones" {
  description = "Configured Availability Zones in ap-south-1."
  value       = var.availability_zones
}

output "network_configuration" {
  description = "Agreed VPC and subnet CIDR blocks for Phase 2 networking."
  value       = local.network_plan
}

output "ecr_repository_names" {
  description = "Canonical private ECR repository names aligned with Jenkins and K8s manifests."
  value       = local.ecr_repository_names
}

output "service_ports" {
  description = "Standardized port map shared across ALB, K3s, microservices, and MongoDB."
  value       = local.service_ports
}

output "remote_state_configuration" {
  description = "Expected S3 remote state parameters (bucket supplied at init via backend config)."
  value = {
    key          = "memory-book/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
