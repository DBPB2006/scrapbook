#!/usr/bin/env bash
# Idempotent MongoDB Community Edition initialization script for the Scrapbook EC2 host (via AWS SSM).
# Creates/updates the admin account (handling first-boot localhost exception) and the least-privilege
# `readWrite` application user on the target database, then creates aligned collections & indexes.
#
# Usage:
#   export MONGODB_ADMIN_USER="scrapbook_admin"
#   export MONGODB_ADMIN_PASSWORD="<strong-admin-password>"
#   export MONGODB_APP_USER="scrapbook_app"
#   export MONGODB_APP_PASSWORD="<strong-app-password>"
#   export MONGODB_DATABASE="scrapbook"
#   ./scripts/init-mongodb.sh

set -euo pipefail

MONGODB_HOST="${MONGODB_HOST:-127.0.0.1}"
MONGODB_PORT="${MONGODB_PORT:-27017}"
MONGODB_DATABASE="${MONGODB_DATABASE:-scrapbook}"

: "${MONGODB_ADMIN_USER:?MONGODB_ADMIN_USER is required}"
: "${MONGODB_ADMIN_PASSWORD:?MONGODB_ADMIN_PASSWORD is required}"
: "${MONGODB_APP_USER:?MONGODB_APP_USER is required}"
: "${MONGODB_APP_PASSWORD:?MONGODB_APP_PASSWORD is required}"

if [ "${MONGODB_APP_USER}" = "${MONGODB_ADMIN_USER}" ]; then
  echo "ERROR: MONGODB_APP_USER must be distinct from MONGODB_ADMIN_USER." >&2
  exit 1
fi

export MONGODB_HOST MONGODB_PORT MONGODB_DATABASE

run_admin_js() {
  local js_file="$1"
  local uri="mongodb://${MONGODB_HOST}:${MONGODB_PORT}/admin"
  if mongosh --quiet --norc "${uri}" --username "${MONGODB_ADMIN_USER}" --password "${MONGODB_ADMIN_PASSWORD}" --authenticationDatabase admin --eval "db.runCommand({ ping: 1 })" >/dev/null 2>&1; then
    mongosh --quiet --norc "${uri}" --username "${MONGODB_ADMIN_USER}" --password "${MONGODB_ADMIN_PASSWORD}" --authenticationDatabase admin "${js_file}"
    return 0
  fi

  # First boot localhost exception: create the initial admin user directly (usersInfo is disallowed before creation),
  # close the unauthenticated session (which immediately ends the localhost exception), then authenticate.
  mongosh --quiet --norc "${uri}" --eval '
    const adminDb = db.getSiblingDB("admin");
    adminDb.createUser({
      user: process.env.MONGODB_ADMIN_USER,
      pwd: process.env.MONGODB_ADMIN_PASSWORD,
      roles: [
        { role: "userAdminAnyDatabase", db: "admin" },
        { role: "dbAdminAnyDatabase", db: "admin" },
        { role: "readWriteAnyDatabase", db: "admin" }
      ]
    });
  '
  mongosh --quiet --norc "${uri}" --username "${MONGODB_ADMIN_USER}" --password "${MONGODB_ADMIN_PASSWORD}" --authenticationDatabase admin "${js_file}"
}

TMP_JS="$(mktemp)"
trap 'rm -f "${TMP_JS}"' EXIT

cat > "${TMP_JS}" <<'EOF'
const targetDbName = process.env.MONGODB_DATABASE || "scrapbook";
const appUser = process.env.MONGODB_APP_USER;
const appPassword = process.env.MONGODB_APP_PASSWORD;

const appDb = db.getSiblingDB(targetDbName);
const existingApp = appDb.runCommand({ usersInfo: { user: appUser, db: targetDbName } });
const leastPrivilegeRoles = [{ role: "readWrite", db: targetDbName }];

if (!existingApp.users || existingApp.users.length === 0) {
  appDb.createUser({ user: appUser, pwd: appPassword, roles: leastPrivilegeRoles });
  print("Created least-privilege application user '" + appUser + "' on database '" + targetDbName + "'.");
} else {
  appDb.updateUser(appUser, { pwd: appPassword, roles: leastPrivilegeRoles });
  print("Updated least-privilege application user '" + appUser + "' on database '" + targetDbName + "'.");
}

function canonical(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return JSON.stringify(v);
  const out = {};
  Object.keys(v).sort().forEach((k) => { out[k] = v[k]; });
  return JSON.stringify(out);
}

function dropIfExists(col, name) {
  const existing = col.getIndexes();
  if (existing.some((i) => i.name === name)) {
    col.dropIndex(name);
  }
}

