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
                docker buildx build --platform linux/amd64 -t ${ECR}/scrapbook-auth:latest -f auth-service/Dockerfile ./auth-service --push

                docker buildx build --platform linux/amd64 -t ${ECR}/scrapbook-ds:latest -f ds-service/Dockerfile ./ds-service --push

                docker buildx build --platform linux/amd64 -t ${ECR}/scrapbook-gateway:latest -f gateway-service/Dockerfile . --push

                docker buildx build --platform linux/amd64 -t ${ECR}/scrapbook-memories:latest -f memories-service/Dockerfile ./memories-service --push

                docker buildx build --platform linux/amd64 -t ${ECR}/scrapbook-sharing:latest -f sharing-service/Dockerfile ./sharing-service --push

                docker buildx build --platform linux/amd64 -t ${ECR}/scrapbook-social:latest -f social-service/Dockerfile ./social-service --push
                """
            }
        }

        stage('Deploy') {
    steps {
        sshagent(credentials: ['ubuntu']) {
            sh '''
                ssh -o StrictHostKeyChecking=no ubuntu@35.154.138.70 '
                    set -e

                    cd ~/scrapbook
                    git pull

                    echo "Refreshing ECR Secret..."

                    kubectl delete secret ecr-secret --ignore-not-found

                    kubectl create secret docker-registry ecr-secret \
                      --docker-server=929140636859.dkr.ecr.ap-south-1.amazonaws.com \
                      --docker-username=AWS \
                      --docker-password="$(aws ecr get-login-password --region ap-south-1)"

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
            '''
        }
    }
}