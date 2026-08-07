#!/usr/bin/env bash
set -euo pipefail

apk_path="android/app/build/outputs/apk/debug/sonic-saucepan-debug-1.0-debug.apk"
component_name="com.sonicsaucepan.app.debug/com.sonicsaucepan.app.MainActivity"

if [[ ! -f "$apk_path" ]]; then
  echo "Debug APK not found at $apk_path"
  echo "Run: npm run android:apk:debug"
  exit 1
fi

serial="${ANDROID_SERIAL:-}"
if [[ -z "$serial" ]]; then
  serial="$(adb devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')"
fi

if [[ -z "$serial" ]]; then
  echo "No authorized Android device detected by adb."
  echo "Host USB can still be connected in MTP-only mode. On the tablet:"
  echo "1. Enable Developer Options"
  echo "2. Enable USB debugging"
  echo "3. Accept the RSA prompt"
  echo "4. Reconnect USB if needed, then rerun: adb devices -l"
  exit 1
fi

model="$(adb -s "$serial" shell getprop ro.product.model | tr -d '\r')"
echo "Installing to $serial${model:+ ($model)}"
adb -s "$serial" install -r "$apk_path"
adb -s "$serial" shell am start -n "$component_name"
echo "Launched $component_name on $serial"