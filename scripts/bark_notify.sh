#!/bin/bash
# Bark push notification. Device keys stay out of the repository: set BAMBOOK_BARK_KEYS
# (comma-separated) in the local environment or in a file outside the repo, e.g.
#   export BAMBOOK_BARK_KEYS="key1,key2"
# Usage: npm run notify -- "message"
set -euo pipefail

MSG=${1:-"Bambook notification"}
KEYS=${BAMBOOK_BARK_KEYS:-}
if [[ -z "$KEYS" ]]; then
  echo "BAMBOOK_BARK_KEYS is not set; nothing sent." >&2
  exit 1
fi

ENCODED_MSG=$(MSG="$MSG" node -e 'process.stdout.write(encodeURIComponent(process.env.MSG))')
IFS=',' read -r -a KEY_LIST <<< "$KEYS"
sent=0
for key in "${KEY_LIST[@]}"; do
  key=${key//[[:space:]]/}
  [[ "$key" =~ ^[A-Za-z0-9]+$ ]] || { echo "Skipping an invalid Bark key." >&2; continue; }
  if curl -fsS --max-time 10 -o /dev/null "https://api.day.app/$key/$ENCODED_MSG?level=critical&isArchive=1"; then
    sent=$((sent + 1))
  else
    echo "One Bark delivery failed." >&2
  fi
done
echo "Dispatched to $sent device(s): $MSG"
[[ $sent -gt 0 ]]
