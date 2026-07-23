# Scrapbook - Microservices Architecture

Scrapbook is a microservices-based application running on Node.js and Docker. 

## Services
- **Gateway Service** (Port 3090): Routes traffic and serves the frontend client.
- **Auth Service** (Port 3001): Handles user authentication, session, and profiles.
- **Memories Service** (Port 3002): Handles memories creation and retrieval.
- **Social Service** (Port 3003): Handles friends and network suggestions.
- **Sharing Service** (Port 3004): Handles shared memory capsules.
- **Data Structure (DS) Service** (Port 3005 internal): Internal service managing the custom Bucketed Hash Map for persistence and performance.

## Running with Docker (Production Ready)

The application is fully containerized using Docker and Docker Compose. 

### Prerequisites
- Docker
- Docker Compose

### Environment Variables
Environment variables are injected automatically via `docker-compose.yml`. Each service uses the following key variables:
- `PORT`: The internal port the microservice runs on.
- `UPLOAD_DIR`: Defines where file uploads are temporarily processed or stored before volumes map them.
- `*_SERVICE_URL`: Service discovery URLs to communicate internally over Docker DNS (e.g. `http://auth-service:3001`).

### Port Mappings
- **Host Port `3090`** maps to Gateway Service. This is the only exposed port.
- All other ports (`3001`, `3002`, `3003`, `3004`, `3005`) are kept securely internal within the Docker network.

### Volume Mappings
- **Data persistence**: JSON stores (`users.json`, `memories.json`, etc.) are persisted using local volumes (e.g. `./auth-service/data:/usr/src/app/data`).
- **Uploads**: Media uploads are persisted and shared via a root volume (`./uploads:/usr/src/app/uploads`).
- **Frontend**: The static frontend client is mounted into the Gateway (`./client:/usr/src/app/pages`).

### Docker Commands

#### Build the images
To build (or rebuild) the images after a code change:
```bash
docker-compose build
```

To build a specific service individually:
```bash
docker-compose build auth-service
```

#### Start the containers
To start the entire application in detached mode:
```bash
docker-compose up -d
```
The application will be available at `http://localhost:3090`.

#### Stop the containers
To stop the application gracefully:
```bash
docker-compose down
```

#### Restart containers
```bash
docker-compose restart
```

## Running Locally (Without Docker)
For local development without Docker, you can create a `.env` file in each microservice directory using the provided `.env.example` template and run `npm install && node <service>_server.js`.

## Production Deployment (AWS / Kubernetes)

The repository contains the final deployment configuration for a single-node Kubernetes (K3s) cluster running on an AWS EC2 instance. All deployment manifests are located in the `deployment/` directory.

### 1. Build Docker Images
Build the Docker images for all microservices from the project root:
```bash
for SERVICE in gateway auth memories social sharing ds; do
  docker build -t scrapbook_${SERVICE}:latest -f ${SERVICE}-service/Dockerfile .
done
```

### 2. Authenticate with Amazon ECR
```bash
export AWS_REGION="us-east-1"
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
```

### 3. Tag Images
```bash
for SERVICE in gateway auth memories social sharing ds; do
  docker tag scrapbook_${SERVICE}:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/scrapbook-${SERVICE}:latest
done
```

### 4. Push Images to ECR
Ensure your ECR repositories are created, then push the images:
```bash
for SERVICE in gateway auth memories social sharing ds; do
  docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/scrapbook-${SERVICE}:latest
done
```

### 5. EC2 Instance Preparation
1. Launch an Ubuntu 22.04 or Amazon Linux 2023 EC2 instance (minimum `t3.medium`).
2. Attach an IAM role with `AmazonEC2ContainerRegistryReadOnly` permissions.
3. Allow inbound TCP on port `30090` (Gateway NodePort) in the Security Group.
4. SSH into the instance and install K3s:
   ```bash
   curl -sfL https://get.k3s.io | sh -
   mkdir -p ~/.kube && sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
   sudo chown $(id -u):$(id -g) ~/.kube/config
   ```

### 6. Deploy Kubernetes Manifests
Once your EC2 instance is ready, clone this repository onto the instance. Then, deploy the manifests in order:
```bash
# Apply configuration and storage
kubectl apply -f deployment/config/
kubectl apply -f deployment/storage/

# Apply microservices
for svc in auth ds gateway memories sharing social; do
  kubectl apply -f deployment/${svc}/
done
```

### 7. Verify Deployment
Verify that the pods, services, and storage are running correctly:
```bash
# Verify Pods
kubectl get pods

# Verify Services
kubectl get svc

# Verify Persistent Volumes
kubectl get pvc
```

### 8. Accessing the Application
The Gateway service is exposed externally using a `NodePort`. Once the pods are fully running, you can access the application via your EC2 instance's public IP:
```
http://<EC2_PUBLIC_IP>:30090
```
