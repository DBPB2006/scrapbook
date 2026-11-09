#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/k3s-init.log) 2>&1

dnf install -y iptables container-selinux amazon-ecr-credential-helper

# Configure native kubelet ECR credential provider backed by the K3s EC2 IAM role.
mkdir -p /var/lib/rancher/credentialprovider/bin /etc/rancher/k3s
printf '%s\n' \
  '#!/usr/bin/python3' \
  'import json, os, subprocess, sys' \
  'req = json.load(sys.stdin)' \
  'registry = req["image"].split("/", 1)[0]' \
  'env = {**os.environ, "HOME": "/root", "AWS_ECR_DISABLE_CACHE": "true"}' \
  'cred = json.loads(subprocess.check_output(["/usr/bin/docker-credential-ecr-login", "get"], input=registry, text=True, env=env))' \
  'json.dump({"apiVersion": "credentialprovider.kubelet.k8s.io/v1", "kind": "CredentialProviderResponse", "cacheKeyType": "Registry", "cacheDuration": "6h0m0s", "auth": {registry: {"username": cred["Username"], "password": cred["Secret"]}}}, sys.stdout)' \
  > /var/lib/rancher/credentialprovider/bin/ecr-credential-provider
chmod 755 /var/lib/rancher/credentialprovider/bin/ecr-credential-provider

printf '%s\n' \
  'apiVersion: kubelet.config.k8s.io/v1' \
  'kind: CredentialProviderConfig' \
  'providers:' \
  '  - name: ecr-credential-provider' \
  '    matchImages:' \
  '      - "*.dkr.ecr.*.amazonaws.com"' \
  '    defaultCacheDuration: "6h0m0s"' \
  '    apiVersion: credentialprovider.kubelet.k8s.io/v1' \
  > /etc/rancher/k3s/credential-provider-config.yaml

IMDS_TOKEN="$(curl -fsSX PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")"
PRIVATE_IP="$(curl -fsSH "X-aws-ec2-metadata-token: ${IMDS_TOKEN}" "http://169.254.169.254/latest/meta-data/local-ipv4")"
if [ -z "${PRIVATE_IP}" ]; then
  echo "Failed to resolve private IPv4 address from IMDSv2."
  exit 1
fi

# Disable Traefik so Gateway NodePort 30090 serves traffic directly from the ALB;
# keep K3s built-in metrics-server enabled for HPA.
printf '%s\n' \
  "node-ip: ${PRIVATE_IP}" \
  'tls-san:' \
  "  - ${PRIVATE_IP}" \
  'disable:' \
  '  - traefik' \
  'kubelet-arg:' \
  '  - image-credential-provider-config=/etc/rancher/k3s/credential-provider-config.yaml' \
  '  - image-credential-provider-bin-dir=/var/lib/rancher/credentialprovider/bin' \
  > /etc/rancher/k3s/config.yaml

curl -sfL https://get.k3s.io | INSTALL_K3S_SKIP_SELINUX_RPM=true INSTALL_K3S_SELINUX_WARN=true sh -s - server
systemctl enable k3s

