variable "aws_region" {
  description = "Primary AWS region for Scrapbook."
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment environment (dev, staging, production)."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "environment must be one of: dev, staging, production."
  }
}

variable "project_name" {
  description = "Lowercase project identifier used in resource names."
  type        = string
  default     = "scrapbook"
}

variable "availability_zones" {
  description = "Two Availability Zones in ap-south-1."
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b"]

  validation {
    condition     = length(var.availability_zones) == 2 && length(distinct(var.availability_zones)) == 2
    error_message = "Exactly two distinct availability_zones must be provided."
  }
}

variable "vpc_cidr" {
  description = "Primary IPv4 CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for Public Subnets A and B."
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]

  validation {
    condition     = length(var.public_subnet_cidrs) == 2 && length(distinct(var.public_subnet_cidrs)) == 2
    error_message = "Exactly two distinct public_subnet_cidrs must be provided."
  }
}

variable "private_app_subnet_cidr" {
  description = "CIDR block for the Private Application Subnet (Jenkins and K3s)."
  type        = string
  default     = "10.0.11.0/24"
}

variable "private_db_subnet_cidr" {
  description = "CIDR block for the Private Database Subnet (MongoDB)."
  type        = string
  default     = "10.0.21.0/24"
}

variable "media_bucket_name" {
  description = "Optional custom private media S3 bucket name (defaults to '<name_prefix>-media-<account_id>')."
  type        = string
  default     = null
}

variable "frontend_bucket_name" {
  description = "Optional custom frontend website S3 bucket name (defaults to '<name_prefix>-frontend-<account_id>')."
  type        = string
  default     = null
}

variable "additional_tags" {
  description = "Optional extra AWS resource tags."
  type        = map(string)
  default     = {}
}

variable "k3s_instance_type" {
  description = "EC2 instance type for the single-node K3s host."
  type        = string
  default     = "t3.small"
}

variable "jenkins_instance_type" {
  description = "EC2 instance type for the Jenkins host."
  type        = string
  default     = "t3.small"
}

variable "mongodb_instance_type" {
  description = "EC2 instance type for the MongoDB Community Edition host."
  type        = string
  default     = "t3.small"
}

variable "mongodb_data_volume_size" {
  description = "Persistent MongoDB EBS data volume size in GiB."
  type        = number
  default     = 8

  validation {
    condition     = var.mongodb_data_volume_size >= 8
    error_message = "mongodb_data_volume_size must be at least 8 GiB."
  }
}
