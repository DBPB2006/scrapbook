# ==============================================================================
# Module: database (Planned Phase 5)
# ==============================================================================
# Agreed AWS Architecture Scope:
#   - Self-hosted MongoDB Community EC2 (t3.small) in Private DB Subnet (10.0.21.0/24)
#   - SSM-only EC2 IAM Instance Profile
#   - Separate encrypted 8 GiB gp3 EBS data volume mounted via UUID at /data/mongodb
#     * Idempotent blkid check (never blindly format existing volumes)
#     * Lifecycle protection against accidental deletion on EC2 replacement/destroy
#   - Secrets Manager secret for DB credentials & connection URI
# ==============================================================================

