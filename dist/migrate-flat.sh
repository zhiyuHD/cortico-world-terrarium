#!/usr/bin/env bash
# Owner: releases.ts and release-runner.ts. Imports a flat deployment without copying data/.
set -euo pipefail
root=$(realpath "${1:?usage: migrate-flat.sh <deployment-root> <build-dir> <baseline-id> [user-service]}")
build_dir=$(realpath "${2:?build-dir is required}")
baseline=${3:?baseline-id is required}
service=${4:-cortico-box.service}
[[ "$root" =~ ^/[a-zA-Z0-9_./-]+$ && "$service" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.@-]*\.service$ ]] || { echo 'Unsupported root path or service name' >&2; exit 1; }
test ! -e "$root/.deployment/state.json"
test -f "$root/server.mjs"
test -f "$build_dir/release.mjs"
config_dir=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$service.d
mkdir -p "$root/.deployment" "$config_dir"
dropin=$config_dir/atomic-releases.conf
test ! -e "$dropin"
task_dir=$(mktemp -d "$root/.deployment/migrate-XXXXXX")
changed=0
cleanup() {
  result=$?
  if [[ "$result" -ne 0 && "$changed" -eq 1 ]]; then
    rm -f "$dropin"
    systemctl --user daemon-reload
    systemctl --user restart "$service"
    echo 'Migration failed; restored the flat service configuration' >&2
  fi
  chmod -R u+w "$task_dir"
  rm -rf "$task_dir"
}
trap cleanup EXIT
mkdir "$task_dir/source"
for file in server.mjs admin.mjs scene.js index.html; do cp "$root/$file" "$task_dir/source/$file"; done
cp -r "$root/console" "$task_dir/source/console"
cp "$build_dir/release.mjs" "$build_dir/runner.mjs" "$task_dir/source/"
node "$build_dir/release.mjs" pack --source "$task_dir/source" --output "$task_dir/package" --id "$baseline" --version legacy --revision flat-import --legacy-health > "$task_dir/manifest.json"
node "$build_dir/release.mjs" install --root "$root" --source "$task_dir/package" > /dev/null
node "$build_dir/release.mjs" init --root "$root" --id "$baseline" > /dev/null
printf '[Service]\nExecStart=\nExecStart=/usr/bin/node %s/manager/runner.mjs\nEnvironment=CORTICO_TERRARIUM_DEPLOY_ROOT=%s\nKillMode=control-group\nTimeoutStopSec=10\n' "$root" "$root" > "$task_dir/atomic-releases.conf"
printf '#!/usr/bin/env bash\nset -e\nrelease_root=$(cd -- "$(dirname -- "$0")" && pwd)\nexport CORTICO_TERRARIUM_DEPLOY_ROOT="$release_root"\nexec /usr/bin/node "$release_root/manager/release.mjs" "$@"\n' > "$task_dir/box-release"
install -m 755 "$task_dir/box-release" "$root/box-release"
changed=1
install -m 600 "$task_dir/atomic-releases.conf" "$dropin"
systemctl --user daemon-reload
systemctl --user restart "$service"
node --input-type=module <<'JS'
import { setTimeout as delay } from 'node:timers/promises';
const url = process.env.CORTICO_TERRARIUM_HEALTH_URL ?? 'http://127.0.0.1:8787/health';
for (let attempt = 0; attempt < 30; attempt++) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok && (await response.json()).ok === true) { await delay(1000); process.exit(0); } } catch {}
  await delay(1000);
}
throw new Error('Migrated server did not become healthy');
JS
changed=0
printf 'Imported %s. Active releases: %s/versions; commands: %s/box-release\n' "$baseline" "$root" "$root"
