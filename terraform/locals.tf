# ==============================================================================
# Shared Locals, Naming Conventions & Architectural Contracts
# ==============================================================================

locals {
  name_prefix = coalesce(var.resource_name_prefix, "${var.project_name}-${var.environment}")

  common_tags = merge(
    {
      Project     = "Memory Book"
      ProjectSlug = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    },
    var.additional_tags
  )

  # Agreed VPC and subnet CIDR layout in ap-south-1
  network_plan = {
    vpc_cidr                = var.vpc_cidr
    public_subnet_a_cidr    = var.public_subnet_cidrs[0]
    public_subnet_b_cidr    = var.public_subnet_cidrs[1]
    private_app_subnet_cidr = var.private_app_subnet_cidr
    private_db_subnet_cidr  = var.private_db_subnet_cidr
  }

  # Canonical private ECR repositories matching application & Jenkins CI/CD design
  ecr_repository_names = [
    "${var.project_name}-gateway",
    "${var.project_name}-auth",
    "${var.project_name}-memories",
    "${var.project_name}-social",
    "${var.project_name}-sharing",
  ]

  # Canonical service, Kubernetes NodePort, monitoring, and database ports
  service_ports = {
    gateway_http     = 3090
    gateway_nodeport = 30090
    auth             = 3001
    memories         = 3002
    social           = 3003
    sharing          = 3004
    prometheus       = 9090
    grafana          = 3000
    mongodb          = 27017
  }
}

