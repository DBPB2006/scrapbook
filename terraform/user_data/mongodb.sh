#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/mongodb-init.log) 2>&1

# Wait for attached persistent EBS data volume (/dev/xvdf -> NVMe device on AL2023).
for _ in $(seq 1 90); do
  [ -b /dev/xvdf ] && break
  sleep 2
done
if [ ! -b /dev/xvdf ]; then
  echo "Persistent EBS device /dev/xvdf did not attach in time."
  exit 1
fi

DATA_DEV="$(readlink -f /dev/xvdf)"

# Format only when empty; never overwrite an existing filesystem or database data.
if ! blkid -o value -s TYPE "$DATA_DEV" >/dev/null 2>&1; then
  mkfs.xfs "$DATA_DEV"
fi

mkdir -p /data/mongodb
DATA_UUID="$(blkid -s UUID -o value "$DATA_DEV")"
if [ -z "$DATA_UUID" ]; then
  echo "Failed to resolve filesystem UUID for $DATA_DEV."
  exit 1
fi
if ! grep -q "UUID=$DATA_UUID" /etc/fstab; then
  echo "UUID=$DATA_UUID /data/mongodb xfs defaults,nofail 0 2" >> /etc/fstab
fi

systemctl daemon-reload
mountpoint -q /data/mongodb || mount /data/mongodb

# Install MongoDB 8.0 Community Edition for Amazon Linux 2023.
printf '%s\n' \
  '[mongodb-org-8.0]' \
  'name=MongoDB Repository' \
  'baseurl=https://repo.mongodb.org/yum/amazon/2023/mongodb-org/8.0/$basearch/' \
  'gpgcheck=1' \
  'enabled=1' \
  'gpgkey=https://pgp.mongodb.com/server-8.0.asc' \
  > /etc/yum.repos.d/mongodb-org-8.0.repo

dnf install -y mongodb-org
chown -R mongod:mongod /data/mongodb

# Bind to loopback and instance private IPv4 via IMDSv2, and enable authentication.
IMDS_TOKEN="$(curl -fsSX PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")"
PRIVATE_IP="$(curl -fsSH "X-aws-ec2-metadata-token: $IMDS_TOKEN" "http://169.254.169.254/latest/meta-data/local-ipv4")"
if [ -z "$PRIVATE_IP" ]; then
  echo "Failed to resolve private IPv4 address from IMDSv2."
  exit 1
fi

sed -i 's|^\([[:space:]]*dbPath:\).*|\1 /data/mongodb|' /etc/mongod.conf
sed -i 's|^\([[:space:]]*port:\).*|\1 ${mongodb_port}|' /etc/mongod.conf
sed -i "s|^\([[:space:]]*bindIp:\).*|\1 127.0.0.1,$PRIVATE_IP|" /etc/mongod.conf
if grep -q '^#security:' /etc/mongod.conf; then
  sed -i 's/^#security:/security:\n  authorization: enabled/' /etc/mongod.conf
elif ! grep -q '^security:' /etc/mongod.conf; then
  printf '\nsecurity:\n  authorization: enabled\n' >> /etc/mongod.conf
fi

# Prevent mongod from starting on root disk if /data/mongodb is not mounted.
mkdir -p /etc/systemd/system/mongod.service.d
printf '%s\n' \
  '[Unit]' \
  'RequiresMountsFor=/data/mongodb' \
  'ConditionPathIsMountPoint=/data/mongodb' \
  > /etc/systemd/system/mongod.service.d/mount.conf

systemctl daemon-reload
systemctl enable mongod
systemctl restart mongod

