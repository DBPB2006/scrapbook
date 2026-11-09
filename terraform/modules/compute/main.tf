# ==============================================================================
# Module: compute (Planned Phase 6)
# ==============================================================================
# Agreed AWS Architecture Scope:
#   - Jenkins EC2 (t3.small) in Private App Subnet (10.0.11.0/24), SSM managed
#   - K3s Control Plane EC2 (t3.medium) in Private App Subnet (10.0.11.0/24):
#       * IMDSv2 enforced with http_put_response_hop_limit = 2
#       * Kubelet ecr-credential-provider configured for private ECR pulls
#       * Traefik disabled (ALB routes directly to Gateway NodePort 30090)
#   - Optional parameterized K3s worker pool (t3.medium) for Pipeline 2 scaling
#   - Internet-facing Application Load Balancer across Public Subnets A & B
#     * HTTP:80 listener forwarding to Gateway NodePort 30090 (health check: /health)
# ==============================================================================

