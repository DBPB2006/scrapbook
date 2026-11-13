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
                    def resolved = sh(script: '''
                        set +x
                        set -eu
                        set -a
                        . "$DEPLOYMENT_ENV"
                        set +a
                        printf '%s\n' "$MEDIA_S3_BUCKET" "$FRONTEND_S3_BUCKET" "$ALB_API_URL" "${FRONTEND_ORIGIN:-}"
                    ''', returnStdout: true).split('\n', -1)

                    def mediaBucket    = resolved[0].trim()
                    def frontendBucket = resolved[1].trim()
                    def albUrl         = resolved[2].trim().replaceAll('/+$', '')
                    def rawOrigin      = resolved.length > 3 ? resolved[3].trim() : ''
                    def defaultOrigin  = "http://${frontendBucket}.s3-website.${env.AWS_REGION}.amazonaws.com"
                    def origin         = (rawOrigin ?: defaultOrigin).replaceAll('/+$', '')

                    env.MEDIA_S3_BUCKET    = mediaBucket
                    env.FRONTEND_S3_BUCKET = frontendBucket
                    env.ALB_API_URL        = albUrl.startsWith('http') ? albUrl : "http://${albUrl}"
                    env.FRONTEND_ORIGIN    = origin.startsWith('http') ? origin : "http://${origin}"

                    def sha            = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    def ts             = sh(script: 'date -u +%Y%m%d%H%M%S', returnStdout: true).trim()
                    env.IMAGE_TAG      = "${sha}-${env.BUILD_NUMBER}-${ts}"
                    env.AWS_ACCOUNT_ID = sh(script: 'aws sts get-caller-identity --query Account --output text', returnStdout: true).trim()
                    env.ECR_REGISTRY   = "${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com"
                }
            }
        }

        stage('Dependency Scan') {
            steps {
                sh '''
                    set -eu
                    for svc in $SERVICES; do
                        (cd "${svc}-service" && npm audit --omit=dev --audit-level=high || true)
                    done
                '''
            }
        }

        stage('Static Code Analysis & Lint') {
            steps {
                sh '''
                    set -eu
                    for svc in $SERVICES; do
                        (cd "${svc}-service" && npm run lint)
                    done

                    for f in shared/*.js; do
                        node --check "$f"
                    done

                    find client -name '*.js' -print0 | xargs -0 -n1 node --check

                    if command -v semgrep >/dev/null 2>&1; then
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
                        trivy image --ignore-unfixed --exit-code 0 --severity HIGH,CRITICAL --format table --output "reports/trivy/${svc}-scan.txt" "${ECR_REGISTRY}/scrapbook-${svc}:${IMAGE_TAG}"
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

                    DEPLOY_DIR="$(mktemp -d)"
                    trap 'rm -rf "${DEPLOY_DIR}"' EXIT
                    cp -R deployment/. "${DEPLOY_DIR}/"

                    DEPLOY_DIR="$DEPLOY_DIR" node -e '
                        const fs = require("fs");
                        const path = require("path");
                        const root = process.env.DEPLOY_DIR;
                        const replacements = [
                            ["<AWS_ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com", process.env.ECR_REGISTRY],
                            ["<IMAGE_TAG>", process.env.IMAGE_TAG],
                            ["<MEDIA_S3_BUCKET>", process.env.MEDIA_S3_BUCKET],
                            ["http://<FRONTEND_S3_WEBSITE_ORIGIN>", process.env.FRONTEND_ORIGIN]
                        ];
                        function walk(dir) {
                            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                                const full = path.join(dir, entry.name);
                                if (entry.isDirectory()) walk(full);
                                else if (entry.name.endsWith(".yaml")) {
                                    let text = fs.readFileSync(full, "utf8");
                                    for (const [needle, value] of replacements) {
                                        text = text.replaceAll(needle, value);
                                    }
                                    fs.writeFileSync(full, text);
                                }
                            }
                        }
                        walk(root);
                    '

                    if grep -rnE '<[A-Z0-9_]+>' "${DEPLOY_DIR}" --include='*.yaml'; then
                        echo "ERROR: Unreplaced placeholders remain in Kubernetes manifests." >&2
                        exit 1
                    fi

                    kubectl apply -f "${DEPLOY_DIR}/namespace.yaml"

                    (
                        set -a
                        . "$DEPLOYMENT_ENV"
                        set +a
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
                    )

                    for path in config auth memories social sharing gateway monitoring/prometheus monitoring/grafana; do
                        kubectl apply -f "${DEPLOY_DIR}/${path}/"
                    done

                    echo "Deleting old pods in scrapbook namespace to ensure clean recreation..."
                    kubectl delete pods -n scrapbook --all --wait=false || true
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

                    CLIENT_DIR="$(mktemp -d)"
                    trap 'rm -rf "${CLIENT_DIR}"' EXIT
                    cp -R client/. "${CLIENT_DIR}/"

                    RESOLVED_ALB_URL="${ALB_API_URL}"
                    (
                        set -a
                        . "$DEPLOYMENT_ENV"
                        set +a
                        CONFIG_JS="${CLIENT_DIR}/js/config.js" RESOLVED_ALB_URL="${RESOLVED_ALB_URL}" node -e '
                            const fs = require("fs");
                            const target = process.env.CONFIG_JS;
                            let text = fs.readFileSync(target, "utf8");
                            text = text.replaceAll("<ALB_API_URL>", process.env.RESOLVED_ALB_URL);
                            text = text.replaceAll("<LOCATIONIQ_API_KEY>", process.env.LOCATIONIQ_API_KEY);
                            fs.writeFileSync(target, text);
                        '
                    )

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
