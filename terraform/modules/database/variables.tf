variable "name_prefix" {
  description = "Canonical resource name prefix."
  type        = string
}

variable "private_db_subnet_id" {
  description = "Private database subnet ID."
  type        = string
}

variable "mongodb_security_group_id" {
  description = "Security group ID restricting port 27017 access."
  type        = string
}

variable "mongodb_ssm_instance_profile_name" {
  description = "SSM-only EC2 instance profile name."
  type        = string
}

variable "tags" {
  description = "Common tags for MongoDB resources."
  type        = map(string)
  default     = {}
}

