#!/bin/bash
set -euo pipefail
release=${1:?release directory required}
root=/srv/bambook-dev
keep_releases=4
[[ "$release" =~ ^/srv/bambook-dev/releases/[0-9a-f]{40}$ ]]
test -f "$release/.delivery.json"
environment=/etc/bambook-dev/backend.env
# Root-owned, per-release approvals for schema/migration changes (see schema gate below).
schema_approvals=/etc/bambook-dev/schema-approvals
approval_owner=0
if [[ ! -r "$environment" ]]; then
  echo 'Bundle received. Application owner must configure /etc/bambook-dev/backend.env and the bambook-dev.service unit before activation.' >&2
  exit 2
fi
# The release pins the major Node version used by CI (.nvmrc); refuse to build with a different runtime.
expected_node=$(tr -d '[:space:]' < "$release/.nvmrc")
actual_node=$(node --version | sed -E 's/^v([0-9]+).*/\1/')
if [[ ! "$expected_node" =~ ^[0-9]+$ || "$actual_node" != "$expected_node" ]]; then
  echo "Node $expected_node required by .nvmrc; server runtime is $(node --version)." >&2
  exit 1
fi
export NODE_ENV=production
# Schema gate. Delivery never migrates the database. A release whose server/prisma tree (schema.prisma,
# migrations, lock, manual SQL) is byte-identical to the active release keeps the normal flow. Any added,
# modified or removed file, or a first activation without an active release, is refused before the build
# unless the application owner recorded a root-owned approval for exactly this release, schema fingerprint
# and active release, after applying the migration through the reviewed procedure. The approval also states
# whether automatic rollback to the previous code is allowed ("previous") or services must stop ("stop");
# applied migrations alone never prove the old code is compatible. Approved releases are then checked
# read-only: every added or modified migration must be recorded as finished in _prisma_migrations with the
# candidate's checksum, and no migration may be left unfinished. Earlier, hand-registered history is not
# re-examined, so an unchanged schema never fails on it.
schema_gate=$(cat <<'PY'
import hashlib, json, os, stat, sys

def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def manifest(tree):
    base, entries = os.path.join(tree, 'server', 'prisma'), {}
    for folder, dirs, files in os.walk(base):
        dirs.sort()
        for name in sorted(dirs + files):
            path = os.path.join(folder, name)
            mode = os.lstat(path).st_mode
            if stat.S_ISDIR(mode):
                continue
            entries[os.path.relpath(path, tree)] = digest(path) if stat.S_ISREG(mode) else 'non-regular'
    return entries

def migrations(entries):
    out = {}
    for name, value in entries.items():
        parts = name.split('/')
        if len(parts) == 5 and parts[:3] == ['server', 'prisma', 'migrations'] and parts[4] == 'migration.sql':
            out[parts[3]] = value
    return out

def refuse(message):
    print('Schema gate: ' + message + ' Activation refused; the active release and database are unchanged.', file=sys.stderr)
    sys.exit(3)

def changes(release, active):
    candidate = manifest(release)
    baseline = manifest(active) if active else {}
    added = sorted(set(candidate) - set(baseline))
    removed = sorted(set(baseline) - set(candidate))
    modified = sorted(n for n in set(candidate) & set(baseline) if candidate[n] != baseline[n])
    return candidate, baseline, added, modified, removed

def fingerprint(entries):
    return hashlib.sha256(''.join(f'{n}\0{entries[n]}\n' for n in sorted(entries)).encode()).hexdigest()

def compare(release, active, approvals, owner):
    candidate, baseline, added, modified, removed = changes(release, active)
    if active and not (added or modified or removed):
        print('unchanged')
        return
    revision, schema = os.path.basename(release), fingerprint(candidate)
    if active:
        shown = [f'+{n}' for n in added] + [f'~{n}' for n in modified] + [f'-{n}' for n in removed]
        summary = f'schema or migration files changed ({len(added)} added, {len(modified)} modified, {len(removed)} removed: {", ".join(shown[:8])}{" ..." if len(shown) > 8 else ""}).'
    else:
        summary = 'no active release to compare the schema with.'
    path = os.path.join(approvals, revision + '.json')
    guide = f' Apply and verify the migration through the reviewed migration procedure, then record a root-owned approval {path} with release {revision}, schema {schema}, from "{os.path.basename(active) if active else ""}" and rollback "previous" or "stop".'
    try:
        folder, info = os.lstat(approvals), os.lstat(path)
    except FileNotFoundError:
        refuse(summary + guide)
    except OSError:
        refuse('approval could not be read.')
    for item in (folder, info):
        if item.st_uid != owner or item.st_mode & 0o022:
            refuse('approval is not root-owned or is writable by others.')
    if not stat.S_ISDIR(folder.st_mode) or not stat.S_ISREG(info.st_mode):
        refuse('approval path is not a regular file in a directory.')
    try:
        with open(path) as f:
            approval = json.load(f)
    except (OSError, ValueError):
        refuse('approval could not be read or is not valid JSON.')
    expected_from = os.path.basename(active) if active else ''
    if not isinstance(approval, dict) or approval.get('release') != revision or approval.get('schema') != schema or approval.get('from') != expected_from:
        refuse('approval does not match this release, its schema fingerprint and the active release. ' + summary + guide)
    rollback = approval.get('rollback')
    if rollback not in ('previous', 'stop') or (rollback == 'previous' and not active):
        refuse('approval must set rollback to "previous" (previous code verified compatible) or "stop"; first activation allows only "stop".')
    print('approved ' + rollback)

def verify_db(release, active, rows_file):
    candidate, baseline, _, _, _ = changes(release, active)
    wanted, before = migrations(candidate), migrations(baseline)
    required = {n: d for n, d in wanted.items() if before.get(n) != d}
    try:
        with open(rows_file) as f:
            rows = json.load(f)
        rows = [r for r in rows if isinstance(r, dict)]
    except (OSError, ValueError):
        refuse('migration history could not be read.')
    if any(not r.get('finished') and r.get('active') for r in rows):
        refuse('the database has an unfinished or failed migration; resolve it first.')
    applied = {(r.get('migration_name'), r.get('checksum')) for r in rows if r.get('finished') and r.get('active')}
    missing = sorted(n for n, d in required.items() if (n, d) not in applied)
    if missing:
        refuse(f'{len(missing)} migration(s) of this release are not recorded as applied with a matching checksum: {", ".join(missing[:8])}.')
    print(f'verified {len(required)}')

mode = sys.argv[1]
if mode == 'compare':
    compare(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]))
