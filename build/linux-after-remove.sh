#!/bin/bash
set -e

APP_ROOT='/opt/${sanitizedProductName}'
EXECUTABLE='${executable}'
RULE_TARGET="/etc/udev/rules.d/40-vsd-m18.rules"
PROFILE_TARGET="/etc/apparmor.d/$EXECUTABLE"
EXPECTED_RULE_HASH="1667e719f1d39c096508f87576bde03058db01dba8154c99c07086fecb28c5c4"

if command -v update-alternatives >/dev/null 2>&1; then
  update-alternatives --remove "$EXECUTABLE" "$APP_ROOT/$EXECUTABLE" || true
else
  rm -f "/usr/bin/$EXECUTABLE"
fi

if [ -f "$PROFILE_TARGET" ]; then
  if command -v apparmor_status >/dev/null 2>&1 && \
    apparmor_status --enabled >/dev/null 2>&1 && \
    command -v apparmor_parser >/dev/null 2>&1 && \
    ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
    apparmor_parser --remove "$PROFILE_TARGET" || true
  fi
  rm -f "$PROFILE_TARGET"
fi

CURRENT_RULE_HASH=""
if [ -f "$RULE_TARGET" ] && command -v sha256sum >/dev/null 2>&1; then
  CURRENT_RULE_HASH=$(sha256sum "$RULE_TARGET" | awk '{print $1}')
fi
if [ "$CURRENT_RULE_HASH" = "$EXPECTED_RULE_HASH" ]; then
  rm -f "$RULE_TARGET"
  if command -v udevadm >/dev/null 2>&1; then
    udevadm control --reload-rules || true
    udevadm trigger --subsystem-match=hidraw || true
  fi
elif [ -f "$RULE_TARGET" ]; then
  echo "Preserving modified udev rule at $RULE_TARGET"
fi
