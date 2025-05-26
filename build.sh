#!/bin/bash
set -e

export PATH="$HOME/.cargo/bin:$PATH"

echo "🔧 Building Rust WASM image compositor..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRATE_PATH="$SCRIPT_DIR/../wasm-image-compositor/compositor"
OUT_PATH="$SCRIPT_DIR/pkg"

cd "$CRATE_PATH"

wasm-pack build --target web --release --force --out-dir "$OUT_PATH"

echo "✅ Build complete: WASM output copied to pkg/"