elif mode == 'verify-db':
    verify_db(sys.argv[2], sys.argv[3], sys.argv[4])
else:
    sys.exit(2)
PY
)
# Read-only migration history query with the candidate's generated client; errors are not echoed (no URLs).
read_migrations=$(cat <<'JS'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.$queryRawUnsafe('SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NULL AS active FROM "_prisma_migrations"').then((rows) => process.stdout.write(JSON.stringify(rows)), () => { process.exitCode = 3; }).finally(() => prisma.$disconnect());
JS
)
active=$(readlink -f "$root/current" || true)
active_release=""
if [[ "$active" =~ ^$root/releases/[0-9a-f]{40}$ && -d "$active" ]]; then active_release=$active; fi
schema_state=$(/usr/bin/python3 -I -c "$schema_gate" compare "$release" "$active_release" "$schema_approvals" "$approval_owner") || exit 3
# Per-step timing in the delivery log, to see where the activation budget goes.
started=$SECONDS
step() { echo "[release +$((SECONDS - started))s] $*"; }
cd "$release/server"
# Install and build before loading application secrets, so dependency install scripts never see them.
# Reuse the active release's dependencies (real copy, never shared/hard-linked) when its lockfile and Node
# runtime are identical; otherwise, or if the copy fails, do a clean install.
deps_stamp="$(node --version) $(sha256sum package-lock.json | cut -d' ' -f1)"
reused=0
if [[ -n "$active" && "$active" != "$release" && -d "$active/server/node_modules" \
      && -f "$active/server/.deps-stamp" && "$(cat "$active/server/.deps-stamp")" == "$deps_stamp" ]]; then
  step "copy node_modules from $(basename "$active")"
  rm -rf node_modules
  if cp -a "$active/server/node_modules" node_modules; then reused=1; else rm -rf node_modules; fi
fi
if [[ $reused == 0 ]]; then
  step 'npm ci'
  # CPU inference is intentional on this host. onnxruntime-node otherwise tries
  # to fetch optional CUDA/TensorRT providers during install, adding an external
  # network dependency and failing behind redirecting package feeds.
  ONNXRUNTIME_NODE_INSTALL=skip npm ci --include=dev --no-audit --no-fund
fi
printf '%s\n' "$deps_stamp" > .deps-stamp
step 'prisma generate'
npm exec -- prisma generate
# The whole-API type check runs locally before direct delivery (`verify:mist` → server `typecheck:full`).
# The small server does not repeat the ~1.9 GB / multi-minute tsc run.
step 'build done'
# The service runs with a read-only release tree; paths the API writes relative to server/ live in shared/ across releases.
for dir in logs storage data; do
  install -d -m 0750 "$root/shared/$dir"
  rm -rf "${release:?}/server/$dir"
  ln -sfn "$root/shared/$dir" "$release/server/$dir"
