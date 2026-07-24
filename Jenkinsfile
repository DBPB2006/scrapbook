pipeline {
    agent any

    environment {
        AWS_ACCOUNT_ID = '929140636859'
        AWS_REGION = 'ap-south-1'
        ECR_REGISTRY = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

        EC2_USER = 'ubuntu'
        PLATFORM = 'linux/amd64'
        REPO_DIR = '~/scrapbook'
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build & Push Images') {
            steps {
                sh '''
                docker buildx inspect builder >/dev/null 2>&1 || docker buildx create --name builder --use
                docker buildx use builder
                '''

                withCredentials([
    usernamePassword(
        credentialsId: 'aws-credentials',
        usernameVariable: 'AWS_ACCESS_KEY_ID',
        passwordVariable: 'AWS_SECRET_ACCESS_KEY'
    )
]) {

    sh """
    aws ecr get-login-password --region ${AWS_REGION} | \
    docker login --username AWS --password-stdin ${ECR_REGISTRY}
    """

    // build & push commands
}

                    script {

                        def services = [
                            'auth-service'     : 'scrapbook-auth',
                            'ds-service'       : 'scrapbook-ds',
                            'gateway-service'  : 'scrapbook-gateway',
                            'memories-service' : 'scrapbook-memories',
                            'sharing-service'  : 'scrapbook-sharing',
                            'social-service'   : 'scrapbook-social'
                        ]

                        services.each { service, image ->

                            def context = service == 'gateway-service' ? "." : "./${service}"

                            sh """
                            docker buildx build \
                                --platform ${PLATFORM} \
                                -f ${service}/Dockerfile \
                                -t ${ECR_REGISTRY}/${image}:latest \
                                ${context} \
                                --push
                            """
                        }
                    }
                }
            }
        }

        stage('Deploy to EC2') {
            steps {

                sshagent(credentials: ['ec2-ssh-credentials']) {

                    sh """
                    ssh -o StrictHostKeyChecking=no ${EC2_USER}@\$EC2_HOST << 'EOF'

                    set -e

                    cd ${REPO_DIR}

                    git pull origin main

                    kubectl apply -R -f deployment/

                    kubectl rollout restart deployment/auth-deployment
                    kubectl rollout restart deployment/ds-deployment
                    kubectl rollout restart deployment/gateway-deployment
                    kubectl rollout restart deployment/memories-deployment
                    kubectl rollout restart deployment/sharing-deployment
                    kubectl rollout restart deployment/social-deployment

                    kubectl rollout status deployment/auth-deployment --timeout=300s
                    kubectl rollout status deployment/ds-deployment --timeout=300s
                    kubectl rollout status deployment/gateway-deployment --timeout=300s
                    kubectl rollout status deployment/memories-deployment --timeout=300s
                    kubectl rollout status deployment/sharing-deployment --timeout=300s
                    kubectl rollout status deployment/social-deployment --timeout=300s

                    EOF
                    """
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }

        success {
            echo "Deployment completed successfully."
        }

        failure {
            echo "Deployment failed."
        }
    }
}