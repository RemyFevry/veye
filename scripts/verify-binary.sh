#!/usr/bin/env bash
set -euo pipefail

# Verify a compiled veye binary works without Bun installed.
# Builds the native binary, then exercises --help and --version.

ENTRY="packages/cli/src/cli.ts"
OUTDIR="dist/binaries"
BINARY="$OUTDIR/veye"

mkdir -p "$OUTDIR"

VERSION=$(node -p "require('./packages/cli/package.json').version" 2>/dev/null || echo "0.0.0")
DEFINE="VEYE_VERSION=\"${VERSION}\""

echo "Building native binary (version $VERSION)..."
bun build --compile --define "$DEFINE" "$ENTRY" --outfile "$BINARY"
chmod +x "$BINARY"

echo
echo "=== ./dist/binaries/veye --help ==="
"$BINARY" --help

echo
echo "=== ./dist/binaries/veye --version ==="
"$BINARY" --version

echo
echo "Binary verified: $BINARY"
