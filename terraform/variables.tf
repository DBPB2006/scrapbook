# ==============================================================================
# Memory Book — Terraform Foundation Input Variables
# ==============================================================================

variable "aws_region" {
  description = "Primary AWS region for Memory Book infrastructure."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z-]+-[0-9]+$", var.aws_region))
    error_message = "aws_region must be a valid AWS region identifier (for example, ap-south-1)."
  }
}

variable "environment" {
  description = "Deployment environment identifier (for example: trial, dev, staging, production)."
  type        = string
  default     = "trial"

  validation {
    condition     = contains(["trial", "dev", "staging", "production"], var.environment)
    error_message = "environment must be one of: trial, dev, staging, production."
  }
}

variable "project_name" {
  description = "Lowercase project identifier used in resource naming and tagging."
  type        = string
  default     = "memory-book"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,28}[a-z0-9]$", var.project_name))
    error_message = "project_name must be lowercase alphanumeric/hyphens (3-30 chars, start with letter)."
  }
}

variable "resource_name_prefix" {
  description = "Optional custom prefix overriding '<project_name>-<environment>'."
  type        = string
  default     = null

  validation {
    condition     = var.resource_name_prefix == null || can(regex("^[a-z][a-z0-9-]{1,40}[a-z0-9]$", var.resource_name_prefix))
    error_message = "When set, resource_name_prefix must use lowercase letters, digits, and hyphens."
  }
}

variable "availability_zones" {
  description = "Availability Zones in ap-south-1 (two AZs required for public ALB subnets)."
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b"]

  validation {
    condition     = length(var.availability_zones) == 2 && length(distinct(var.availability_zones)) == 2
    error_message = "Exactly two distinct availability_zones must be provided."
  }
}

variable "vpc_cidr" {
  description = "Primary IPv4 CIDR block for the Memory Book VPC."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block (for example, 10.0.0.0/16)."
  }
}

variable "public_subnet_cidrs" {
  description = "IPv4 CIDR blocks for Public Subnet A and Public Subnet B (ALB and NAT Gateway)."
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]

  validation {
    condition = (
      length(var.public_subnet_cidrs) == 2 &&
      alltrue([for cidr in var.public_subnet_cidrs : can(cidrhost(cidr, 0))]) &&
      length(distinct(var.public_subnet_cidrs)) == 2
    )
    error_message = "public_subnet_cidrs must contain two distinct valid IPv4 CIDR blocks."
  }
}

variable "private_app_subnet_cidr" {
  description = "IPv4 CIDR block for the Private Application Subnet (Jenkins and K3s nodes)."
  type        = string
  default     = "10.0.11.0/24"

  validation {
    condition     = can(cidrhost(var.private_app_subnet_cidr, 0))
    error_message = "private_app_subnet_cidr must be a valid IPv4 CIDR block."
  }
}

variable "private_db_subnet_cidr" {
  description = "IPv4 CIDR block for the Private Database Subnet (MongoDB EC2 host)."
  type        = string
  default     = "10.0.21.0/24"

  validation {
    condition     = can(cidrhost(var.private_db_subnet_cidr, 0))
    error_message = "private_db_subnet_cidr must be a valid IPv4 CIDR block."
  }
}

variable "additional_tags" {
  description = "Optional extra AWS resource tags merged onto default provider tags."
  type        = map(string)
  default     = {}
}
