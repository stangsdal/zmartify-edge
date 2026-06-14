#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_PROJECT="$ROOT_DIR/ios/App/App.xcodeproj"
SCHEME="App"
CONFIGURATION="Release"
DERIVED_DATA="$ROOT_DIR/ios/build/derived"
ARCHIVE_PATH="$ROOT_DIR/ios/build/HVACAdmin.xcarchive"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild is not available. Install Xcode command line tools first."
  exit 1
fi

cd "$ROOT_DIR"

echo "[ios-build] Building web assets"
npm run build

echo "[ios-build] Syncing Capacitor iOS"
npx cap sync ios

echo "[ios-build] Archiving iOS app"
xcodebuild \
  -project "$IOS_PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DATA" \
  -archivePath "$ARCHIVE_PATH" \
  archive

echo "[ios-build] Archive complete: $ARCHIVE_PATH"
