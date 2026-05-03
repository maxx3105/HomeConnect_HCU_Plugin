#!/bin/bash
# ============================================================
# build-plugin.sh
# Erstellt das HCU-Plugin-Archiv für die Installation auf der HCU.
#
# Verwendung:
#   chmod +x build-plugin.sh
#   ./build-plugin.sh
#
# Voraussetzungen:
#   - Docker mit ARM64-BuildKit-Support (docker buildx)
#   - Auf ARM64-Hosts (z.B. Raspberry Pi): normales "docker build" reicht
# ============================================================

set -e

PLUGIN_ID="com.github.maxx3105.homeconnect"
IMAGE_TAG="com.github.maxx3105.homeconnect:0.1.0"
OUTPUT="homeconnect-plugin-0.1.0.tar.gz"

echo "=== HCU Home Connect Plugin Build ==="
echo "Plugin-ID:  $PLUGIN_ID"
echo "Image-Tag:  $IMAGE_TAG"
echo "Output:     $OUTPUT"
echo ""

# ── Docker-Image bauen ──────────────────────────────────────────────────────
# Auf x86-Host: --platform linux/arm64 (braucht buildx + QEMU)
# Auf ARM64-Host (z.B. Raspberry Pi): --platform weglassen oder linux/arm64

if [ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "arm64" ]; then
  echo "→ ARM64-Host erkannt, baue nativ..."
  docker build -t "$IMAGE_TAG" .
else
  echo "→ x86-Host erkannt, baue mit --platform linux/arm64..."
  echo "  (Stelle sicher, dass docker buildx und QEMU eingerichtet sind)"
  echo "  Falls Fehler: 'docker run --privileged --rm tonistiigi/binfmt --install arm64'"
  docker buildx build --platform linux/arm64 --load -t "$IMAGE_TAG" .
fi

echo ""
echo "→ Image gebaut. Exportiere als .tar.gz..."

# ── Image als .tar.gz exportieren ──────────────────────────────────────────
# Das ist das Format, das die HCU erwartet: docker save | gzip
docker save "$IMAGE_TAG" | gzip > "$OUTPUT"

echo ""
echo "✅ Fertig!"
echo ""
echo "   Archiv:  $OUTPUT  ($(du -sh "$OUTPUT" | cut -f1))"
echo ""
echo "   Nächster Schritt:"
echo "   1. HCUweb öffnen: https://hcu1-XXXX.local"
echo "   2. Entwicklermodus → Plugins → 'Eigenes Plugin installieren'"
echo "   3. $OUTPUT hochladen"
echo ""
echo "   ⚠️  Vor der Installation: .env Datei befüllen und"
echo "      sicherstellen, dass HC_CLIENT_ID und HC_CLIENT_SECRET gesetzt sind."
