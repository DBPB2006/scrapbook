#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/jenkins-init.log) 2>&1

# Install Java 21, Git, Docker, AWS CLI, Node.js 20, and npm on Amazon Linux 2023.
dnf install -y fontconfig java-21-amazon-corretto git docker awscli nodejs20 nodejs20-npm
command -v node >/dev/null || ln -sf /usr/bin/node-20 /usr/bin/node
command -v npm >/dev/null || ln -sf /usr/bin/npm-20 /usr/bin/npm

# Install Jenkins LTS.
curl -fsSL -o /etc/yum.repos.d/jenkins.repo https://pkg.jenkins.io/redhat-stable/jenkins.repo
rpm --import https://pkg.jenkins.io/redhat-stable/jenkins.io-2023.key
dnf install -y jenkins

# Install Trivy for container image vulnerability scanning in Jenkinsfile.
printf '%s\n' \
  '[trivy]' \
  'name=Trivy repository' \
  'baseurl=https://aquasecurity.github.io/trivy-repo/rpm/releases/$basearch/' \
  'gpgcheck=1' \
  'enabled=1' \
  'gpgkey=https://aquasecurity.github.io/trivy-repo/rpm/public.key' \
  > /etc/yum.repos.d/trivy.repo
rpm --import https://aquasecurity.github.io/trivy-repo/rpm/public.key
dnf install -y trivy

# Install kubectl for deploying Kubernetes manifests to the private K3s cluster.
KUBECTL_VERSION="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"
curl -fsSL -o /tmp/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"
curl -fsSL -o /tmp/kubectl.sha256 "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl.sha256"
echo "$(cat /tmp/kubectl.sha256)  /tmp/kubectl" | sha256sum --check
install -m 0755 /tmp/kubectl /usr/local/bin/kubectl
rm -f /tmp/kubectl /tmp/kubectl.sha256

# Bind Jenkins UI strictly to loopback; access over AWS SSM port forwarding only.
mkdir -p /etc/systemd/system/jenkins.service.d
printf '%s\n' \
  '[Service]' \
  'Environment="JENKINS_LISTEN_ADDRESS=127.0.0.1"' \
  > /etc/systemd/system/jenkins.service.d/override.conf

systemctl enable --now docker
usermod -aG docker jenkins

systemctl daemon-reload
systemctl enable --now jenkins

