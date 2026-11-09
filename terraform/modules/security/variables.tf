variable "name_prefix" {
  description = "Canonical resource name prefix."
  type        = string
}

variable "vpc_id" {
  description = "Target VPC ID."
  type        = string
}

variable "media_bucket_arn" {
  description = "ARN of the private S3 media bucket."
  type        = string
  default     = ""
}

variable "frontend_bucket_arn" {
  description = "ARN of the frontend S3 website bucket."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Common tags for security resources."
  type        = map(string)
  default     = {}
}

