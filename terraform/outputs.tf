output "aws_account_id" {
  description = "Active AWS Account ID."
  value       = data.aws_caller_identity.current.account_id
}

output "vpc_id" {
  description = "Memory Book VPC ID."
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "Memory Book VPC CIDR block."
  value       = aws_vpc.main.cidr_block
}

output "availability_zones" {
  description = "Availability Zones configured for public subnets."
  value       = aws_subnet.public[*].availability_zone
}

output "public_subnet_ids" {
  description = "Public subnet IDs across two Availability Zones."
  value       = aws_subnet.public[*].id
}

output "private_app_subnet_id" {
  description = "Private application subnet ID (Jenkins and K3s)."
  value       = aws_subnet.private_app.id
}

output "private_db_subnet_id" {
  description = "Private database subnet ID (MongoDB)."
  value       = aws_subnet.private_db.id
}

output "internet_gateway_id" {
  description = "Internet Gateway ID."
  value       = aws_internet_gateway.main.id
}

output "nat_gateway_id" {
  description = "NAT Gateway ID."
  value       = aws_nat_gateway.main.id
}

output "s3_gateway_endpoint_id" {
  description = "S3 Gateway VPC Endpoint ID."
  value       = aws_vpc_endpoint.s3.id
}

output "alb_security_group_id" {
  description = "ALB security group ID."
  value       = aws_security_group.alb.id
}

output "k3s_security_group_id" {
  description = "K3s nodes security group ID."
  value       = aws_security_group.k3s.id
}

output "jenkins_security_group_id" {
  description = "Jenkins security group ID."
  value       = aws_security_group.jenkins.id
}

output "mongodb_security_group_id" {
  description = "MongoDB security group ID."
  value       = aws_security_group.mongodb.id
}

output "jenkins_instance_profile_name" {
  description = "Jenkins EC2 instance profile name."
  value       = aws_iam_instance_profile.jenkins.name
}

output "k3s_instance_profile_name" {
  description = "K3s EC2 instance profile name."
  value       = aws_iam_instance_profile.k3s.name
}

output "mongodb_instance_profile_name" {
  description = "MongoDB EC2 instance profile name."
  value       = aws_iam_instance_profile.mongodb.name
}

output "jenkins_iam_role_arn" {
  description = "Jenkins IAM role ARN."
  value       = aws_iam_role.jenkins.arn
}

output "k3s_iam_role_arn" {
  description = "K3s IAM role ARN."
  value       = aws_iam_role.k3s.arn
}

output "mongodb_iam_role_arn" {
  description = "MongoDB IAM role ARN."
  value       = aws_iam_role.mongodb.arn
}

output "frontend_bucket_name" {
  description = "Frontend static website S3 bucket name."
  value       = aws_s3_bucket.frontend.bucket
}

output "frontend_website_endpoint" {
  description = "Frontend S3 static website HTTP endpoint."
  value       = aws_s3_bucket_website_configuration.frontend.website_endpoint
}

output "media_bucket_name" {
  description = "Private media S3 bucket name."
  value       = aws_s3_bucket.media.bucket
}

output "ecr_repository_names" {
  description = "Canonical private ECR repository names."
  value       = local.ecr_repository_names
}

output "ecr_repository_urls" {
  description = "Private ECR repository URLs keyed by repository name."
  value       = { for name in local.ecr_repository_names : name => aws_ecr_repository.repositories[name].repository_url }
}

output "mongodb_instance_id" {
  description = "MongoDB EC2 instance ID."
  value       = aws_instance.mongodb.id
}

output "mongodb_private_ip" {
  description = "MongoDB EC2 private IPv4 address."
  value       = aws_instance.mongodb.private_ip
}

output "mongodb_private_dns" {
  description = "MongoDB EC2 private DNS name."
  value       = aws_instance.mongodb.private_dns
}

output "mongodb_volume_id" {
  description = "Persistent MongoDB EBS data volume ID."
  value       = aws_ebs_volume.mongodb_data.id
}

output "alb_dns_name" {
  description = "Public HTTP Application Load Balancer DNS name."
  value       = aws_lb.main.dns_name
}

output "k3s_instance_id" {
  description = "K3s EC2 instance ID."
  value       = aws_instance.k3s.id
}

output "k3s_private_ip" {
  description = "K3s EC2 private IPv4 address."
  value       = aws_instance.k3s.private_ip
}

output "jenkins_instance_id" {
  description = "Jenkins EC2 instance ID."
  value       = aws_instance.jenkins.id
}

output "jenkins_private_ip" {
  description = "Jenkins EC2 private IPv4 address."
  value       = aws_instance.jenkins.private_ip
}
