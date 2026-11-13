# Scrapbook — A DSA-Driven Cloud-Native Social Memory Platform

[![CI/CD](https://img.shields.io/badge/CI%2FCD-Jenkins-blue?logo=jenkins)](./Jenkinsfile)
[![Kubernetes](https://img.shields.io/badge/Orchestration-K3s-informational?logo=kubernetes)](./deployment)
[![IaC](https://img.shields.io/badge/IaC-Terraform-purple?logo=terraform)](./terraform)
[![Monitoring](https://img.shields.io/badge/Monitoring-Prometheus%20%2B%20Grafana-red?logo=prometheus)](./deployment/monitoring)

Scrapbook is a cloud-native social memory platform that enables users to create, organize, and selectively share personal memories and time capsules. The backend runs as five Node.js/Express microservices orchestrated on single-node **K3s** (`scrapbook` namespace), provisioned on AWS with **Terraform**, deployed via **Jenkins** ([`Jenkinsfile`](./Jenkinsfile)), backed by self-hosted **MongoDB Community Edition 8.0** on EC2 (`scrapbook` database) and **Amazon S3**, and monitored with **Prometheus** and **Grafana**.

---

## Quick Access & URL Reference

| Service / Interface | Access Method | URL / Command | Credentials / Notes |
| :--- | :--- | :--- | :--- |
| **Frontend Web App** | Direct Browser (Public) | [`http://scrapbook-frontend-883270655099.s3-website.ap-south-1.amazonaws.com`](http://scrapbook-frontend-883270655099.s3-website.ap-south-1.amazonaws.com) | Open in any browser. Served statically from S3. |
| **Public API (ALB)** | HTTP Port 80 (Public) | `http://<alb_dns_name>` | Internet-facing ALB forwarding to API Gateway (`:30090`). |
| **Grafana Monitoring** | AWS SSM Port-Forward | `http://localhost:3000` | User: `admin` \| Password: from `grafana-secret` |
| **Prometheus UI** | AWS SSM Port-Forward | `http://localhost:9090` | View scrape targets at `http://localhost:9090/targets` |
| **Jenkins CI/CD** | AWS SSM Port-Forward | `http://localhost:8080` | Initial pass from `/var/lib/jenkins/secrets/initialAdminPassword` |
| **K3s Node Shell** | AWS SSM Session | `aws ssm start-session --target <k3s_instance_id>` | Single-node Kubernetes host in private subnet. |
| **Database Shell** | AWS SSM Session | `aws ssm start-session --target <mongodb_instance_id>` | MongoDB 8.0 server on private EC2. |

---

## 1. Architecture & Components

```
                              [ Users / Web Browsers ]
                                         │
                        ┌────────────────┴────────────────┐
                        ▼                                 ▼
         [ Amazon S3 Static Site ]          [ Application Load Balancer ]
         (client/ HTML/CSS/Vanilla JS)                    │ HTTP :80 -> :30090
         http://<frontend_website_endpoint>               ▼
                                            [ Gateway Service (:3090) ]
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

### Microservices & Algorithms

| Microservice | Port | Scaling | Responsibility | Algorithm / Data Structure |
| :--- | :---: | :---: | :--- | :--- |
| **Gateway Service** | `3090` | 1 replica (no HPA) | Single API entrypoint, `trust proxy` client IP resolution, JWT Bearer verification, header sanitization, auth rate limiting, and reverse proxy routing. | Windowed request counter rate limiting on `/api/login` & `/api/signup`. |
| **Auth Service** | `3001` | HPA `1–3` (60% CPU) | Registration, async bcrypt login, JWT issuance, profile management, friend cleanup, and dashboard aggregation. | **A–Z Bucketed Hash Table** ([`auth-service/src/bucket_user_store.js`](./auth-service/src/bucket_user_store.js)). |
| **Memories Service** | `3002` | HPA `1–3` (60% CPU) | Memory CRUD, chronological sorting/pagination, and private S3 media uploads/presigning. | **Chronological Sort & Pagination** ([`memories-service/src/memory_store.js`](./memories-service/src/memory_store.js)). |
| **Social Service** | `3003` | HPA `1–3` (60% CPU) | Mutual friend requests, friend removal, friendship graph, and 2-hop suggestions. | **Adjacency List Graph** ([`social-service/src/social_graph.js`](./social-service/src/social_graph.js)) & **Bounded BFS Queue** ([`social-service/src/social_queue.js`](./social-service/src/social_queue.js)). |
| **Sharing Service** | `3004` | 1 replica (no HPA) | Selective memory sharing and locked time capsules with reveal dates. | **Binary Min-Heap** ([`sharing-service/src/min_heap.js`](./sharing-service/src/min_heap.js)) & **TimeStack** ([`sharing-service/src/time_stack.js`](./sharing-service/src/time_stack.js)). |

Shared backend modules live in [`shared/`](./shared):
- [`shared/mongodb.js`](./shared/mongodb.js): Authenticated MongoDB client, pooling, reconnect loop, health ping, startup indexes, and transaction detection.
- [`shared/service_common.js`](./shared/service_common.js): Email/friend helpers, Gateway/internal auth middleware, `/health` & `/health/live`, and graceful shutdown.
- [`shared/s3_storage.js`](./shared/s3_storage.js): S3 SDK v3 uploads, magic-byte validation, presigned view/download URLs, and key cleanup.
- [`shared/metrics.js`](./shared/metrics.js): `prom-client` `/metrics` middleware (`process_cpu_seconds_total`, `http_requests_total`, `http_errors_total`, `http_request_duration_seconds`, and business counters).

---

## 2. Accessing the Frontend & Application Flow

### Opening the Website in your Browser
To find your live website URL, run:
```bash
terraform -chdir=terraform output -raw frontend_website_endpoint
```
Open the output URL in any web browser:
```
http://scrapbook-frontend-883270655099.s3-website.ap-south-1.amazonaws.com
```

### How Frontend Requests Reach the Backend
1. **Dynamic Config**: During CI/CD deployment, Jenkins substitutes `<ALB_API_URL>` (from Terraform output `alb_dns_name`) and `<LOCATIONIQ_API_KEY>` into [`client/js/config.js`](./client/js/config.js) before syncing `client/` to the frontend S3 bucket.
2. **Browser Execution**:
   - `client/js/config.js` sets `axios.defaults.baseURL = API_BASE_URL` (points to the public ALB).
   - Authenticated requests attach `Authorization: Bearer <token>` stored in browser `sessionStorage`.
3. **Gateway Ingress**:
   - Browser API requests reach the **Application Load Balancer** on port `80`, which forwards them to K3s NodePort `30090`.
   - **Gateway Service** verifies the JWT, sanitizes spoofable headers, injects trusted headers (`x-user-email`, `x-gateway-secret`), and reverse-proxies `/api/*` requests to internal microservices.
4. **Media Handling**:
   - Uploads stream through Gateway to the microservices, which store objects in the private S3 bucket and return presigned URLs to the browser for viewing and downloading.

---

## 3. How to Connect to Private EC2 Instances via AWS SSM

Because all servers run inside private VPC subnets with no public IPs, connect securely using AWS Systems Manager (SSM) without SSH keys:

### 1. Connect to the Jenkins Server
Get the Jenkins instance ID:
```bash
terraform -chdir=terraform output -raw jenkins_instance_id
```

* **Terminal Shell**:
  ```bash
  aws ssm start-session --target <jenkins_instance_id> --region ap-south-1
  ```
* **Web UI (Browser)**:
  Forward port `8080` to your local machine:
  ```bash
  aws ssm start-session \
    --target <jenkins_instance_id> \
    --region ap-south-1 \
    --document-name AWS-StartPortForwardingSession \
    --parameters '{"portNumber":["8080"],"localPortNumber":["8080"]}'
  ```
  Open **[http://localhost:8080](http://localhost:8080)**. (To get the initial password: `sudo cat /var/lib/jenkins/secrets/initialAdminPassword`).

---

### 2. Connect to the K3s Kubernetes Server
Get the K3s instance ID:
```bash
terraform -chdir=terraform output -raw k3s_instance_id
```

* **Terminal Shell**:
  ```bash
  aws ssm start-session --target <k3s_instance_id> --region ap-south-1
  ```
  *(Remember to use `sudo kubectl ...` or `sudo -i`)*

---

### 3. Connect to the MongoDB Database Server
Get the MongoDB instance ID:
```bash
terraform -chdir=terraform output -raw mongodb_instance_id
```

* **Terminal Shell**:
  ```bash
  aws ssm start-session --target <mongodb_instance_id> --region ap-south-1
  ```
  Connect to the database:
  ```bash
  sudo mongosh -u scrapbook_app -p '<password>' --authenticationDatabase scrapbook scrapbook
  ```

---

## 4. Accessing Prometheus & Grafana Monitoring

Prometheus and Grafana run as internal cluster services in the `scrapbook` namespace. Access them via a two-step port-forward:

### Accessing Grafana (Port 3000)

1. **Terminal 1 (EC2 Shell via SSM)**:
   ```bash
   aws ssm start-session --target <k3s_instance_id> --region ap-south-1
   ```
   Inside the instance shell, run:
   ```bash
   sudo kubectl port-forward -n scrapbook svc/grafana-service 3000:3000 --address 0.0.0.0
   ```
2. **Terminal 2 (Your Local Mac/PC)**:
   ```bash
   aws ssm start-session \
     --target <k3s_instance_id> \
     --region ap-south-1 \
     --document-name AWS-StartPortForwardingSession \
     --parameters '{"portNumber":["3000"],"localPortNumber":["3000"]}'
   ```
3. Open **[http://localhost:3000](http://localhost:3000)** in your browser.
   * **User**: `admin`
   * **Password**: Get the secret value via `sudo kubectl get secret -n scrapbook grafana-secret -o jsonpath="{.data.admin-password}" | base64 --decode && echo`
   * **Dashboard**: Navigate to **Dashboards > Scrapbook Overview**.

### Accessing Prometheus (Port 9090)

1. **Terminal 1 (EC2 Shell via SSM)**:
   ```bash
   sudo kubectl port-forward -n scrapbook svc/prometheus-service 9090:9090 --address 0.0.0.0
   ```
2. **Terminal 2 (Your Local Mac/PC)**:
   ```bash
   aws ssm start-session \
     --target <k3s_instance_id> \
     --region ap-south-1 \
     --document-name AWS-StartPortForwardingSession \
     --parameters '{"portNumber":["9090"],"localPortNumber":["9090"]}'
   ```
3. Open **[http://localhost:9090](http://localhost:9090)** in your browser.
   * Scrape target health: **[http://localhost:9090/targets](http://localhost:9090/targets)**
   * Active condition alert rules: **[http://localhost:9090/alerts](http://localhost:9090/alerts)**

---

## 5. Monitoring Dashboard & Alert Rules

### Grafana 10-Panel Dashboard (`scrapbook-overview`)
The provisioned Grafana dashboard covers:
1. **Microservice Health Status**: Live stat panel for `auth`, `gateway`, `memories`, `social`, and `sharing`.
2. **Active Firing Alarms**: Real-time counter of alerts in firing state.
3. **Active Service Pods (HPA Visibility)**: Pod count per service reflecting autoscaling.
4. **Service CPU Utilization (%)**: Per-service CPU consumption.
5. **P95 Request Latency (ms)**: 95th-percentile response latency per endpoint.
6. **Service Memory Utilization (MB)**: Resident memory footprint per pod.
7. **HTTP Request Rate (req/s)**: Total request throughput across services.
8. **HTTP Error Rate (4xx/5xx req/s)**: Rate of client and server errors.
9. **Application Activity**: Live rates for memories created, memories shared, and user signups.
10. **Authentication & Security**: Successful vs failed logins and HTTP 429 rate-limiting events.

### Built-In Prometheus Alerts
Defined in [`deployment/monitoring/prometheus/configmap.yaml`](./deployment/monitoring/prometheus/configmap.yaml):
* **`ServicePodDown`**: Triggers if a microservice pod stops responding for > 1m.
* **`HighCpuUtilization`**: Triggers if service CPU utilization exceeds 75% for 2m.
* **`HighMemoryUsage`**: Triggers if a pod's resident memory exceeds 150MB for 3m.
* **`HighHttpErrorRate`**: Triggers if API 4xx/5xx error rate exceeds 0.5 errors/sec.
* **`RateLimitExceeded`**: Triggers when Gateway throttles incoming traffic with HTTP 429.
* **`FrequentPodRestarts`**: Triggers if a pod restarts more than twice in 15m.
* **`HighFailedLogins`**: Detects spikes in failed authentication attempts.

---

## 6. AWS Provisioning & CI/CD Deployment Steps

### Step 1: Provision AWS Infrastructure with Terraform
```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan -out=main.tfplan
terraform apply main.tfplan
terraform output
```

### Step 2: Initialize MongoDB (via SSM)
Connect to `scrapbook-mongodb` via SSM and run:
```bash
export MONGODB_ADMIN_USER="<admin_username>"
export MONGODB_ADMIN_PASSWORD="<strong-admin-password>"
export MONGODB_APP_USER="scrapbook_app"
export MONGODB_APP_PASSWORD="<strong-app-password>"
export MONGODB_DATABASE="scrapbook"
bash scripts/init-mongodb.sh
```

### Step 3: Configure Jenkins Pipeline Credentials
1. Create `.env.jenkins` from `.env.jenkins.example` with required secrets:
   ```bash
   cp .env.jenkins.example .env.jenkins
   chmod 600 .env.jenkins
   ```
2. Generate a restricted `jenkins-deployer` kubeconfig on `scrapbook-k3s` (via SSM) and upload it to Jenkins as secret file credential `k8s-kubeconfig`.
3. In Jenkins UI (`http://localhost:8080`), upload `.env.jenkins` as secret file credential `deployment-env`.
4. Configure global properties:
   - `MEDIA_S3_BUCKET` (from Terraform output `media_bucket_name`)
   - `FRONTEND_S3_BUCKET` (from Terraform output `frontend_bucket_name`)
   - `ALB_API_URL` (`http://<alb_dns_name>`)
5. Run the pipeline job `scrapbook-pipeline`.

---

## 7. Local Syntax & Manifest Verification

Prerequisites: Node.js 20+, npm 10+, Ruby (for YAML validation).
```bash
# 1. Run lint checks across all 5 microservices
for svc in auth gateway memories sharing social; do
  (cd "${svc}-service" && npm run lint)
done

# 2. Syntax-check shared modules and frontend scripts
for f in shared/*.js; do node --check "$f"; done
find client -name '*.js' -print0 | xargs -0 -n1 node --check

# 3. Validate Kubernetes YAML manifests
ruby -ryaml -e '
Dir.glob("deployment/**/*.yaml").each { |f| YAML.load_file(f); puts "Valid YAML: #{f}" }
'
```
