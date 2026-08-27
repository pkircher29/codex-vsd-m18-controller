#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if systemctl --user list-unit-files vsd-m18-controller.service --no-legend 2>/dev/null | grep -q '^vsd-m18-controller.service'; then
  systemctl --user start vsd-m18-controller.service
else
  VSD_M18_NO_BROWSER=1 node "$project_root/src/server.js" --headless >/dev/null 2>&1 &
fi

node --input-type=module -e '
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:31918/api/health", {
        signal: AbortSignal.timeout(250),
      });
      if (response.ok) process.exit(0);
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  process.exit(1);
' >/dev/null 2>&1 || true

xdg-open http://127.0.0.1:31918 >/dev/null 2>&1 &
