#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_PROJECT="$ROOT_DIR/ios/App/App.xcodeproj"
SCHEME="App"
CONFIGURATION="Release"
DERIVED_DATA="$ROOT_DIR/ios/build/derived"
ARCHIVE_PATH="$ROOT_DIR/ios/build/Zmartify.xcarchive"
EXPORT_OPTIONS="$ROOT_DIR/ios/ExportOptions.plist"
EXPORT_PATH="${IOS_EXPORT_PATH:-$ROOT_DIR/ios/build/export}"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild is not available. Install Xcode command line tools first."
  exit 1
fi

cd "$ROOT_DIR"

echo "[ios-build] Building web assets"
npm run build:native

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

echo "[ios-build] Exporting App Store Connect IPA"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -allowProvisioningUpdates

echo "[ios-build] IPA export complete: $EXPORT_PATH"
