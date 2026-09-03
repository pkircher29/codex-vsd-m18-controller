#!/bin/bash
set -e

APP_ROOT='/opt/${sanitizedProductName}'
EXECUTABLE='${executable}'
RULE_SOURCE="$APP_ROOT/resources/linux/40-vsd-m18.rules"
RULE_TARGET="/etc/udev/rules.d/40-vsd-m18.rules"

if command -v update-alternatives >/dev/null 2>&1; then
  update-alternatives --install "/usr/bin/$EXECUTABLE" "$EXECUTABLE" "$APP_ROOT/$EXECUTABLE" 100 || \
    ln -sf "$APP_ROOT/$EXECUTABLE" "/usr/bin/$EXECUTABLE"
else
  ln -sf "$APP_ROOT/$EXECUTABLE" "/usr/bin/$EXECUTABLE"
fi

if [ -L /proc/self/ns/user ] && command -v unshare >/dev/null 2>&1 && unshare --user true; then
  chmod 0755 "$APP_ROOT/chrome-sandbox" || true
else
  chmod 4755 "$APP_ROOT/chrome-sandbox" || true
fi

if command -v apparmor_status >/dev/null 2>&1 && apparmor_status --enabled >/dev/null 2>&1; then
  PROFILE_SOURCE="$APP_ROOT/resources/apparmor-profile"
  PROFILE_TARGET="/etc/apparmor.d/$EXECUTABLE"
  if command -v apparmor_parser >/dev/null 2>&1 && \
    apparmor_parser --skip-kernel-load --debug "$PROFILE_SOURCE" >/dev/null 2>&1; then
    cp -f "$PROFILE_SOURCE" "$PROFILE_TARGET"
    if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
      apparmor_parser --replace --write-cache --skip-read-cache "$PROFILE_TARGET" || true
    fi
  fi
fi

install -o root -g root -m 0644 "$RULE_SOURCE" "$RULE_TARGET"
if command -v udevadm >/dev/null 2>&1; then
  udevadm control --reload-rules || true
  udevadm trigger --subsystem-match=hidraw || true
fi

command -v update-mime-database >/dev/null 2>&1 && update-mime-database /usr/share/mime || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database /usr/share/applications || true
