# Legacy Code Archive

This directory contains the original monolithic Rust code from the early MVP phase.

## Contents

- `src/main.rs` - Original single-entry CLI and server
- `src/runtime.rs` - Original runtime helpers
- `src/models.rs` - Original data models

Total: ~5200 lines

## Status

These files are **archived** and **no longer compiled**. They serve as historical reference for the transition from monolithic structure to the current workspace architecture.

## Migration

The code has been restructured into:

- `kernel/` - Pure logic layer
- `runtime/` - Side effects and capabilities
- `interfaces/cli/` - CLI entry point

For current implementation, refer to the workspace root and `docs/product/PRD.md`.
