# Memory Book — Kubernetes (K3s) Deployment

This directory contains the Kubernetes orchestration manifests for the **Memory Book** platform running on **K3s**.

Workloads are deployed service by service following strict verification and architectural isolation principles.

---

## 1. Directory Structure

```text
deployment/
├── README.md
├── namespace.yaml
├── config/
│   └── auth-config.yaml
├── auth/
│   ├── deployment.yaml
│   └── service.yaml
├── gateway/          # (Step 6)
├── memories/         # (Step 3)
├── social/           # (Step 4)
├── sharing/          # (Step 5)
└── monitoring/       # (Step 7)
    ├── prometheus/
    └── grafana/
```

| File / Directory | Description | Status |
| :--- | :--- | :--- |
| `namespace.yaml` | Dedicated `memorybook` Kubernetes namespace | **Implemented** |
| `config/auth-config.yaml` | Non-sensitive runtime configuration for Auth Service | **Implemented** |
| `auth/` | Auth Service deployment (Port 3001, Probes, Resources) & ClusterIP | **Implemented** |
| `memories/` | Memories Service deployment (Port 3002, S3 Media, Probes) & ClusterIP | **Implemented** |
| `social/` | Social Service deployment (Port 3003, Graph/BFS, Probes) & ClusterIP | **Implemented** |
| `sharing/` | Sharing Service deployment (Port 3004, Min-Heap, Probes) & ClusterIP | **Implemented** |
| `gateway/` | Gateway Service deployment (Port 3090) & NodePort Service (30090) | **Implemented** |
| `monitoring/` | Prometheus (9090) & Grafana (3000) telemetry manifests | **Implemented** |

---

## 2. Shared Foundation & Auth Service Specification

### Network & DNS
- **Namespace**: `memorybook`
- **Internal Service DNS**: `auth-service.memorybook.svc.cluster.local:3001` (or short-name `auth-service:3001` within the namespace)
- **Service Type**: `ClusterIP`

### Health & Monitoring Endpoints
- **Liveness Probe**: `GET /health` on port `3001`
- **Readiness Probe**: `GET /health` on port `3001`
- **Prometheus Metrics**: `GET /metrics` on port `3001`

### Compute & Resource Allocation
- **Replicas**: 1 (Single-node K3s host on `t3.small`)
- **CPU Request / Limit**: `100m` / `250m`
- **Memory Request / Limit**: `128Mi` / `256Mi`

### Database & Cloud Storage
- **MongoDB**: External self-hosted MongoDB Community Edition running on dedicated private EC2 instance. (Never deployed inside Kubernetes).
- **Amazon S3**: Private media bucket (`scrapbook-media`). IAM permissions are assumed automatically via the K3s host's EC2 Instance Profile (`memorybook-k3s-instance-profile`). No static AWS keys are stored in Kubernetes YAML.

---

## 3. Deployment Instructions

### Prerequisites
1. Ensure the K3s cluster is running and accessible via `kubectl`.
2. Ensure MongoDB Community Server is running on the dedicated private EC2 instance and accepting connections from the K3s security group on port 27017.

### Step 1: Build Local Container Image
From the repository root (`scrapbook-main/`):
```bash
docker build -t scrapbook-auth:latest -f auth-service/Dockerfile .
```
*(If testing on a standalone K3s node, import the image into K3s containerd using `k3s ctr images import` or tag and push to local registry).*

### Step 2: Apply Namespace
```bash
kubectl apply -f deployment/namespace.yaml
```

### Step 3: Supply the Application Secrets (`app-secrets`) & Monitoring Secret
To keep Git history secure, secrets are never committed into YAML files. Create the secrets directly in the cluster using `kubectl`:

```bash
# 1. Unified Application Secret for all 5 microservices
kubectl create secret generic app-secrets \
  --namespace=memorybook \
  --from-literal=JWT_SECRET="<your-production-jwt-secret>" \
  --from-literal=INTERNAL_SERVICE_SECRET="<your-internal-service-secret>" \
  --from-literal=GATEWAY_SHARED_SECRET="<your-gateway-shared-secret>" \
  --from-literal=MONGODB_URI="mongodb://<app_user>:<app_password>@<mongodb-ec2-private-ip>:27017/memorybook?authSource=admin"

# 2. Grafana Administrator Password Secret
kubectl create secret generic grafana-secret \
  --namespace=memorybook \
  --from-literal=admin-password="<your-grafana-admin-password>"
```

### Step 4: Apply ConfigMap, Workloads, and Monitoring
```bash
kubectl apply -f deployment/config/
kubectl apply -f deployment/auth/
kubectl apply -f deployment/memories/
kubectl apply -f deployment/social/
kubectl apply -f deployment/sharing/
kubectl apply -f deployment/gateway/
kubectl apply -f deployment/monitoring/prometheus/
kubectl apply -f deployment/monitoring/grafana/
```

### Step 5: Verification & Inspection
```bash
# Check Pod status
kubectl get pods -n memorybook -l app=auth-service

# Check Service status
kubectl get svc -n memorybook -l app=auth-service

# Stream Pod logs
kubectl logs -n memorybook -l app=auth-service -f

# Verify Health Endpoint from within cluster
kubectl run curl-test --rm -it --restart=Never --namespace=memorybook --image=curlimages/curl -- http://auth-service:3001/health
```
