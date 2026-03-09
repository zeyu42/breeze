#!/bin/bash
# Build Breeze Zotero plugin as .xpi

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADDON_DIR="$SCRIPT_DIR/addon"
BUILD_DIR="$SCRIPT_DIR/builds"

mkdir -p "$BUILD_DIR"

# Remove old build
rm -f "$BUILD_DIR/breeze.xpi"

# Build XPI (just a zip file with .xpi extension)
cd "$ADDON_DIR"
zip -r "$BUILD_DIR/breeze.xpi" . \
    -x "*.DS_Store" \
    -x "__MACOSX/*" \
    -x "*.git*"

echo ""
echo "✅ Built: $BUILD_DIR/breeze.xpi"
echo ""
echo "To install:"
echo "  1. Open Zotero"
echo "  2. Tools → Add-ons"
echo "  3. Gear icon → Install Add-on From File…"
echo "  4. Select builds/breeze.xpi"
