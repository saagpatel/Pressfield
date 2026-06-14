#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${PRESSFIELD_NOTARY_PROFILE:-Pressfield}"
APP="$ROOT/src-tauri/target/release/bundle/macos/Pressfield.app"
DMG="$ROOT/src-tauri/target/release/bundle/dmg/Pressfield_0.1.0_aarch64.dmg"

if [[ ! -d "$APP" ]]; then
	echo "Missing app bundle: $APP" >&2
	echo "Run: pnpm tauri build" >&2
	exit 1
fi

if [[ ! -f "$DMG" ]]; then
	echo "Missing DMG: $DMG" >&2
	echo "Run: pnpm tauri build" >&2
	exit 1
fi

if ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
	cat >&2 <<EOF
Missing notarytool keychain profile: $PROFILE

Create it once with one of:
  xcrun notarytool store-credentials "$PROFILE" --apple-id <apple-id> --team-id <team-id> --password <app-specific-password>
  xcrun notarytool store-credentials "$PROFILE" --key <api-key-path> --key-id <key-id> --issuer <issuer-id>

Or set PRESSFIELD_NOTARY_PROFILE to an existing profile name.
EOF
	exit 1
fi

echo "Verifying signed app..."
codesign --verify --deep --strict --verbose=4 "$APP"

echo "Verifying DMG checksum..."
hdiutil verify "$DMG"

echo "Submitting DMG for notarization with profile '$PROFILE'..."
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait

echo "Stapling notarization tickets..."
xcrun stapler staple "$APP"
xcrun stapler staple "$DMG"

echo "Validating stapled tickets..."
xcrun stapler validate -v "$APP"
xcrun stapler validate -v "$DMG"

echo "Running Gatekeeper assessments..."
spctl -a -vvv -t exec "$APP"
spctl -a -vvv -t open "$DMG"

echo "Notarization complete."
