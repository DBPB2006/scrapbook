pipeline {
    agent any

    environment {
        AWS_REGION = "ap-south-1"
        AWS_ACCOUNT = "929140636859"
        ECR = "${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"

        EC2_HOST = "35.154.138.70"
        EC2_USER = "ubuntu"
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Login to ECR') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'aws-credentials',
                        usernameVariable: 'AWS_ACCESS_KEY_ID',
                        passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                    )
                ]) {
                    sh """
                    /opt/homebrew/bin/aws ecr get-login-password --region ${AWS_REGION} | \
                    docker login --username AWS --password-stdin ${ECR}
                    """
                }
            }
        }

        stage('Build & Push') {
            steps {
                sh """
                docker buildx build --platform linux/amd64 -t ${ECR}/scrapbook-auth:latest -f auth-service/Dockerfile . --push

                docker buildx build --platform linux/amd64 -t ${ECR}/scrapbook-ds:latest -f ds-service/Dockerfile ./ds-service --push

                docker buildx build --platform linux/amd64 -t ${ECR}/scrapbook-gateway:latest -f gateway-service/Dockerfile . --push

                docker buildx build --platform linux/amd64 -t ${ECR}/scrapbook-memories:latest -f memories-service/Dockerfile . --push

                docker buildx build --platform linux/amd64 -t ${ECR}/scrapbook-sharing:latest -f sharing-service/Dockerfile . --push

                docker buildx build --platform linux/amd64 -t ${ECR}/scrapbook-social:latest -f social-service/Dockerfile . --push
                """
            }
        }

        stage('Deploy') {
            steps {
                sshagent(['ec2-ssh-credentials']) {
                    sh """
                    ssh -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_HOST} '
                    set -e

                    cd ~/scrapbook
                    git pull

                    echo "Refreshing ECR Secret..."

                    kubectl delete secret ecr-secret --ignore-not-found
                    kubectl delete secret scrapbook-secrets --ignore-not-found

                    kubectl create secret docker-registry ecr-secret \
                      --docker-server=${ECR} \
                      --docker-username=AWS \
                      --docker-password="\$(aws ecr get-login-password --region ${AWS_REGION})"

                    echo "Checking if storage-pvc needs migration..."
                    if kubectl get pvc storage-pvc -o jsonpath='{.spec.storageClassName}' | grep -q local-path; then
                        echo "Deleting old local-path storage-pvc to allow migration to ebs-hostpath..."
                        kubectl delete pvc storage-pvc --ignore-not-found
                    fi

                    echo "Applying Kubernetes manifests..."

                    kubectl apply -R -f deployment

                    echo "Restarting deployments..."

                    kubectl rollout restart deployment/auth-deployment
                    kubectl rollout restart deployment/ds-deployment
                    kubectl rollout restart deployment/gateway-deployment
                    kubectl rollout restart deployment/memories-deployment
                    kubectl rollout restart deployment/sharing-deployment
                    kubectl rollout restart deployment/social-deployment

                    echo "Waiting for rollouts..."

                    kubectl rollout status deployment/auth-deployment
                    kubectl rollout status deployment/ds-deployment
                    kubectl rollout status deployment/gateway-deployment
                    kubectl rollout status deployment/memories-deployment
                    kubectl rollout status deployment/sharing-deployment
                    kubectl rollout status deployment/social-deployment

                    echo "Deployment completed successfully."
                    '
                    """
                }
            }
        }
    }
}