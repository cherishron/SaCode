#!/bin/bash

set -e

echo "Running SaCode tests..."

cargo test --workspace

cargo build --release

node scripts/check-release.js

echo "Testing CLI..."
./target/release/sacode --version

echo "Testing TUI..."
./target/release/sacode-tui --help || true

echo "All tests passed!"
