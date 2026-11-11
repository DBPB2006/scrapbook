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
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    def missing = []
                    for (entry in [
                        MEDIA_S3_BUCKET   : env.MEDIA_S3_BUCKET,
                        FRONTEND_S3_BUCKET: env.FRONTEND_S3_BUCKET,
                        ALB_API_URL       : env.ALB_API_URL,
                        LOCATIONIQ_API_KEY: env.LOCATIONIQ_API_KEY
                    ]) {
                        if (!entry.value?.trim()) { missing << entry.key }
                    }
                    if (missing) {
                        error "Missing required Jenkins environment variables: ${missing.join(', ')}"
                    }
                    def albUrl = env.ALB_API_URL.trim().replaceAll('/+$', '')
                    env.ALB_API_URL = (albUrl.startsWith('http://') || albUrl.startsWith('https://')) ? albUrl : "http://${albUrl}"

                    def defaultOrigin = "http://${env.FRONTEND_S3_BUCKET.trim()}.s3-website.${env.AWS_REGION}.amazonaws.com"
                    def origin = (env.FRONTEND_ORIGIN?.trim() ?: defaultOrigin).replaceAll('/+$', '')
                    env.FRONTEND_ORIGIN = (origin.startsWith('http://') || origin.startsWith('https://')) ? origin : "http://${origin}"

                    env.MEDIA_S3_BUCKET    = env.MEDIA_S3_BUCKET.trim()
                    env.FRONTEND_S3_BUCKET = env.FRONTEND_S3_BUCKET.trim()
                    env.LOCATIONIQ_API_KEY = env.LOCATIONIQ_API_KEY.trim()
                    def gitShortSha = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    def buildTimestamp = sh(script: 'date -u +%Y%m%d%H%M%S', returnStdout: true).trim()
                    env.IMAGE_TAG          = gitShortSha ? "${gitShortSha}-${env.BUILD_NUMBER}-${buildTimestamp}" : ''
                    env.AWS_ACCOUNT_ID     = sh(script: 'aws sts get-caller-identity --query Account --output text', returnStdout: true).trim()
                    if (!env.IMAGE_TAG || !env.AWS_ACCOUNT_ID) {
                        error 'Failed to resolve Git commit SHA or AWS account ID from Jenkins EC2 IAM role.'
                    }
                    env.ECR_REGISTRY = "${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com"
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

                    run_semgrep() {
                        if command -v semgrep >/dev/null 2>&1; then
                            semgrep "$@"
                        else
                            docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$(pwd):/src" -w /src semgrep/semgrep:latest semgrep "$@"
                        fi
                    }

                    run_semgrep scan --config=p/javascript --config=p/nodejs --severity=ERROR --error --metrics=off --exclude=node_modules auth-service gateway-service memories-service social-service sharing-service shared client
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
                withCredentials([file(credentialsId: 'k8s-kubeconfig', variable: 'KUBECONFIG')]) {
                    sh '''
                        set -eu
                        RENDER_DIR="$(mktemp -d)"
                        trap 'rm -rf "${RENDER_DIR}"' EXIT
                        cp -R deployment/. "${RENDER_DIR}/"

                        for manifest in $(find "${RENDER_DIR}" -type f -name '*.yaml'); do
                            sed -e "s|<AWS_ACCOUNT_ID>\.dkr\.ecr\.[^/]*\.amazonaws\.com|${ECR_REGISTRY}|g" -e "s|<IMAGE_TAG>|${IMAGE_TAG}|g" -e "s|<MEDIA_S3_BUCKET>|${MEDIA_S3_BUCKET}|g" -e "s|http://<FRONTEND_S3_WEBSITE_ORIGIN>|${FRONTEND_ORIGIN}|g" "${manifest}" > "${manifest}.tmp"
                            mv "${manifest}.tmp" "${manifest}"
                        done

                        if grep -rnE '<[A-Z0-9_]+>' "${RENDER_DIR}" --include='*.yaml'; then
                            echo "ERROR: Unreplaced placeholders remain in Kubernetes manifests." >&2
                            exit 1
                        fi

                        kubectl apply -f "${RENDER_DIR}/namespace.yaml"
                        kubectl apply -f "${RENDER_DIR}/config/"
                        kubectl apply -f "${RENDER_DIR}/auth/"
                        kubectl apply -f "${RENDER_DIR}/memories/"
                        kubectl apply -f "${RENDER_DIR}/social/"
                        kubectl apply -f "${RENDER_DIR}/sharing/"
                        kubectl apply -f "${RENDER_DIR}/gateway/"
                        kubectl apply -f "${RENDER_DIR}/monitoring/prometheus/"
                        kubectl apply -f "${RENDER_DIR}/monitoring/grafana/"
                    '''
                }
            }
        }

        stage('Verify Rollouts') {
            steps {
                withCredentials([file(credentialsId: 'k8s-kubeconfig', variable: 'KUBECONFIG')]) {
                    sh '''
                        set -eu
                        for svc in $SERVICES; do
                            kubectl rollout status "deployment/scrapbook-${svc}" -n scrapbook --timeout=180s
                        done
                        kubectl rollout status deployment/scrapbook-prometheus -n scrapbook --timeout=180s
                        kubectl rollout status deployment/scrapbook-grafana -n scrapbook --timeout=180s
                    '''
                }
            }
        }

        stage('Deploy Frontend to S3') {
            steps {
                sh '''
                    set -eu
                    CLIENT_DIR="$(mktemp -d)"
                    trap 'rm -rf "${CLIENT_DIR}"' EXIT
                    cp -R client/. "${CLIENT_DIR}/"

                    node -e '
                        const fs = require("fs");
                        const path = process.argv[1];
                        const apiUrl = (process.env.ALB_API_URL || "").trim();
                        const apiKey = (process.env.LOCATIONIQ_API_KEY || "").trim();
                        if (!apiUrl || !apiKey) {
                            console.error("ERROR: Both ALB_API_URL and LOCATIONIQ_API_KEY are required.");
                            process.exit(1);
                        }
                        const q = String.fromCharCode(39);
                        const apiTarget = q + "<ALB_API_URL>" + q;
                        const keyTarget = q + "<LOCATIONIQ_API_KEY>" + q;
                        const content = fs.readFileSync(path, "utf8");
                        if (!content.includes(apiTarget) || !content.includes(keyTarget)) {
                            console.error("ERROR: Expected placeholders missing in client/js/config.js");
                            process.exit(1);
                        }
                        const updated = content
                            .replace(apiTarget, JSON.stringify(apiUrl))
                            .replace(keyTarget, JSON.stringify(apiKey));
                        fs.writeFileSync(path, updated, "utf8");
                    ' "${CLIENT_DIR}/js/config.js"

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
