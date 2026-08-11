# Nexora Automation Colony

Automation Colony is a programmable persistent-world game. Player code submits commands, and the authoritative service resolves movement, harvesting, transfers, production, and controller upgrades in a deterministic order. The browser provides the game interface, code editor, and live world view.

This repository contains only game code and game rules. Nexora Engine is maintained in a separate repository; the game consumes its public package, SDK, and protocol boundaries without containing the engine kernel, SDKs, protocol contracts, or engine CI.

## Current capabilities

- Local authoritative TypeScript service, persistent world, and player code storage.
- Fixed-tick production, movement, harvesting, transfer, and controller-upgrade resolution.
- Player scripts submit intents through a restricted API and cannot mutate the world directly.
- Browser WebSocket updates, Canvas world view, code editing, simulation controls, and console output.
- Independent Rust game-rules package using public crates from a pinned Nexora Engine git revision.

## Quick start

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`.

## Repository layout

```text
client/                         Automation Colony browser client
server/                         Local authoritative service, script runtime, and persistence
shared/                         REST and WebSocket game data model
packages/automation-colony/     Independent Rust rules package and game manifests
```

## Verification

```bash
npm test
npm run build
cargo test --manifest-path Cargo.toml -p automation-colony
```

The Rust rules package resolves the pinned Nexora Engine source revision declared in [packages/automation-colony/Cargo.toml](packages/automation-colony/Cargo.toml); no sibling engine checkout is required. Deployment and local security boundaries are documented in [SECURITY.md](SECURITY.md).
