variable "name_prefix" {
  description = "Canonical resource name prefix."
  type        = string
}

variable "aws_region" {
  description = "Target AWS region."
  type        = string
}

variable "vpc_cidr" {
  description = "VPC IPv4 CIDR block."
  type        = string
}

variable "availability_zones" {
  description = "Two Availability Zones for public subnets."
  type        = list(string)
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for Public Subnet A and Public Subnet B."
  type        = list(string)
}

variable "private_app_subnet_cidr" {
  description = "CIDR block for Private Application Subnet."
  type        = string
}

variable "private_db_subnet_cidr" {
  description = "CIDR block for Private Database Subnet."
  type        = string
}

variable "tags" {
  description = "Common tags for network resources."
  type        = map(string)
  default     = {}
}