done
# index.ts writes generated files to <release>/output.
install -d -m 0750 "$root/shared/output"
rm -rf "${release:?}/output"
ln -sfn "$root/shared/output" "$release/output"
# Root-owned application configuration must contain shell-compatible KEY=value lines.
set -a
source "$environment"
set +a
: "${DATABASE_URL:?dedicated development database required}"
: "${JWT_SECRET:?development authentication secret required}"
: "${SYSTEM_CONFIG_ENCRYPTION_KEY:?configuration encryption key required}"
[[ "${MIST_LOCAL_WORKSPACE:-0}" != 1 ]]
[[ "${MIST_HOST:-127.0.0.1}" == 127.0.0.1 ]]
[[ "${BAMBOOK_HOST:-}" == 127.0.0.1 ]]
[[ "${PDML_SYNC_DISABLED:-}" == true ]]
if [[ "$schema_state" != unchanged ]]; then
  step 'verify migration history (read-only)'
  rows=$(mktemp "$root/.migrations.XXXXXX")
  if ! node -e "$read_migrations" > "$rows" 2>/dev/null; then
    rm -f "$rows"
    echo 'Schema gate: migration history could not be read. Activation refused; the active release and database are unchanged.' >&2
    exit 3
  fi
  if ! /usr/bin/python3 -I -c "$schema_gate" verify-db "$release" "$active_release" "$rows"; then rm -f "$rows"; exit 3; fi
  rm -f "$rows"
fi
previous=$(readlink "$root/current" || true)
# Restore target on failure. An approved schema change without a compatibility statement for the
# previous code stops the services instead of running old code on the migrated database.
restore_to=$previous
if [[ "$schema_state" == 'approved stop' ]]; then restore_to=""; fi
# Marker lets the receiver undo the switch if this script is killed (timeout) before it finishes.
printf '{"previous": "%s", "release": "%s"}\n' "$restore_to" "$release" > "$root/.activation.json"
step 'switch current'
ln -sfn "$release" "$root/.current-next"
mv -Tf "$root/.current-next" "$root/current"
rollback() {
  if [[ -n "$restore_to" ]]; then
    ln -sfn "$restore_to" "$root/.current-rollback"
    mv -Tf "$root/.current-rollback" "$root/current"
    sudo -n /usr/bin/systemctl restart bambook-dev.service || true
    sudo -n /usr/bin/systemctl restart bambook-dev-mist.service || true
  else
    rm -f "$root/current"
    sudo -n /usr/bin/systemctl stop bambook-dev.service || true
    sudo -n /usr/bin/systemctl stop bambook-dev-mist.service || true
  fi
  rm -f "$root/.activation.json"
}
trap 'rollback; echo "Activation interrupted; previous release restored when available." >&2; exit 1' TERM INT
# Keep the active and previous releases plus the newest few; each release carries its own node_modules.
prune() {
  local kept=0 candidate
  while IFS= read -r candidate; do
    [[ "$candidate" =~ ^$root/releases/[0-9a-f]{40}$ ]] || continue
    if [[ "$candidate" == "$release" || "$candidate" == "$previous" ]]; then continue; fi
    kept=$((kept + 1))
    if (( kept > keep_releases - 2 )); then rm -rf -- "$candidate"; fi
  done < <(ls -1dt "$root"/releases/*/ 2>/dev/null | sed 's#/$##')
}
if ! sudo -n /usr/bin/systemctl restart bambook-dev.service || ! sudo -n /usr/bin/systemctl restart bambook-dev-mist.service; then
  rollback
  exit 1
fi
# Main API (business, admin) and Mist workspace API must both report a healthy database connection.
healthy() {
  curl --fail --silent --max-time 3 "http://127.0.0.1:$1/api/health" > "$root/.health.json" && \
    /usr/bin/python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d.get("status")=="ok" and d.get("database")=="ok" and d.get("mode")!="local"' "$root/.health.json"
}
for attempt in $(seq 1 45); do
  if healthy "${PORT:-8081}" && healthy "${MIST_PORT:-8082}"; then
    trap - TERM INT
    rm -f "$root/.activation.json"
    step "activated $(basename "$release")"
    prune || echo 'Old release cleanup failed; activation is unaffected.' >&2
    exit 0
  fi
  sleep 2
done
rollback
echo 'Health verification failed; previous release restored when available.' >&2
exit 1
