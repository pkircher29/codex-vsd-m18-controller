#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
node_path=$(command -v node)
rule_source="$project_root/linux/40-vsd-m18.rules"
rule_target="/etc/udev/rules.d/40-vsd-m18.rules"
service_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
desktop_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

if [[ ! -f "$project_root/package-lock.json" ]]; then
  echo "package-lock.json is missing; run npm install first." >&2
  exit 1
fi

npm --prefix "$project_root" ci --no-audit --no-fund

echo "Installing the least-privilege M18 udev rule (sudo is required once)."
sudo install -o root -g root -m 0644 "$rule_source" "$rule_target"
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=hidraw

mkdir -p "$service_dir" "$desktop_dir"
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/vsd-m18-controller"
mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/vsd-m18-controller"
sed -e "s|@PROJECT_ROOT@|$project_root|g" -e "s|@NODE_PATH@|$node_path|g" \
  "$project_root/linux/vsd-m18-controller.service.in" \
  > "$service_dir/vsd-m18-controller.service"
sed -e "s|@PROJECT_ROOT@|$project_root|g" \
  "$project_root/linux/vsd-m18-controller.desktop.in" \
  > "$desktop_dir/vsd-m18-controller.desktop"

chmod 0644 "$service_dir/vsd-m18-controller.service" "$desktop_dir/vsd-m18-controller.desktop"
chmod 0755 "$project_root/scripts/open-controller.sh"
systemctl --user daemon-reload
systemctl --user enable --now vsd-m18-controller.service

echo
echo "M18 Foundry is installed. Unplug and reconnect the M18 once so the new udev rule applies."
echo "Then open 'M18 Foundry' from the application menu. Its launcher discovers the private local URL."
