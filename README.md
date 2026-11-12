# Scrapbook — A DSA-Driven Cloud-Native Social Memory Platform

[![CI/CD](https://img.shields.io/badge/CI%2FCD-Jenkins-blue?logo=jenkins)](./Jenkinsfile)
[![Kubernetes](https://img.shields.io/badge/Orchestration-K3s-informational?logo=kubernetes)](./deployment)
[![IaC](https://img.shields.io/badge/IaC-Terraform-purple?logo=terraform)](./terraform)
[![Monitoring](https://img.shields.io/badge/Monitoring-Prometheus%20%2B%20Grafana-red?logo=prometheus)](./deployment/monitoring)

Scrapbook is a cloud-native social memory platform that enables users to create, organize, and selectively share personal memories and time capsules. The backend runs as five Node.js/Express microservices orchestrated on single-node **K3s** (`scrapbook` namespace), provisioned on AWS with **Terraform**, deployed via **Jenkins** ([`Jenkinsfile`](./Jenkinsfile), pipeline job `scrapbook-pipeline`), backed by self-hosted **MongoDB Community Edition 8.0** on EC2 (`scrapbook` database) and **Amazon S3**, and monitored with **Prometheus** and **Grafana**.

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
- **Frontend Hosting**: Public S3 Static Website bucket (`scrapbook-frontend-<account_id>`, serving `client/` HTML, CSS, Vanilla JS) with public `s3:GetObject` read policy.
- **Public API Ingress**: Internet-facing HTTP Application Load Balancer (`scrapbook-alb`, port `80` only) forwarding to K3s NodePort `30090`.
- **Single-Node K3s EC2 (`scrapbook-k3s`, `private_app` subnet)**: Runs `scrapbook-gateway`, `scrapbook-auth`, `scrapbook-memories`, `scrapbook-social`, `scrapbook-sharing`, `scrapbook-prometheus`, and `scrapbook-grafana` Deployments in namespace `scrapbook` (with internal Services `gateway-service`, `auth-service`, `memories-service`, `social-service`, `sharing-service`, `prometheus-service`, `grafana-service`), plus K3s `metrics-server` (Traefik disabled).
- **Jenkins EC2 (`scrapbook-jenkins`, `private_app` subnet)**: SSM-managed build & deployment server (`docker`, `node`, `trivy`, `kubectl`) running `scrapbook-pipeline` and authenticating via its EC2 IAM role (no static AWS keys).
- **Database EC2 (`scrapbook-mongodb`, `private_db` subnet)**: MongoDB Community Edition 8.0 (`scrapbook` database) with encrypted XFS EBS data volume (`scrapbook-mongodb-data` mounted at `/data/mongodb`, `prevent_destroy = true`).
- **Private Media S3 & ECR**: Private AES256-encrypted media S3 bucket (`scrapbook-media-<account_id>`, accessed via IAM role + presigned URLs) and 5 immutable-tag private ECR repositories (`scrapbook-gateway`, `scrapbook-auth`, `scrapbook-memories`, `scrapbook-social`, `scrapbook-sharing`).

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
   (for example, `http://scrapbook-frontend-<account_id>.s3-website.ap-south-1.amazonaws.com`).

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
Connect to the `scrapbook-mongodb` EC2 instance using AWS Systems Manager Session Manager and run [`scripts/init-mongodb.sh`](./scripts/init-mongodb.sh):
```bash
export MONGODB_ADMIN_USER="<admin_username>"
export MONGODB_ADMIN_PASSWORD="<strong-admin-password>"
export MONGODB_APP_USER="scrapbook_app"
export MONGODB_APP_PASSWORD="<strong-app-password>"
export MONGODB_DATABASE="scrapbook"
bash scripts/init-mongodb.sh
```

### Step 3: Create the `deployment-env` Secrets File & Restricted Jenkins Kubeconfig

Do **not** commit real secrets to Git, do **not** embed a kubeconfig inside `.env.jenkins`, and do **not** leave K3s's full cluster-admin `/etc/rancher/k3s/k3s.yaml` as Jenkins's permanent credential.

1. **Prepare `.env.jenkins` locally** from [`.env.jenkins.example`](./.env.jenkins.example) (already gitignored via `.gitignore`):
   ```bash
   cp .env.jenkins.example .env.jenkins
   chmod 600 .env.jenkins
   ```
   Populate real values for:
   - `JWT_SECRET`, `INTERNAL_SERVICE_SECRET`, `GATEWAY_SHARED_SECRET`
   - `MONGODB_URI` (`mongodb://scrapbook_app:<URL_ENCODED_PASSWORD>@10.0.21.241:27017/scrapbook?authSource=scrapbook` — reuse the existing `scrapbook_app` credentials initialized in Step 2; URL-encode special characters)
   - `GRAFANA_ADMIN_PASSWORD`
   - `LOCATIONIQ_API_KEY` (HTTP-referrer-restricted in LocationIQ)

2. **Create a least-privilege `jenkins-deployer` ServiceAccount kubeconfig on `scrapbook-k3s` (via AWS SSM)** instead of permanently storing the cluster-admin `k3s.yaml` in Jenkins:
   ```bash
   kubectl apply -f deployment/namespace.yaml

   cat <<'EOF' | kubectl apply -f -
   apiVersion: v1
   kind: ServiceAccount
   metadata:
     name: jenkins-deployer
     namespace: scrapbook
   ---
   apiVersion: rbac.authorization.k8s.io/v1
   kind: ClusterRole
   metadata:
     name: jenkins-scrapbook-namespace
   rules:
     - apiGroups: [""]
       resources: ["namespaces"]
       verbs: ["create"]
     - apiGroups: [""]
       resources: ["namespaces"]
       resourceNames: ["scrapbook"]
       verbs: ["get", "patch", "update"]
   ---
   apiVersion: rbac.authorization.k8s.io/v1
   kind: ClusterRoleBinding
   metadata:
     name: jenkins-scrapbook-namespace-binding
   roleRef:
     apiGroup: rbac.authorization.k8s.io
     kind: ClusterRole
     name: jenkins-scrapbook-namespace
   subjects:
     - kind: ServiceAccount
       name: jenkins-deployer
       namespace: scrapbook
   ---
   apiVersion: rbac.authorization.k8s.io/v1
   kind: Role
   metadata:
     name: jenkins-scrapbook-deployer
     namespace: scrapbook
   rules:
     - apiGroups: ["", "apps", "autoscaling"]
       resources: ["configmaps", "secrets", "services", "deployments", "replicasets", "pods", "horizontalpodautoscalers"]
       verbs: ["get", "list", "watch", "create", "update", "patch"]
   ---
   apiVersion: rbac.authorization.k8s.io/v1
   kind: RoleBinding
   metadata:
     name: jenkins-scrapbook-deployer-binding
   roleRef:
     apiGroup: rbac.authorization.k8s.io
     kind: Role
     name: jenkins-scrapbook-deployer
   subjects:
     - kind: ServiceAccount
       name: jenkins-deployer
       namespace: scrapbook
   EOF

   # Generate a dedicated ServiceAccount kubeconfig pointing to k3s_private_ip:6443
   K3S_CA_B64="$(kubectl config view --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')"
   SA_TOKEN="$(kubectl create token jenkins-deployer -n scrapbook --duration=8760h)"
   cat > /tmp/jenkins-k3s.kubeconfig <<EOF
   apiVersion: v1
   kind: Config
   clusters:
     - name: scrapbook-k3s
       cluster:
         certificate-authority-data: ${K3S_CA_B64}
         server: https://<k3s_private_ip>:6443
   contexts:
     - name: jenkins-deployer@scrapbook-k3s
       context:
         cluster: scrapbook-k3s
         namespace: scrapbook
         user: jenkins-deployer
   current-context: jenkins-deployer@scrapbook-k3s
   users:
     - name: jenkins-deployer
       user:
         token: ${SA_TOKEN}
   EOF
   chmod 600 /tmp/jenkins-k3s.kubeconfig
   ```
   Copy `/tmp/jenkins-k3s.kubeconfig` to upload into Jenkins as `k8s-kubeconfig`, then remove the temporary file (`rm -f /tmp/jenkins-k3s.kubeconfig`). When `scrapbook-pipeline` runs, Jenkins automatically creates/updates the `scrapbook` namespace, `app-secrets`, and `grafana-secret` from `deployment-env`.

### Step 4: Access Jenkins & Configure the Pipeline
Jenkins runs on `scrapbook-jenkins` and binds strictly to `127.0.0.1:8080`. Forward port `8080` over AWS SSM (`aws ssm start-session --target <jenkins_instance_id> --region ap-south-1 --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["8080"],"localPortNumber":["8080"]}'`) to access the Jenkins UI, install standard **Git**, **Pipeline**, and **Credentials Binding** plugins, and configure:
- **Secret file credential `deployment-env`**: upload your local `.env.jenkins` file (delete any plaintext copy from shared folders after upload).
- **Secret file credential `k8s-kubeconfig`**: upload the restricted `jenkins-deployer` kubeconfig (keep separate from `deployment-env`).
- **Global environment variables** (`Manage Jenkins -> System -> Global properties`):
  - `MEDIA_S3_BUCKET` (from Terraform output `media_bucket_name`)
  - `FRONTEND_S3_BUCKET` (from Terraform output `frontend_bucket_name`)
  - `ALB_API_URL` (`http://<alb_dns_name>` from Terraform output `alb_dns_name`)
- **Pipeline job `scrapbook-pipeline`**: Pipeline script from SCM (`Git`), pointing to `main` and `Jenkinsfile`.

---

## 4. Jenkins Application Deployment Pipeline ([`Jenkinsfile`](./Jenkinsfile))

Automates testing, image builds, security checks, Kubernetes secret/manifest deployment, and frontend sync:
1. **Checkout**: Pulls source from GitHub, validates required Jenkins environment variables (`MEDIA_S3_BUCKET`, `FRONTEND_S3_BUCKET`, `ALB_API_URL`; optional `FRONTEND_ORIGIN`) plus all 6 keys inside `deployment-env`, and generates a unique immutable ECR image tag (`<short-sha>-<BUILD_NUMBER>-<UTC-timestamp>`).
2. **Dependency Scan**: Runs `npm audit --audit-level=low` across all 5 microservices.
3. **Static Code Analysis and SAST**: Runs `npm run lint` (`node --check`) on all 5 services and Semgrep (`p/javascript`, `p/nodejs`).
4. **Build Images**: Builds all 5 Docker images using `npm ci --omit=dev`.
5. **Trivy Scan**: Scans each built image for `CRITICAL` vulnerabilities (`--exit-code 1`).
6. **Push to ECR**: Logs in with the Jenkins EC2 IAM role and pushes all 5 images.
7. **Deploy Kubernetes Manifests**: Substitutes placeholders (`<AWS_ACCOUNT_ID>`, `<IMAGE_TAG>`, `<MEDIA_S3_BUCKET>`, `<FRONTEND_S3_WEBSITE_ORIGIN>`), verifies no unreplaced placeholders remain, applies `namespace.yaml`, creates/updates `app-secrets` and `grafana-secret` via `kubectl` using `deployment-env`, and applies ConfigMaps, all 5 microservice Deployments & Services, all 3 HPA manifests, and Prometheus/Grafana monitoring manifests.
8. **Verify Rollouts**: Waits for `kubectl rollout status` on all 5 microservice Deployments plus Prometheus and Grafana.
9. **Deploy Frontend to S3**: Injects `ALB_API_URL` and `LOCATIONIQ_API_KEY` (from `deployment-env`) into `client/js/config.js`, syntax-checks it, and runs `aws s3 sync ... --delete` to `FRONTEND_S3_BUCKET`.

---

## 5. HPA & Monitoring Commands

Kubernetes HPA handles application pod scaling (`1` to `3` pods at `60%` CPU, `60s` scale-down stabilization) via K3s `metrics-server`. Prometheus scrapes individual pods of scalable services (`auth`, `memories`, `social`) via headless metrics Services (`*-service-metrics` with `dns_sd_configs`) for application and scaling observability in Grafana.

### Check HPA & Pod Scaling Activity
```bash
# Inspect HPA targets, current CPU %, and replica counts
kubectl get hpa -n scrapbook
kubectl describe hpa scrapbook-auth-hpa scrapbook-memories-hpa scrapbook-social-hpa -n scrapbook

# Inspect per-pod CPU/memory usage via K3s metrics-server
kubectl top pods -n scrapbook

# Watch pods in the scrapbook namespace
kubectl get pods -n scrapbook -w
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
kubectl port-forward -n scrapbook svc/grafana-service 3000:3000

# Port-forward Prometheus UI
kubectl port-forward -n scrapbook svc/prometheus-service 9090:9090
```
Open `http://localhost:3000` to view the pre-provisioned **Scrapbook Overview** dashboard (Active Service Pods / HPA visibility, Service CPU Utilization %, HTTP Request Rate, and HTTP Error Rate).

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
