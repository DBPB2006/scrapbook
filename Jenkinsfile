pipeline {
    agent any

    triggers {
        githubPush()
    }

    environment {
        AWS_REGION     = 'ap-south-1'
        SERVICES       = 'auth gateway memories social sharing'
        AWS_ACCOUNT_ID = ''
        ECR_REGISTRY   = ''
        IMAGE_TAG      = ''
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                withCredentials([usernamePassword(
                    credentialsId: 'aws-credentials',
                    usernameVariable: 'AWS_ACCESS_KEY_ID',
                    passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                )]) {
                    script {
                        IMAGE_TAG = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                        AWS_ACCOUNT_ID = sh(script: 'aws sts get-caller-identity --query Account --output text', returnStdout: true).trim()
                        ECR_REGISTRY = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
                        env.IMAGE_TAG = IMAGE_TAG
                        env.AWS_ACCOUNT_ID = AWS_ACCOUNT_ID
                        env.ECR_REGISTRY = ECR_REGISTRY
                    }
                }
            }
        }

        stage('Dependency Scan') {
            steps {
                sh """
                for svc in ${SERVICES}; do
                    (cd \${svc}-service && npm audit --audit-level=critical)
                done
                """
            }
        }

        stage('Static Code Analysis') {
            steps {
                sh """
                for svc in ${SERVICES}; do
                    (cd \${svc}-service && npm run lint)
                done
                """
            }
        }

        stage('Build Images') {
            steps {
                sh """
                for svc in ${SERVICES}; do
                    docker build -t ${ECR_REGISTRY}/scrapbook-\${svc}:${IMAGE_TAG} -f \${svc}-service/Dockerfile .
                done
                """
            }
        }

        stage('Trivy Scan') {
            steps {
                sh """
                mkdir -p reports/trivy
                for svc in ${SERVICES}; do
                    trivy image --severity CRITICAL --format table --output reports/trivy/\${svc}-scan.txt ${ECR_REGISTRY}/scrapbook-\${svc}:${IMAGE_TAG}
                    trivy image --exit-code 1 --severity CRITICAL ${ECR_REGISTRY}/scrapbook-\${svc}:${IMAGE_TAG}
                done
                """
            }
        }

        stage('Push to ECR') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'aws-credentials',
                    usernameVariable: 'AWS_ACCESS_KEY_ID',
                    passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                )]) {
                    sh """
                    aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}
                    for svc in ${SERVICES}; do
                        docker push ${ECR_REGISTRY}/scrapbook-\${svc}:${IMAGE_TAG}
                    done
                    """
                }
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                withCredentials([
                    file(credentialsId: 'k8s-kubeconfig', variable: 'KUBECONFIG')
                ]) {
                    sh """
                    kubectl apply -f deployment/namespace.yaml
                    kubectl apply -f deployment/config/
                    kubectl apply -f deployment/auth/
                    kubectl apply -f deployment/memories/
                    kubectl apply -f deployment/social/
                    kubectl apply -f deployment/sharing/
                    kubectl apply -f deployment/gateway/
                    kubectl apply -f deployment/monitoring/prometheus/
                    kubectl apply -f deployment/monitoring/grafana/

                    for svc in ${SERVICES}; do
                        kubectl set image deployment/\${svc}-service \${svc}-service=${ECR_REGISTRY}/scrapbook-\${svc}:${IMAGE_TAG} -n memorybook
                    done

                    for svc in ${SERVICES}; do
                        kubectl rollout status deployment/\${svc}-service -n memorybook --timeout=180s
                    done
                    """
                }
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'reports/trivy/*.txt', allowEmptyArchive: true
            cleanWs notFailBuild: true
        }
    }
}
