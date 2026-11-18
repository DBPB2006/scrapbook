pipeline {
    agent any

    environment {
        AWS_REGION     = 'ap-south-1'
        AWS_ACCOUNT_ID = '883270655099'
        ECR_REGISTRY   = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
        IMAGE_TAG      = "${BUILD_NUMBER}"
        
        // Jenkins Credentials
        DEPLOYMENT_ENV = credentials('deployment-env')
        KUBECONFIG     = credentials('k8s-kubeconfig')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build Docker Images') {
            steps {
                sh '''
                    for svc in auth gateway memories social sharing; do
                        echo "Building $svc..."
                        docker build -t ${ECR_REGISTRY}/scrapbook-${svc}:${IMAGE_TAG} -f ${svc}-service/Dockerfile .
                    done
                '''
            }
        }

        stage('Trivy Security Scan') {
            steps {
                sh '''
                    for svc in auth gateway memories social sharing; do
                        echo "Scanning $svc image for vulnerabilities..."
                        trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 0 ${ECR_REGISTRY}/scrapbook-${svc}:${IMAGE_TAG}
                    done
                '''
            }
        }

        stage('Push to ECR') {
            steps {
                sh '''
                    aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}
                    
                    for svc in auth gateway memories social sharing; do
                        echo "Pushing $svc..."
                        docker push ${ECR_REGISTRY}/scrapbook-${svc}:${IMAGE_TAG}
                    done
                '''
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                sh '''
                    set -a
                    . "$DEPLOYMENT_ENV"
                    set +a

                    # 1. Update placeholders in manifests
                    sed -i "s|<AWS_ACCOUNT_ID>|${AWS_ACCOUNT_ID}|g" deployment/*/*.yaml
                    sed -i "s|<IMAGE_TAG>|${IMAGE_TAG}|g" deployment/*/*.yaml
                    sed -i "s|<MEDIA_S3_BUCKET>|${MEDIA_S3_BUCKET}|g" deployment/config/app-config.yaml
                    sed -i "s|http://<FRONTEND_S3_WEBSITE_ORIGIN>|http://${FRONTEND_S3_BUCKET}.s3-website.${AWS_REGION}.amazonaws.com|g" deployment/gateway/deployment.yaml

                    # 2. Apply Namespace and Secrets
                    kubectl apply -f deployment/namespace.yaml

                    kubectl create secret generic app-secrets -n scrapbook \
                        --from-literal=JWT_SECRET="${JWT_SECRET}" \
                        --from-literal=INTERNAL_SERVICE_SECRET="${INTERNAL_SERVICE_SECRET}" \
                        --from-literal=GATEWAY_SHARED_SECRET="${GATEWAY_SHARED_SECRET}" \
                        --from-literal=MONGODB_URI="${MONGODB_URI}" \
                        --dry-run=client -o yaml | kubectl apply -f -

                    kubectl create secret generic grafana-secret -n scrapbook \
                        --from-literal=admin-password="${GRAFANA_ADMIN_PASSWORD}" \
                        --dry-run=client -o yaml | kubectl apply -f -

                    # 3. Apply all workload and monitoring manifests
                    kubectl apply -f deployment/config/
                    kubectl apply -f deployment/auth/
                    kubectl apply -f deployment/memories/
                    kubectl apply -f deployment/social/
                    kubectl apply -f deployment/sharing/
                    kubectl apply -f deployment/gateway/
                    kubectl apply -f deployment/monitoring/prometheus/
                    kubectl apply -f deployment/monitoring/grafana/
                '''
            }
        }

        stage('Deploy Frontend to S3') {
            steps {
                sh '''
                    set -a
                    . "$DEPLOYMENT_ENV"
                    set +a

                    # Set ALB endpoint in frontend config and sync to S3
                    sed -i "s|<ALB_API_URL>|${ALB_API_URL}|g" client/js/config.js
                    sed -i "s|<LOCATIONIQ_API_KEY>|${LOCATIONIQ_API_KEY}|g" client/js/config.js
                    
                    aws s3 sync client/ s3://${FRONTEND_S3_BUCKET}/ --delete
                '''
            }
        }
    }
}
