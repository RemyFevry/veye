#!/usr/bin/env bash
set -euo pipefail

# Build the standalone binary using Bun's compile feature
# Produces a single binary that works without Bun installed

TARGETS=(
  "bun-darwin-arm64"
  "bun-darwin-x64"
  "bun-linux-arm64"
  "bun-linux-x64"
)

ENTRY="packages/cli/src/cli.ts"
OUTDIR="dist/binaries"

mkdir -p "$OUTDIR"

VERSION=$(node -p "require('./packages/cli/package.json').version" 2>/dev/null || echo "0.0.0")
DEFINE="VEYE_VERSION=\"${VERSION}\""
echo "Embedding version: $VERSION"

for target in "${TARGETS[@]}"; do
  os=$(echo "$target" | cut -d'-' -f2)
  arch=$(echo "$target" | cut -d'-' -f3)
  outfile="$OUTDIR/veye-${os}-${arch}"

  echo "Building $outfile..."
  bun build --compile --target="$target" --define "$DEFINE" "$ENTRY" --outfile "$outfile"
done

# Also build a native binary for the current platform
echo "Building native binary..."
bun build --compile --define "$DEFINE" "$ENTRY" --outfile "$OUTDIR/veye"

echo "Done. Binaries in $OUTDIR/"
