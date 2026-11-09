# ==============================================================================
# Module: network (Planned Phase 2)
# ==============================================================================
# Agreed AWS Architecture Scope:
#   - VPC: 10.0.0.0/16 (DNS hostnames & support enabled)
#   - Public Subnet A (AZ1): 10.0.1.0/24
#   - Public Subnet B (AZ2): 10.0.2.0/24
#   - Private Application Subnet: 10.0.11.0/24 (K3s + Jenkins)
#   - Private Database Subnet: 10.0.21.0/24 (MongoDB)
#   - Internet Gateway, 1 NAT Gateway + EIP (in Public Subnet A)
#   - Route tables + associations
#   - S3 Gateway VPC Endpoint attached to private route tables
# ==============================================================================

