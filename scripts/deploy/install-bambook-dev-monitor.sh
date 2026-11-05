#!/bin/bash
# Installs the Bambook host monitor (bambook-dev-monitor.py) as a root systemd timer. Run as root on the
# Tencent host only, and only with explicit authorisation. GNU/Linux with systemd, /usr/bin/python3 >= 3.8.
#
# Writes only: /usr/local/sbin/bambook-dev-monitor, /etc/systemd/system/bambook-dev-monitor.{service,timer},
# /etc/bambook-dev-monitor/ (0700) with config.example.json, and /var/lib/bambook-dev-monitor/ (0700).
# Never touches backend.env, business services, the database or backups, and never rebootstraps the host.
# An existing config.json is kept as is. The timer is enabled only when config.json passes the permission and
# content check (--check-config, no network). No probe and no Bark message is sent by this script.
#
#   install-bambook-dev-monitor.sh --verify   read-only: show what would change and check prerequisites
#   install-bambook-dev-monitor.sh            install / update files; enable the timer if the config is valid
#
# After writing /etc/bambook-dev-monitor/config.json (root:root 0600), the operator runs, in this order and only
# when authorised: bambook-dev-monitor --check-config; bambook-dev-monitor --dry-run; bambook-dev-monitor
# --send-test; then this installer again (or systemctl enable --now bambook-dev-monitor.timer).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source_script="$here/bambook-dev-monitor.py"
bin=/usr/local/sbin/bambook-dev-monitor
etc=/etc/bambook-dev-monitor
state=/var/lib/bambook-dev-monitor
unit_dir=/etc/systemd/system
verify=0
case "${1:-}" in
  --verify) verify=1 ;;
  '') ;;
  *) echo 'usage: install-bambook-dev-monitor.sh [--verify]' >&2; exit 64 ;;
esac

problems=0
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing prerequisite: $1" >&2; problems=1; }; }
[[ "$(uname -s)" == Linux ]] || { echo 'GNU/Linux with systemd required.' >&2; exit 1; }
need /usr/bin/python3
need /usr/bin/systemctl
need install
/usr/bin/python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null \
  || { echo 'python3 >= 3.8 required' >&2; problems=1; }
/usr/bin/python3 -c 'import ast, sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())' "$source_script" 2>/dev/null \
  || { echo 'monitor script does not parse' >&2; problems=1; }

service_unit=$(cat <<'UNIT'
[Unit]
Description=Bambook host health monitor (Bark alerts)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/bambook-dev-monitor
TimeoutStartSec=600
Nice=10
IOSchedulingClass=idle
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/bambook-dev-monitor
UMask=0077
UNIT
)
timer_unit=$(cat <<'UNIT'
[Unit]
Description=Run the Bambook host health monitor every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
UNIT
)
example=$(cat <<'JSON'
{
  "remindIntervalMinutes": 240,
  "diskThresholdPercent": 85,
  "backupMaxAgeHours": 36,
  "timeoutSeconds": 8,
  "publicHealth": [
    {"name": "web", "url": "https://REPLACE-WITH-PUBLIC-HOST/api/health"}
  ],
  "bark": {
    "server": "https://api.day.app",
    "deviceKeys": ["REPLACEWITHDEVICEKEY"],
    "title": "Bambook"
  }
}
JSON
)

differs() { [[ ! -f "$1" ]] || ! cmp -s "$1" -; }
report() { if differs "$1" <<<"$2"; then echo "would write $1"; else echo "unchanged $1"; fi; }

if (( verify )); then
  if [[ -f "$bin" ]] && cmp -s "$bin" "$source_script"; then echo "unchanged $bin"; else echo "would write $bin"; fi
  report "$unit_dir/bambook-dev-monitor.service" "$service_unit"
  report "$unit_dir/bambook-dev-monitor.timer" "$timer_unit"
  for unit in bambook-dev.service bambook-dev-mist.service; do
    /usr/bin/systemctl cat "$unit" >/dev/null 2>&1 || echo "note: $unit is not installed; its check will fail" >&2
  done
  [[ -d /var/backups/bambook-dev ]] || echo 'note: /var/backups/bambook-dev missing; the backup check will fail' >&2
  if [[ -f "$etc/config.json" ]]; then
    if [[ $EUID -eq 0 ]]; then
      /usr/bin/python3 "$source_script" --check-config --config "$etc/config.json" || true
    else
      echo 'config present; run --verify as root to check it'
    fi
  else
    echo "no $etc/config.json yet; the timer would stay disabled"
  fi
  exit "$problems"
fi

[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
(( problems == 0 )) || exit 1
umask 077
install -m 0755 -o root -g root "$source_script" "$bin"
install -d -m 0700 -o root -g root "$etc" "$state"
printf '%s\n' "$example" > "$etc/config.example.json.tmp"
chmod 0600 "$etc/config.example.json.tmp"
mv -f "$etc/config.example.json.tmp" "$etc/config.example.json"
for pair in "service:$service_unit" "timer:$timer_unit"; do
  kind=${pair%%:*}
  target="$unit_dir/bambook-dev-monitor.$kind"
  printf '%s\n' "${pair#*:}" > "$target.tmp"
  chmod 0644 "$target.tmp"
  mv -f "$target.tmp" "$target"
done
/usr/bin/systemctl daemon-reload

if [[ -f "$etc/config.json" ]] && "$bin" --check-config; then
  /usr/bin/systemctl enable --now bambook-dev-monitor.timer
  echo 'monitor installed; timer enabled.'
else
  /usr/bin/systemctl disable --now bambook-dev-monitor.timer >/dev/null 2>&1 || true
  echo "monitor installed; timer NOT enabled until $etc/config.json (root:root 0600) passes --check-config."
fi
