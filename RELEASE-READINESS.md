# Pressfield Release Readiness

_Last checked: 2026-06-07 on `feat/v2-hardcore`._

## Current decision

Pressfield is ready for local signed artifact testing, but not yet ready for
external macOS distribution. The remaining release blocker is notarization.

## Artifact status

- `pnpm tauri build` produces:
  - `src-tauri/target/release/bundle/macos/Pressfield.app`
  - `src-tauri/target/release/bundle/dmg/Pressfield_0.1.0_aarch64.dmg`
- The app and DMG are signed with:
  `Developer ID Application: SAAGAR I PATEL (3TGZFKFNA4)`.
- Hardened runtime is enabled.
- Strict code-sign verification passes for `Pressfield.app`.
- DMG checksum verification passes.
- The signed packaged app launches and creates its local SQLite store when run
  with a disposable `HOME`.

## Notarization gap

Gatekeeper assessment currently rejects the app as:
`Unnotarized Developer ID`.

Tauri also reports notarization was skipped because notarization credentials are
not available in the environment. No keychain profile named `Pressfield` was
found via `xcrun notarytool`.

## Minimum next steps

1. Store notarization credentials in Keychain with `xcrun notarytool`.
2. Re-run `pnpm tauri build`.
3. Submit the signed DMG for notarization.
4. Staple the notarization ticket.
5. Re-run Gatekeeper checks against both the app and DMG.

## Validation commands

```sh
pnpm tauri build
codesign --verify --deep --strict --verbose=4 src-tauri/target/release/bundle/macos/Pressfield.app
codesign -dv --verbose=4 src-tauri/target/release/bundle/macos/Pressfield.app
hdiutil verify src-tauri/target/release/bundle/dmg/Pressfield_0.1.0_aarch64.dmg
spctl -a -vvv -t exec src-tauri/target/release/bundle/macos/Pressfield.app
spctl -a -vvv -t open src-tauri/target/release/bundle/dmg/Pressfield_0.1.0_aarch64.dmg
```