function ensureIdx(col, keys, opts) {
  const existing = col.getIndexes();
  const byName = existing.find((i) => i.name === opts.name);
  if (byName) {
    const keysEqual = JSON.stringify(Object.entries(byName.key)) === JSON.stringify(Object.entries(keys));
    const uniqueEqual = !!byName.unique === !!opts.unique;
    const pfeEqual = canonical(byName.partialFilterExpression || null) === canonical(opts.partialFilterExpression || null);
    if (keysEqual && uniqueEqual && pfeEqual) return;
    col.dropIndex(opts.name);
  }
  col.createIndex(keys, opts);
}

["users", "memories", "friend_requests", "time_capsules", "shared_memories"].forEach((name) => {
  if (!appDb.getCollectionNames().includes(name)) {
    appDb.createCollection(name);
  }
});

dropIfExists(appDb.memories, "idx_memories_owner_tags");
dropIfExists(appDb.friend_requests, "idx_freq_direction_status");
dropIfExists(appDb.time_capsules, "idx_tc_reveal_unlocked");
dropIfExists(appDb.shared_memories, "idx_shared_to_seen");
dropIfExists(appDb.shared_memories, "idx_shared_to_date");
dropIfExists(appDb.shared_memories, "idx_shared_from_date");

ensureIdx(appDb.users, { email: 1 }, { unique: true, name: "idx_users_email_unique" });
ensureIdx(appDb.users, { username: 1 }, { unique: true, partialFilterExpression: { username: { $type: "string", $gt: "" } }, name: "idx_users_username_unique" });
ensureIdx(appDb.users, { bucket_id: 1, email: 1 }, { name: "idx_users_bucket_email" });

ensureIdx(appDb.memories, { memory_id: 1 }, { unique: true, name: "idx_memories_id_unique" });
ensureIdx(appDb.memories, { owner: 1, date: -1, created_at: -1, memory_id: -1 }, { name: "idx_memories_owner_chronological" });

ensureIdx(appDb.friend_requests, { id: 1 }, { unique: true, name: "idx_freq_id_unique" });
ensureIdx(appDb.friend_requests, { from: 1, to: 1 }, { unique: true, partialFilterExpression: { status: "pending" }, name: "idx_freq_pending_direction_unique" });
ensureIdx(appDb.friend_requests, { pending_pair_key: 1 }, { unique: true, partialFilterExpression: { status: "pending", pending_pair_key: { $type: "string" } }, name: "idx_freq_pending_pair_unique" });
ensureIdx(appDb.friend_requests, { to: 1, status: 1 }, { name: "idx_freq_incoming_status" });
ensureIdx(appDb.friend_requests, { from: 1, status: 1 }, { name: "idx_freq_outgoing_status" });

ensureIdx(appDb.time_capsules, { id: 1 }, { unique: true, name: "idx_tc_id_unique" });
ensureIdx(appDb.time_capsules, { unlocked: 1, reveal_date: 1 }, { name: "idx_tc_unlocked_reveal" });
ensureIdx(appDb.time_capsules, { recipient_email: 1, unlocked: 1 }, { name: "idx_tc_recipient_unlocked" });
ensureIdx(appDb.time_capsules, { user_email: 1 }, { name: "idx_tc_sender" });

ensureIdx(appDb.shared_memories, { memory_id: 1 }, { unique: true, name: "idx_shared_mem_id_unique" });
ensureIdx(appDb.shared_memories, { original_memory_id: 1, created_at: -1, date: -1 }, { name: "idx_shared_original_created" });
ensureIdx(appDb.shared_memories, { to: 1, seen: 1, created_at: -1, date: -1 }, { name: "idx_shared_to_seen_created" });
ensureIdx(appDb.shared_memories, { to: 1, created_at: -1, date: -1 }, { name: "idx_shared_to_created" });
ensureIdx(appDb.shared_memories, { from: 1, created_at: -1, date: -1 }, { name: "idx_shared_from_created" });
print("Initialized Scrapbook collections and indexes on '" + targetDbName + "'.");
EOF

run_admin_js "${TMP_JS}"

# Verify application user authenticates against its own database
mongosh --quiet --norc "mongodb://${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DATABASE}" \
  --username "${MONGODB_APP_USER}" \
  --password "${MONGODB_APP_PASSWORD}" \
  --authenticationDatabase "${MONGODB_DATABASE}" \
  --eval 'const r = db.runCommand({ ping: 1 }); if (r.ok !== 1) throw new Error("Ping failed"); print("Verified least-privilege app user authentication.");'
