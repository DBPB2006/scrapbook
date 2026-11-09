# ==============================================================================
# Module: security (Planned Phase 3)
# ==============================================================================
# Agreed AWS Architecture Scope:
#   - Dedicated Security Groups: ALB, K3s, Jenkins, MongoDB
#     * Zero public inbound access to Jenkins or MongoDB
#     * Port 27017 restricted strictly to authorized K3s nodes
#     * ALB HTTP:80 -> K3s NodePort 30090
#   - Separate IAM Roles & EC2 Instance Profiles (zero static AWS keys):
#     * Jenkins EC2 instance profile (SSM, ECR push, frontend S3 deploy, TF state)
#     * K3s EC2 instance profile (SSM, ECR pull, private media S3, DB secret read)
#     * MongoDB SSM-only instance profile (AmazonSSMManagedInstanceCore only)
# ==============================================================================

