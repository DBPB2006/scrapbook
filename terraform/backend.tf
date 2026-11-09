# ==============================================================================
# S3 Remote Backend Configuration (Terraform >= 1.10 Native S3 Lockfile)
# ==============================================================================
# The S3 bucket name must be supplied externally at `terraform init` time via:
#   terraform init -backend-config=backend.hcl
# or:
#   terraform init -backend-config="bucket=<your-state-bucket-name>"
#
# Never hardcode the state bucket name, account IDs, or AWS credentials here.
# ==============================================================================

terraform {
  backend "s3" {
    key          = "memory-book/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}

