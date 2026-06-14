# Security Policy

## Reporting a Vulnerability

Do not report vulnerabilities through public GitHub issues.

- Preferred channel: use the repository's GitHub private vulnerability reporting page at `/security/advisories/new` when a canonical remote is configured.
- Fallback channel: contact the maintainer privately through the same channel used to coordinate access to this repository.

Include the affected version or commit, reproduction steps, expected impact, and any suggested fix or mitigation.

## Local-First Security Model

- Pressfield is zero-network by product contract: no telemetry, no sync, and no cloud services.
- Writing data stays on the operator workstation.
- Desktop privileges live behind the Tauri/Rust boundary.
- SQLite persistence uses the local app data path and should not be repointed to shared or cloud-synced folders without an explicit design decision.

## Data Handling

- Treat drafts, document history, and hardcore-mode destruction state as user-owned private data.
- Do not add outbound network behavior for documents, prompts, diagnostics, or usage events.
- Do not persist secrets or tokens in frontend-visible storage.
- Do not log document contents unless a future debugging mode explicitly redacts and gates that behavior.

## Verification

Before shipping security-sensitive changes, run the repo's documented frontend and Rust checks from `README.md`, plus any local-first drift checks that confirm the app stays zero-network and offline-only.
