# Memory Book — A DSA-Driven Cloud-Native Social Memory Platform

[![CI/CD](https://img.shields.io/badge/CI%2FCD-Jenkins-blue?logo=jenkins)](./Jenkinsfile)
[![Kubernetes](https://img.shields.io/badge/Orchestration-K3s-informational?logo=kubernetes)](./deployment)
[![IaC](https://img.shields.io/badge/IaC-Terraform-purple?logo=terraform)](./terraform)
[![Monitoring](https://img.shields.io/badge/Monitoring-Prometheus%20%2B%20Grafana-red?logo=prometheus)](./deployment/monitoring)

Memory Book is a cloud-native social memory platform that enables users to create, organize, and selectively share personal memories and time capsules. The backend runs as five Node.js/Express microservices orchestrated on single-node **K3s**, provisioned on AWS with **Terraform**, deployed via **Jenkins** ([`Jenkinsfile`](./Jenkinsfile)), backed by self-hosted **MongoDB Community Edition 8.0** on EC2 and **Amazon S3**, and monitored with **Prometheus** and **Grafana**.

---

## 1. Architecture & Components

```
                              [ Users / Web Browsers ]
                                         │
                        ┌────────────────┴────────────────┐
                        ▼                                 ▼
         [ Amazon S3 Static Site ]          [ Application Load Balancer ]
         (client/ HTML/CSS/Vanilla JS)                    │ HTTP :80 -> :30090
         http://<frontend-bucket>.s3-website              ▼
           .<region>.amazonaws.com           [ Gateway Service (:3090) ]
                                             (1 replica, trust proxy, JWT, Rate Limit)
                                                          │
             ┌──────────────────┬─────────────────────────┼──────────────────┐
             ▼                  ▼                         ▼                  ▼
      [ Auth Service ]   [ Memories Service ]      [ Social Service ]  [ Sharing Service ]
       (:3001, HPA 1-3)   (:3002, HPA 1-3)          (:3003, HPA 1-3)    (:3004, 1 replica)
             │                  │                         │                  │
             └──────────────────┴─────────────────────────┼──────────────────┘
                                                          │
                                 ┌────────────────────────┴───────────────────┐
                                 ▼                                            ▼
                   [ MongoDB Community 8.0 ]                       [ Private Amazon S3 ]
                   (Private EC2 + Persistent EBS)                  (Presigned Media URLs)
```

### Core AWS & Cluster Components
- **Frontend Hosting**: Public S3 Static Website bucket (`client/` HTML, CSS, Vanilla JS) with public `s3:GetObject` read policy.
- **Public API Ingress**: Internet-facing HTTP Application Load Balancer (port `80` only) forwarding to K3s NodePort `30090`.
- **Single-Node K3s EC2 (`private_app` subnet)**: Runs `gateway-service`, `auth-service`, `memories-service`, `social-service`, `sharing-service`, `prometheus`, `grafana`, and K3s `metrics-server` (Traefik disabled).
- **Jenkins EC2 (`private_app` subnet)**: SSM-managed build & deployment server (`docker`, `node`, `trivy`, `kubectl`) authenticating via its EC2 IAM role (no static AWS keys).
- **Database EC2 (`private_db` subnet)**: MongoDB Community Edition 8.0 with encrypted XFS EBS data volume (`/data/mongodb`, `prevent_destroy = true`).
- **Private Media S3 & ECR**: Private AES256-encrypted media S3 bucket (accessed via IAM role + presigned URLs) and 5 immutable-tag private ECR repositories.

### Microservices & DSA Implementations

| Microservice | Port | Scaling | Responsibility | DSA Implementation |
| :--- | :---: | :---: | :--- | :--- |
| **Gateway Service** | `3090` | 1 replica (no HPA) | Single API entrypoint, `trust proxy` client IP resolution, JWT Bearer verification, header sanitization, auth rate limiting, and reverse proxy routing. | Windowed request counter rate limiting on `/api/login` & `/api/signup`. |
| **Auth Service** | `3001` | HPA `1–3` (60% CPU) | Registration, bcrypt login, JWT issuance, profile management, friend cleanup, and dashboard aggregation. | **A–Z Bucketed Hash Table** ([`auth-service/src/bucket_user_store.js`](./auth-service/src/bucket_user_store.js)). |
| **Memories Service** | `3002` | HPA `1–3` (60% CPU) | Memory CRUD, chronological sorting/pagination, and private S3 media uploads/presigning. | **Chronological Sort & Pagination** ([`memories-service/src/memory_store.js`](./memories-service/src/memory_store.js)). |
| **Social Service** | `3003` | HPA `1–3` (60% CPU) | Mutual friend requests, friend removal, friendship graph, and 2-hop suggestions. | **Adjacency List Graph** ([`social-service/src/social_graph.js`](./social-service/src/social_graph.js)) & **Bounded BFS Queue** ([`social-service/src/social_queue.js`](./social-service/src/social_queue.js)). |
| **Sharing Service** | `3004` | 1 replica (no HPA) | Selective memory sharing and locked time capsules with reveal dates. | **Binary Min-Heap** ([`sharing-service/src/min_heap.js`](./sharing-service/src/min_heap.js)) & **TimeStack** ([`sharing-service/src/time_stack.js`](./sharing-service/src/time_stack.js)). |

Shared backend modules live in [`shared/`](./shared):
- [`shared/mongodb.js`](./shared/mongodb.js): Authenticated MongoDB client, pooling, reconnect loop, health ping, startup indexes, and transaction detection.
- [`shared/service_common.js`](./shared/service_common.js): Email/friend helpers, Gateway/internal auth middleware, `/health` & `/health/live`, and graceful shutdown.
- [`shared/s3_storage.js`](./shared/s3_storage.js): S3 SDK v3 uploads, magic-byte validation, presigned view/download URLs, and key cleanup.
- [`shared/metrics.js`](./shared/metrics.js): `prom-client` `/metrics` middleware (`process_cpu_seconds_total`, `http_requests_total`, `http_errors_total`, `http_request_duration_seconds`, and business counters).

---

## 2. How the S3 Website & Frontend-to-ALB Flow Work

### Accessing the S3 Static Website
1. Terraform creates the frontend S3 bucket configured for static website hosting (`index.html` index/error documents) and outputs `frontend_website_endpoint`.
2. Users open the site directly in any browser over HTTP at:
   ```
   http://<frontend_website_endpoint>
   ```
   (for example, `http://memory-book-trial-frontend-<account_id>.s3-website.ap-south-1.amazonaws.com`).

### How Frontend Requests Reach the ALB and Backend
1. During deployment, Jenkins substitutes `<ALB_API_URL>` (from Terraform output `alb_dns_name`, formatted as `http://<alb_dns_name>`) and `<LOCATIONIQ_API_KEY>` into [`client/js/config.js`](./client/js/config.js) before syncing `client/` to the frontend S3 bucket.
2. When a browser loads a page from the S3 static website:
   - [`client/js/config.js`](./client/js/config.js) configures `axios.defaults.baseURL = API_BASE_URL` (`http://<alb_dns_name>`) and attaches `Authorization: Bearer <jwt>` from `sessionStorage` for API requests.
   - Browser API requests go over HTTP port `80` to the public **Application Load Balancer**, which forwards traffic to the K3s node on NodePort `30090`.
   - **Gateway Service** (`app.set('trust proxy', 1)`) resolves the real client IP from the ALB's `X-Forwarded-For` header for auth rate limiting, validates CORS against `FRONTEND_ORIGIN` (the S3 website origin), verifies the JWT, strips spoofable headers, injects `x-user-email` and `x-gateway-secret`, and proxies `/api/*` requests to internal ClusterIP services (`auth-service`, `memories-service`, `social-service`, `sharing-service`).
   - Media uploads stream through Gateway to `auth-service` / `memories-service` / `sharing-service`, which write objects to the **private media S3 bucket** via the K3s EC2 IAM role and return short-lived presigned S3 URLs to the browser.

---

## 3. Essential AWS Provisioning & Deployment Steps

AWS infrastructure in [`terraform/`](./terraform) targets `ap-south-1` (`Terraform >= 1.10.0` with local state and `terraform/user_data/` EC2 bootstrap scripts):

### Step 1: Provision AWS Infrastructure
```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Review/edit terraform.tfvars as needed (or customize instance types / volume size)
terraform init
terraform plan -out=main.tfplan
terraform apply main.tfplan

# Capture outputs needed for MongoDB setup, Kubernetes secrets, and Jenkins
terraform output
```

### Step 2: Initialize MongoDB Authentication & Indexes (via AWS SSM)
Connect to the `mongodb` EC2 instance using AWS Systems Manager Session Manager and run [`scripts/init-mongodb.sh`](./scripts/init-mongodb.sh):
```bash
export MONGODB_ADMIN_USER="<admin_username>"
export MONGODB_ADMIN_PASSWORD="<strong-admin-password>"
export MONGODB_APP_USER="memorybook_app"
export MONGODB_APP_PASSWORD="<strong-app-password>"
export MONGODB_DATABASE="memorybook"
bash scripts/init-mongodb.sh
```

### Step 3: Create Kubernetes Secrets Once on K3s (via AWS SSM)
Connect to the `k3s` EC2 instance via SSM, create namespace and secrets (never committed to Git), and copy `/etc/rancher/k3s/k3s.yaml` (updating `127.0.0.1` to `k3s_private_ip`) to Jenkins credential `k8s-kubeconfig`:
```bash
kubectl apply -f deployment/namespace.yaml

kubectl create secret generic app-secrets \
  --namespace=memorybook \
  --from-literal=JWT_SECRET="<your-production-jwt-secret>" \
  --from-literal=INTERNAL_SERVICE_SECRET="<your-internal-service-secret>" \
  --from-literal=GATEWAY_SHARED_SECRET="<your-gateway-shared-secret>" \
  --from-literal=MONGODB_URI="mongodb://<app_user>:<url_encoded_app_password>@<mongodb-ec2-private-ip>:27017/memorybook?authSource=memorybook"

kubectl create secret generic grafana-secret \
  --namespace=memorybook \
  --from-literal=admin-password="<your-grafana-admin-password>"
```

### Step 4: Access Jenkins & Configure the Pipeline
Jenkins binds strictly to `127.0.0.1:8080` on the private Jenkins EC2 host. Forward port `8080` over AWS SSM to access the Jenkins UI, install standard Pipeline/Credentials plugins, add the `k8s-kubeconfig` (`Secret file`) credential, and configure global environment variables (`MEDIA_S3_BUCKET`, `FRONTEND_S3_BUCKET`, `ALB_API_URL`, `LOCATIONIQ_API_KEY`).

---

## 4. Jenkins Application Deployment Pipeline ([`Jenkinsfile`](./Jenkinsfile))

Automates testing, image builds, security checks, Kubernetes deployment, and frontend sync:
1. **Checkout**: Pulls source from GitHub, validates required Jenkins environment variables (`MEDIA_S3_BUCKET`, `FRONTEND_S3_BUCKET`, `ALB_API_URL`, `LOCATIONIQ_API_KEY`; optional `FRONTEND_ORIGIN`), and generates a unique immutable ECR image tag (`<short-sha>-<BUILD_NUMBER>-<UTC-timestamp>`).
2. **Dependency Scan**: Runs `npm audit --audit-level=low` across all 5 microservices.
3. **Static Code Analysis and SAST**: Runs `npm run lint` (`node --check`) on all 5 services and Semgrep (`p/javascript`, `p/nodejs`).
4. **Build Images**: Builds all 5 Docker images using `npm ci --omit=dev`.
5. **Trivy Scan**: Scans each built image for `CRITICAL` vulnerabilities (`--exit-code 1`).
6. **Push to ECR**: Logs in with the Jenkins EC2 IAM role and pushes all 5 images.
7. **Deploy Kubernetes Manifests**: Substitutes placeholders (`<AWS_ACCOUNT_ID>`, `<IMAGE_TAG>`, `<MEDIA_S3_BUCKET>`, `<FRONTEND_S3_WEBSITE_ORIGIN>`), verifies no unreplaced placeholders remain, and applies namespace, ConfigMaps, all 5 microservice Deployments & Services, all 3 HPA manifests (`auth`, `memories`, `social`), and Prometheus/Grafana monitoring manifests.
8. **Verify Rollouts**: Waits for `kubectl rollout status` on all 5 microservice Deployments.
9. **Deploy Frontend to S3**: Injects `ALB_API_URL` and `LOCATIONIQ_API_KEY` into `client/js/config.js`, syntax-checks it, and runs `aws s3 sync ... --delete` to `FRONTEND_S3_BUCKET`.

---

## 5. HPA & Monitoring Commands

Kubernetes HPA handles application pod scaling (`1` to `3` pods at `60%` CPU, `60s` scale-down stabilization) via K3s `metrics-server`. Prometheus scrapes individual pods of scalable services (`auth`, `memories`, `social`) via headless metrics Services (`*-service-metrics` with `dns_sd_configs`) for application and scaling observability in Grafana.

### Check HPA & Pod Scaling Activity
```bash
# Inspect HPA targets, current CPU %, and replica counts
kubectl get hpa -n memorybook
kubectl describe hpa auth-service-hpa memories-service-hpa social-service-hpa -n memorybook

# Inspect per-pod CPU/memory usage via K3s metrics-server
kubectl top pods -n memorybook

# Watch pods scale out (1 -> 3) under load and scale back down after ~60s stabilization
kubectl get pods -n memorybook -w
```

### Generate Sample Load Against the ALB (Example)
```bash
# Obtain a JWT first, then send concurrent authenticated requests through the ALB
# (Replace <alb_dns_name> with Terraform output alb_dns_name and <jwt_token> with a valid Bearer token)
for i in $(seq 1 200); do
  curl -s -o /dev/null -H "Authorization: Bearer <jwt_token>" "http://<alb_dns_name>/api/memories" &
done
wait
```

### Access Prometheus & Grafana Dashboards
```bash
# Port-forward Grafana (default user: admin, password from grafana-secret)
kubectl port-forward -n memorybook svc/grafana-service 3000:3000

# Port-forward Prometheus UI
kubectl port-forward -n memorybook svc/prometheus-service 9090:9090
```
Open `http://localhost:3000` to view the pre-provisioned **Memory Book Overview** dashboard (Active Service Pods / HPA visibility, Service CPU Utilization %, HTTP Request Rate, and HTTP Error Rate).

---

## 6. Local Verification

Prerequisites: Node.js 18+/20+, npm 9+, Terraform `>= 1.10.0`.
```bash
# 1. Syntax-check all JavaScript files in each service
for svc in auth gateway memories sharing social; do
  (cd "${svc}-service" && npm run lint)
done

# 2. Validate Terraform formatting and configuration
terraform -chdir=terraform fmt -check -recursive
terraform -chdir=terraform init && terraform -chdir=terraform validate
```
