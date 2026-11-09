# Memory Book — Terraform Infrastructure Foundation (`ap-south-1`)

This directory contains the clean, modular **Phase 1 Terraform Foundation** for the Memory Book AWS architecture.

## Directory Layout

```text
terraform/
├── versions.tf                 # Terraform >= 1.10.0 and AWS provider (~> 5.0) constraints
├── backend.tf                  # Partial S3 remote backend (key: memory-book/terraform.tfstate, use_lockfile = true)
├── providers.tf                # AWS provider configuration in ap-south-1 + default tags
├── main.tf                     # Root foundation entrypoint, caller data sources, CIDR integrity checks
├── variables.tf                # Validated inputs for region, environment, naming, and network CIDRs
├── locals.tf                   # Naming prefix, common tags, ECR repo names, canonical service ports
├── outputs.tf                  # Foundation outputs consumed by upcoming phases and automation
├── backend.hcl.example         # Example partial backend config to supply state bucket externally
├── terraform.tfvars.example    # Example variable overrides
└── modules/
    ├── network/                # Phase 2: VPC, Subnets, IGW, 1 NAT GW + EIP, Route Tables, S3 Gateway Endpoint
    ├── security/               # Phase 3: ALB/K3s/Jenkins/MongoDB SGs & separated IAM instance profiles
    ├── storage/                # Phase 4: 5 memory-book-* ECR repos (+ lifecycle), private media S3, frontend S3
    ├── database/               # Phase 5: MongoDB t3.small, separate 8 GiB gp3 /data/mongodb EBS, Secrets Manager
    └── compute/                # Phase 6: Jenkins t3.small, K3s control t3.medium, worker capacity pool, ALB
```

## Remote Backend & State Prerequisites

`backend.tf` intentionally omits the S3 `bucket` attribute so it is supplied through configuration without hardcoding bucket names or credentials:

1. Create/verify a dedicated, versioned, SSE-encrypted S3 state bucket in `ap-south-1` (with Public Access Block enabled).
2. Copy `backend.hcl.example` to `backend.hcl` and set `bucket = "<your-state-bucket>"`.
3. Initialize Terraform against the remote state (uses native S3 `.tflock` locking via `use_lockfile = true`; no DynamoDB table required):
   ```bash
   terraform init -backend-config=backend.hcl
   ```

> **Note**: Do **not** migrate or restore legacy `scrapbook` local state files.

## Phase 1 Offline Validation

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
```

