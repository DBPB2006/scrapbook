# Memory Book — A DSA-Driven Cloud-Native Social Memory Platform

[![CI/CD](https://img.shields.io/badge/CI%2FCD-Jenkins-blue?logo=jenkins)](./Jenkinsfile)
[![Kubernetes](https://img.shields.io/badge/Orchestration-K3s-informational?logo=kubernetes)](./deployment)
[![IaC](https://img.shields.io/badge/IaC-Terraform-purple?logo=terraform)](./terraform)
[![DevSecOps](https://img.shields.io/badge/DevSecOps-ESLint%20%2B%20Trivy-orange)](./eslint.config.js)
[![Monitoring](https://img.shields.io/badge/Monitoring-Prometheus%20%2B%20Grafana-red?logo=prometheus)](./deployment/prometheus)

Memory Book is a cloud-native social memory platform that enables users to create, organize, and selectively share personal memories (text, media, dates, tags, and locations). Built according to 12-factor cloud principles, the system couples dedicated **Data Structures and Algorithms (DSA)** directly into a service-oriented backend orchestrated on **Kubernetes (K3s)**, provisioned via **Terraform** on AWS, automated through **Jenkins CI/CD**, and secured with end-to-end **DevSecOps** practices.

---

## 1. System Architecture

The platform runs five stateless backend microservices and a client web frontend, backed by self-hosted MongoDB Community Server for persistent state and Amazon S3 for media storage.

```
                              [ Users / Web Browsers ]
                                         │
                                   HTTP / Port 80
                                         ▼
                            [ Application Load Balancer ]
                                         │
                                         ▼
                            [ Gateway Service (Port 3090) ]
                            (Reverse Proxy & Web Client)
                                         │
       ┌──────────────────┬──────────────┴─────┬──────────────────┐
       ▼                  ▼                    ▼                  ▼
[ Auth Service ]  [ Memories Service ]  [ Social Service ]  [ Sharing Service ]
  (Port 3001)       (Port 3002)           (Port 3003)         (Port 3004)
       │                  │                    │                  │
       └──────────────────┴──────────────┬─────┴──────────────────┘
                                         │
                    ┌────────────────────┴───────────────────┐
                    ▼                                        ▼
      [ MongoDB Community 7.0 ]                      [ Amazon S3 ]
      (Dedicated Private EC2)                   (Memory Media Storage)
```

---

## 2. Microservices & DSA Implementations

Each microservice encapsulates a distinct functional boundary and integrates a specific Data Structure and Algorithm to optimize critical application operations:

| Microservice | Internal Port | Application Responsibility | Integrated DSA Implementation |
| :--- | :---: | :--- | :--- |
| **Gateway Service** | `3090` | Single ingress entrypoint, JWT verification, identity header propagation/sanitization, rate limiting, and static UI delivery. | **Token Bucket / Windowed Counter** rate limiting for client traffic control. |
| **Auth Service** | `3001` | User registration, authentication, JWT token issuance (HttpOnly Secure cookies), and bcrypt password hashing. | **A–Z Bucketed Hash Table** ([`auth-service/src/bucket_user_store.js`](./auth-service/src/bucket_user_store.js)) for constant-time partition lookups. |
| **Memories Service** | `3002` | Memory creation, tagging, timeline filtering, and S3 media storage upload abstraction. | **Dynamic Memory Store** ([`memories-service/src/memory_store.js`](./memories-service/src/memory_store.js)) indexing memories chronologically. |
| **Social Service** | `3003` | Friendship management, bidirectional friend requests, and social connectivity. | **Undirected Graph Adjacency List** ([`social-service/src/social_graph.js`](./social-service/src/social_graph.js)) and **Bounded BFS** ([`social-service/src/social_queue.js`](./social-service/src/social_queue.js)) for 2nd-degree friend recommendations. |
| **Sharing Service** | `3004` | Shared memory access rules, time capsule scheduling, and chronological history tracking. | **Binary Min-Heap Scheduler** ([`sharing-service/src/min_heap.js`](./sharing-service/src/min_heap.js)) for automatic unlock evaluation, and **LIFO Time Stack** ([`sharing-service/src/time_stack.js`](./sharing-service/src/time_stack.js)). |

---

## 3. DevSecOps & CI/CD Pipeline

The automated CI/CD pipeline is implemented in [`Jenkinsfile`](./Jenkinsfile) using a Declarative Pipeline triggered by GitHub webhooks. It enforces blocking security gates before publishing container images or modifying cluster workloads:

```
[ GitHub Push / Webhook ]
           │
           ▼
    1. Checkout               → Fetches repo and extracts Git commit SHA
           │
           ▼
    2. Dependency Scan        → 'npm audit --audit-level=critical' (Blocks on critical CVEs)
           │
           ▼
    3. Static Code Analysis   → 'npm run lint' via shared root eslint.config.js (Blocks on syntax/lint errors)
           │
           ▼
    4. Build Images           → Multi-service Docker container image build
           │
           ▼
    5. Trivy Scan             → Container vulnerability scan ('--exit-code 1 --severity CRITICAL')
           │
           ▼
    6. Push to ECR            → IAM-authenticated publish with immutable Git commit SHA tags
           │
           ▼
    7. Deploy to Kubernetes   → Refreshes ECR pull secret, applies manifests, updates image tags & checks rollout status
```

### DevSecOps Principles Enforced
* **Zero Critical Vulnerabilities**: Builds are terminated immediately if `npm audit` or `trivy` detect unmitigated `CRITICAL` vulnerabilities.
* **Immutable Container Images**: Container images are pushed to Amazon ECR tagged strictly with the full Git commit SHA (`IMAGE_TAG`), ensuring end-to-end provenance and reproducible deployments.
* **Automated Static Code Analysis**: Root [`eslint.config.js`](./eslint.config.js) enforces code health across all services without requiring runtime overhead or heavy third-party platforms.

---

## 4. Cloud Infrastructure as Code (Terraform)

All AWS cloud resources are defined declaratively in the [`terraform/`](./terraform) directory targeting the **`ap-south-1`** region:

* **Core Configuration ([`main.tf`](./terraform/main.tf), [`variables.tf`](./terraform/variables.tf), [`outputs.tf`](./terraform/outputs.tf))**: AWS provider settings in `ap-south-1`, variables, and essential output values.
* **Networking ([`network.tf`](./terraform/network.tf))**: Custom VPC with 2 public, 2 private application, and 2 private database subnets across two AZs, Internet Gateway, shared NAT Gateway, and route tables.
* **Security & IAM ([`security.tf`](./terraform/security.tf))**: Minimal security groups for ALB (HTTP:80), K3s EC2 (NodePort:30090), and MongoDB (27017); EC2 IAM role with ECR pull, SSM core, S3 access, and Secrets Manager permissions.
* **Compute & Load Balancing ([`compute.tf`](./terraform/compute.tf))**: EC2 instance hosting K3s bootstrapped via [`scripts/k3s-bootstrap.sh`](./terraform/scripts/k3s-bootstrap.sh), public Application Load Balancer with HTTP port 80 listener forwarding to the Gateway target group.
* **Database ([`mongodb.tf`](./terraform/mongodb.tf))**: Self-hosted MongoDB 7.0 Community Server on a private EC2 instance with a single 10 GB gp3 encrypted root EBS volume and AWS Secrets Manager credentials.
* **Storage & Registry ([`storage.tf`](./terraform/storage.tf))**: Private S3 media bucket (`scrapbook-media`), frontend S3 bucket, and 5 Amazon ECR repositories with tag immutability.

---

## 5. Kubernetes Orchestration (K3s)

Production deployment manifests are organized in [`deployment/`](./deployment):

* **Service Deployments**: Dedicated Deployment and Service manifests for [`auth/`](./deployment/auth), [`gateway/`](./deployment/gateway), [`memories/`](./deployment/memories), [`sharing/`](./deployment/sharing), and [`social/`](./deployment/social).
* **Configuration & Secrets**: Centralized ConfigMaps in [`deployment/config/`](./deployment/config) and Kubernetes Secrets for secure credential injection.
* **Auto-Scaling**: Horizontal Pod Autoscalers ([`deployment/hpa/hpa.yaml`](./deployment/hpa/hpa.yaml)) scaling microservice pods dynamically based on CPU and memory thresholds.
* **Health Checks**: Every microservice pod defines Kubernetes `livenessProbe` and `readinessProbe` to enable automated container self-healing.

---

## 6. Observability & Monitoring

The monitoring stack provides real-time cluster health and service telemetry:

* **Prometheus ([`deployment/prometheus/`](./deployment/prometheus))**:
  * Configured with dedicated RBAC permissions ([`prometheus-rbac.yaml`](./deployment/prometheus/prometheus-rbac.yaml)) to scrape K3s cluster metrics, API server status, node health, and cAdvisor container statistics.
  * Scrapes internal `/metrics` endpoints across all five microservices (`gateway:3090`, `auth:3001`, `memories:3002`, `social:3003`, `sharing:3004`).
* **Grafana ([`deployment/grafana/`](./deployment/grafana))**:
  * Deployed with secure credential management via Kubernetes Secret ([`grafana-secret.yaml`](./deployment/grafana/grafana-secret.yaml)).
  * Pre-configured with Prometheus as the authoritative datasource.
  * Provides a lightweight dashboard ([`grafana-dashboard-configmap.yaml`](./deployment/grafana/grafana-dashboard-configmap.yaml)) tracking service reachability, cluster resource utilization (CPU/Memory), and Kubernetes target health.

---

## 7. Local Development & Validation

### Prerequisites
* Node.js (v18+ or v20 LTS)
* npm (v9+)
* Docker (optional, for local image verification)

### Running Static Code Analysis
Run ESLint across all microservices using the root configuration:
```bash
npx eslint .
```
Or run individually within any service:
```bash
cd auth-service && npm run lint
```

### Auditing Dependencies
Audit any microservice for critical vulnerabilities:
```bash
cd memories-service && npm audit --audit-level=critical
```

### Local Configuration
Each service contains an `.env.example` file documenting the necessary environment variables. For local execution:
```bash
cd auth-service
cp .env.example .env
npm install
node auth_server.js
```

---

## 8. Repository Structure

```
scrapbook-main/
├── Jenkinsfile                  # Declarative Jenkins CI/CD & DevSecOps pipeline
├── README.md                    # Project documentation & architecture overview
├── eslint.config.js             # Shared root ESLint flat configuration (Section 7.5)
├── .gitignore                   # Repository ignore rules (Node, Terraform, scans, OS)
├── auth-service/                # Auth Service (A–Z Bucketed Hash Table)
├── gateway-service/             # Gateway Service & reverse proxy (Port 3090)
├── memories-service/            # Memories Service & S3 media abstraction
├── social-service/              # Social Service (Adjacency List Graph & BFS)
├── sharing-service/             # Sharing Service (Binary Min-Heap & Time Stack)
├── client/                      # Static web frontend (HTML/CSS/JS)
├── shared/                      # Shared database connector, metrics, and S3 client
├── deployment/                  # Kubernetes (K3s) deployment manifests
│   ├── auth/                    # Auth deployment & service
│   ├── config/                  # Service ConfigMaps & Secrets
│   ├── gateway/                 # Gateway deployment & NodePort service (30090)
│   ├── grafana/                 # Grafana deployment, datasource, dashboard, & secret
│   ├── hpa/                     # Horizontal Pod Autoscalers (HPA)
│   ├── memories/                # Memories deployment & service
│   ├── prometheus/              # Prometheus deployment, RBAC, & scrape configuration
│   ├── sharing/                 # Sharing deployment & service
│   └── social/                  # Social deployment & service
└── terraform/                   # AWS Infrastructure as Code (ap-south-1)
    ├── main.tf                  # AWS provider & Terraform configuration
    ├── variables.tf             # Input variables
    ├── network.tf               # VPC, Subnets, NAT Gateway, Route Tables
    ├── security.tf              # Security Groups (ALB, K3s, MongoDB) & IAM Roles
    ├── compute.tf               # EC2 K3s host instance, ALB, & HTTP:80 Listener
    ├── mongodb.tf               # Self-hosted MongoDB 7.0 Community EC2, EBS, & Secrets Manager
    ├── storage.tf               # Amazon ECR repositories & S3 buckets
    ├── outputs.tf               # Output definitions
    └── scripts/k3s-bootstrap.sh # K3s node bootstrap automation
    └── scripts/mongodb-bootstrap.sh # MongoDB node bootstrap automation
```
