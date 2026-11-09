variable "name_prefix" {
  description = "Canonical resource name prefix."
  type        = string
}

variable "vpc_id" {
  description = "Target VPC ID."
  type        = string
}

variable "public_subnet_ids" {
  description = "Two public subnet IDs for the internet-facing ALB."
  type        = list(string)
}

variable "private_app_subnet_id" {
  description = "Private application subnet ID for Jenkins and K3s nodes."
  type        = string
}

variable "alb_security_group_id" {
  description = "ALB Security Group ID."
  type        = string
}

variable "k3s_security_group_id" {
  description = "K3s nodes Security Group ID."
  type        = string
}

variable "jenkins_security_group_id" {
  description = "Jenkins Security Group ID."
  type        = string
}

variable "k3s_instance_profile_name" {
  description = "K3s EC2 IAM instance profile name."
  type        = string
}

variable "jenkins_instance_profile_name" {
  description = "Jenkins EC2 IAM instance profile name."
  type        = string
}

variable "gateway_nodeport" {
  description = "Kubernetes NodePort exposed by Gateway service."
  type        = number
  default     = 30090
}

variable "k3s_worker_count" {
  description = "Number of additional K3s worker instances (managed for capacity scaling)."
  type        = number
  default     = 0
}

variable "tags" {
  description = "Common tags for compute and load balancing resources."
  type        = map(string)
  default     = {}
}

