# VPC Security Groups using standalone rule resources to avoid circular dependencies.

# --- 1. Application Load Balancer (ALB) ---------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "ALB security group"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name_prefix}-alb-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from Internet"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_k3s" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Gateway NodePort to K3s"
  ip_protocol                  = "tcp"
  from_port                    = local.gateway_nodeport
  to_port                      = local.gateway_nodeport
  referenced_security_group_id = aws_security_group.k3s.id
}

# --- 2. K3s Node --------------------------------------------------------------

resource "aws_security_group" "k3s" {
  name        = "${local.name_prefix}-k3s-sg"
  description = "K3s node security group"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name_prefix}-k3s-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "k3s_from_alb" {
  security_group_id            = aws_security_group.k3s.id
  description                  = "Gateway NodePort from ALB"
  ip_protocol                  = "tcp"
  from_port                    = local.gateway_nodeport
  to_port                      = local.gateway_nodeport
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_ingress_rule" "k3s_from_jenkins" {
  security_group_id            = aws_security_group.k3s.id
  description                  = "Kubernetes API from Jenkins"
  ip_protocol                  = "tcp"
  from_port                    = 6443
  to_port                      = 6443
  referenced_security_group_id = aws_security_group.jenkins.id
}

resource "aws_vpc_security_group_egress_rule" "k3s_to_mongodb" {
  security_group_id            = aws_security_group.k3s.id
  description                  = "MongoDB from K3s"
  ip_protocol                  = "tcp"
  from_port                    = local.mongodb_port
  to_port                      = local.mongodb_port
  referenced_security_group_id = aws_security_group.mongodb.id
}

resource "aws_vpc_security_group_egress_rule" "k3s_https" {
  security_group_id = aws_security_group.k3s.id
  description       = "HTTPS for ECR, S3, SSM, and packages"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "k3s_http" {
  security_group_id = aws_security_group.k3s.id
  description       = "HTTP for OS package mirrors"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

# --- 3. Jenkins (Zero Inbound; SSM-Managed) -----------------------------------

resource "aws_security_group" "jenkins" {
  name        = "${local.name_prefix}-jenkins-sg"
  description = "Jenkins security group (no inbound access)"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name_prefix}-jenkins-sg" }
}

resource "aws_vpc_security_group_egress_rule" "jenkins_to_k3s" {
  security_group_id            = aws_security_group.jenkins.id
  description                  = "Kubernetes API to K3s"
  ip_protocol                  = "tcp"
  from_port                    = 6443
  to_port                      = 6443
  referenced_security_group_id = aws_security_group.k3s.id
}

resource "aws_vpc_security_group_egress_rule" "jenkins_https" {
  security_group_id = aws_security_group.jenkins.id
  description       = "HTTPS for GitHub, Docker/ECR, S3, SSM, and packages"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "jenkins_http" {
  security_group_id = aws_security_group.jenkins.id
  description       = "HTTP for OS package mirrors"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

# --- 4. MongoDB (SSM-Managed) -------------------------------------------------

resource "aws_security_group" "mongodb" {
  name        = "${local.name_prefix}-mongodb-sg"
  description = "MongoDB security group (27017 from K3s only)"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name_prefix}-mongodb-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "mongodb_from_k3s" {
  security_group_id            = aws_security_group.mongodb.id
  description                  = "MongoDB from K3s"
  ip_protocol                  = "tcp"
  from_port                    = local.mongodb_port
  to_port                      = local.mongodb_port
  referenced_security_group_id = aws_security_group.k3s.id
}

resource "aws_vpc_security_group_egress_rule" "mongodb_https" {
  security_group_id = aws_security_group.mongodb.id
  description       = "HTTPS for SSM and package downloads"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "mongodb_http" {
  security_group_id = aws_security_group.mongodb.id
  description       = "HTTP for OS package mirrors"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

