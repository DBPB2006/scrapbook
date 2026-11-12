// Canonical Jenkins Pipeline Job: scrapbook-pipeline
pipeline {
    agent any

    triggers {
        pollSCM('H/30 * * * *')
    }

    environment {
        AWS_REGION      = 'ap-south-1'
        SERVICES        = 'auth gateway memories social sharing'
        DOCKER_BUILDKIT = '1'
        DEPLOYMENT_ENV  = credentials('deployment-env')
        KUBECONFIG      = credentials('k8s-kubeconfig')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                sh '''
                    set +x
                    set -eu
                    set -a
                    . "$DEPLOYMENT_ENV"
                    set +a

                    for var in MEDIA_S3_BUCKET FRONTEND_S3_BUCKET ALB_API_URL \
                               JWT_SECRET INTERNAL_SERVICE_SECRET GATEWAY_SHARED_SECRET \
                               MONGODB_URI GRAFANA_ADMIN_PASSWORD LOCATIONIQ_API_KEY; do
                        val="$(printenv "$var" || true)"
                        case "$val" in
                            ''|replace-with-*|*'<URL_ENCODED_PASSWORD>'*)
                                echo "ERROR: Required variable $var is missing or still has a placeholder value." >&2
                                exit 1
                                ;;
                        esac
                    done
                '''
                script {
                    def albUrl = env.ALB_API_URL.trim().replaceAll('/+$', '')
                    env.ALB_API_URL        = albUrl.startsWith('http') ? albUrl : "http://${albUrl}"
                    def defaultOrigin      = "http://${env.FRONTEND_S3_BUCKET.trim()}.s3-website.${env.AWS_REGION}.amazonaws.com"
                    def origin             = (env.FRONTEND_ORIGIN?.trim() ?: defaultOrigin).replaceAll('/+$', '')
                    env.FRONTEND_ORIGIN    = origin.startsWith('http') ? origin : "http://${origin}"
                    env.MEDIA_S3_BUCKET    = env.MEDIA_S3_BUCKET.trim()
                    env.FRONTEND_S3_BUCKET = env.FRONTEND_S3_BUCKET.trim()

                    def sha                = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    def ts                 = sh(script: 'date -u +%Y%m%d%H%M%S', returnStdout: true).trim()
                    env.IMAGE_TAG          = "${sha}-${env.BUILD_NUMBER}-${ts}"
                    env.AWS_ACCOUNT_ID     = sh(script: 'aws sts get-caller-identity --query Account --output text', returnStdout: true).trim()
                    env.ECR_REGISTRY       = "${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com"
                }
            }
        }

        stage('Dependency Scan') {
            steps {
                sh '''
                    set -eu
                    for svc in $SERVICES; do
                        (cd "${svc}-service" && npm audit --audit-level=low)
                    done
                '''
            }
        }

        stage('Static Code Analysis and SAST') {
            steps {
                sh '''
                    set -eu
                    for svc in $SERVICES; do
                        (cd "${svc}-service" && npm run lint)
                    done

                    if command -v semgrep >/dev/null 2>&1; then
                        semgrep scan --config=p/javascript --config=p/nodejs --severity=ERROR --error --metrics=off --exclude=node_modules auth-service gateway-service memories-service social-service sharing-service shared client
                    else
                        docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$(pwd):/src" -w /src semgrep/semgrep:latest \
                            semgrep scan --config=p/javascript --config=p/nodejs --severity=ERROR --error --metrics=off --exclude=node_modules auth-service gateway-service memories-service social-service sharing-service shared client
                    fi
                '''
            }
        }

        stage('Build Images') {
            steps {
                sh '''
                    set -eu
                    for svc in $SERVICES; do
                        docker build -t "${ECR_REGISTRY}/scrapbook-${svc}:${IMAGE_TAG}" -f "${svc}-service/Dockerfile" .
                    done
                '''
            }
        }

        stage('Trivy Scan') {
            steps {
                sh '''
                    set -eu
                    mkdir -p reports/trivy
                    for svc in $SERVICES; do
                        trivy image --exit-code 1 --severity CRITICAL --format table --output "reports/trivy/${svc}-scan.txt" "${ECR_REGISTRY}/scrapbook-${svc}:${IMAGE_TAG}"
                    done
                '''
            }
        }

        stage('Push to ECR') {
            steps {
                sh '''
                    set -eu
                    aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"
                    for svc in $SERVICES; do
                        docker push "${ECR_REGISTRY}/scrapbook-${svc}:${IMAGE_TAG}"
                    done
                '''
            }
        }

        stage('Deploy Kubernetes Manifests') {
            steps {
                sh '''
                    set +x
                    set -eu
                    set -a
                    . "$DEPLOYMENT_ENV"
                    set +a

                    DEPLOY_DIR="$(mktemp -d)"
                    trap 'rm -rf "${DEPLOY_DIR}"' EXIT
                    cp -R deployment/. "${DEPLOY_DIR}/"

                    find "${DEPLOY_DIR}" -type f -name '*.yaml' -exec sed -i \
                        -e "s|<AWS_ACCOUNT_ID>[.]dkr[.]ecr[.][^/]*[.]amazonaws[.]com|${ECR_REGISTRY}|g" \
                        -e "s|<IMAGE_TAG>|${IMAGE_TAG}|g" \
                        -e "s|<MEDIA_S3_BUCKET>|${MEDIA_S3_BUCKET}|g" \
                        -e "s|http://<FRONTEND_S3_WEBSITE_ORIGIN>|${FRONTEND_ORIGIN}|g" {} +

                    if grep -rnE '<[A-Z0-9_]+>' "${DEPLOY_DIR}" --include='*.yaml'; then
                        echo "ERROR: Unreplaced placeholders remain in Kubernetes manifests." >&2
                        exit 1
                    fi

                    kubectl apply -f "${DEPLOY_DIR}/namespace.yaml"

                    kubectl create secret generic app-secrets \
                        --namespace=scrapbook \
                        --from-literal=JWT_SECRET="${JWT_SECRET}" \
                        --from-literal=INTERNAL_SERVICE_SECRET="${INTERNAL_SERVICE_SECRET}" \
                        --from-literal=GATEWAY_SHARED_SECRET="${GATEWAY_SHARED_SECRET}" \
                        --from-literal=MONGODB_URI="${MONGODB_URI}" \
                        --dry-run=client -o yaml | kubectl apply -f -

                    kubectl create secret generic grafana-secret \
                        --namespace=scrapbook \
                        --from-literal=admin-password="${GRAFANA_ADMIN_PASSWORD}" \
                        --dry-run=client -o yaml | kubectl apply -f -

                    for path in config auth memories social sharing gateway monitoring/prometheus monitoring/grafana; do
                        kubectl apply -f "${DEPLOY_DIR}/${path}/"
                    done
                '''
            }
        }

        stage('Verify Rollouts') {
            steps {
                sh '''
                    set -eu
                    for name in auth gateway memories social sharing prometheus grafana; do
                        kubectl rollout status "deployment/scrapbook-${name}" -n scrapbook --timeout=180s
                    done
                '''
            }
        }

        stage('Deploy Frontend to S3') {
            steps {
                sh '''
                    set +x
                    set -eu
                    set -a
                    . "$DEPLOYMENT_ENV"
                    set +a

                    CLIENT_DIR="$(mktemp -d)"
                    trap 'rm -rf "${CLIENT_DIR}"' EXIT
                    cp -R client/. "${CLIENT_DIR}/"

                    sed -i \
                        -e "s|<ALB_API_URL>|${ALB_API_URL}|g" \
                        -e "s|<LOCATIONIQ_API_KEY>|${LOCATIONIQ_API_KEY}|g" \
                        "${CLIENT_DIR}/js/config.js"

                    if grep -qE '<(ALB_API_URL|LOCATIONIQ_API_KEY)>' "${CLIENT_DIR}/js/config.js"; then
                        echo "ERROR: Frontend placeholders were not replaced." >&2
                        exit 1
                    fi

                    node --check "${CLIENT_DIR}/js/config.js"
                    aws s3 sync "${CLIENT_DIR}/" "s3://${FRONTEND_S3_BUCKET}/" --delete
                '''
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
