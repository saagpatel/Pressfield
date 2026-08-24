# Pressfield Release Readiness

_Last checked: 2026-08-24 on `feat-distkit-consume` (supersedes the 2026-06-07 pass)._

## Current state: RELEASED

v0.1.0 is publicly distributed:
https://github.com/saagpatel/Pressfield/releases/tag/v0.1.0

Every distribution layer passed, with evidence in the attached `receipt-0.1.0.json`
(schema `distkit-receipt/v0`):

| Layer | Evidence |
|---|---|
| Build | `pnpm tauri build` at commit `0aca35b`, clean tree, version preflight 0.1.0 |
| Signing | `codesign --verify --deep --strict` pass; Authority = `Developer ID Application: SAAGAR I PATEL (3TGZFKFNA4)`; hardened runtime |
| Notarization | .app: Apple submission `42626788…` Accepted (via Tauri); DMG: submission `d11378e4…` Accepted |
| Stapling | app + DMG stapled; `stapler validate` pass on both |
| Gatekeeper (local) | `spctl --assess` accepted: app (exec) and DMG (open) |
| Publication | GitHub Release `v0.1.0`, DMG sha256 `438d5bbd10f4c13e0eadedf53712ef8147db2541dd069489f7804b08157b719d` |
| Provider readback | published asset re-downloaded and byte-compared: match; GitHub's own asset digest matches |
| Independent consumer | **UNKNOWN** — no clean consumer Mac was available; not claimed |

## Release path (current)

```sh
~/Projects/distribution-kit/lanes/macos.sh ./distkit.macos.config.sh
```

Project-specific values live in `distkit.macos.config.sh`. Credentials: App Store
Connect API key `AuthKey_6NPVH55ZWG.p8` in `~/.appstoreconnect/private_keys/` +
issuer ID in the macOS Keychain (`asc-radar` / `issuer_id`), read at runtime and
never committed. The older `scripts/notarize-release.sh` keychain-profile path was
never provisioned and is superseded by the kit lane.

## Next release checklist

1. Bump `version` in `src-tauri/tauri.conf.json`.
2. Update `DK_VERSION`, `DK_TAG`, `DK_DMG_PATH` in `distkit.macos.config.sh`; write
   `RELEASE-NOTES-<version>.md` and point `DK_RELEASE_NOTES_FILE` at it.
3. Run the kit lane; it refuses to publish anything that fails a verification stage.
