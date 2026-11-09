# ==============================================================================
# Memory Book — Root Terraform Foundation Entrypoint
# ==============================================================================
# Phase 1 establishes provider configuration, Terraform >= 1.10 constraints,
# S3 remote backend (with native use_lockfile = true), shared naming/network
# variables, outputs for future phases, and modular scaffolds under ./modules/.
#
# Future phases will wire the child modules below without altering foundation
# interfaces:
#   - Phase 2: ./modules/network   (VPC, subnets, IGW, 1 NAT GW, S3 Gateway Endpoint)
#   - Phase 3: ./modules/security  (ALB/K3s/Jenkins/MongoDB SGs & IAM profiles)
#   - Phase 4: ./modules/storage   (5 memory-book-* ECR repos + S3 media/frontend)
#   - Phase 5: ./modules/database  (MongoDB t3.small + 8 GiB gp3 EBS + Secrets Manager)
#   - Phase 6: ./modules/compute   (Jenkins t3.small, K3s t3.medium + workers, ALB)
# ==============================================================================

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

check "network_cidr_integrity" {
  assert {
    condition = length(distinct([
      var.public_subnet_cidrs[0],
      var.public_subnet_cidrs[1],
      var.private_app_subnet_cidr,
      var.private_db_subnet_cidr,
    ])) == 4
    error_message = "Public A, Public B, Private App, and Private DB subnet CIDRs must all be distinct."
  }

  assert {
    condition = alltrue([
      for cidr in concat(var.public_subnet_cidrs, [var.private_app_subnet_cidr, var.private_db_subnet_cidr]) :
      tonumber(split("/", cidr)[1]) > tonumber(split("/", var.vpc_cidr)[1])
    ])
    error_message = "All subnet prefixes must be smaller blocks (larger prefix length) than vpc_cidr."
  }
}
