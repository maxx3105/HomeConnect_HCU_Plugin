#!/bin/bash
# ============================================================
# build-plugin.sh
# Baut das HCU-Plugin und exportiert es als .tar.gz
#
# WICHTIG: Muss auf einem ARM64-Server ausgeführt werden!
# (Raspberry Pi, oder ARM64 Docker-Host)
#
# Verwendung:
#   chmod +x build-plugin.sh
#   ./build-plugin.sh
# ============================================================

set -e

IMAGE_TAG="homeconnect:latest"
OUTPUT="homeconnect-plugin.tar.gz"

echo "=== HCU Home Connect Plugin Build ==="
echo "Image:  $IMAGE_TAG"
echo "Output: $OUTPUT"
echo ""

# Architektur prüfen
ARCH=$(docker info 2>/dev/null | grep "Architecture" | awk '{print $2}')
echo "Docker Architektur: $ARCH"
if [[ "$ARCH" != "aarch64" && "$ARCH" != "arm64" ]]; then
  echo "⚠️  Warnung: Docker läuft nicht auf ARM64!"
  echo "   Die HCU benötigt ein ARM64-Image."
  echo "   Bitte auf einem Raspberry Pi oder ARM64-Server ausführen."
  exit 1
fi

echo ""
echo "→ Baue Image nativ auf ARM64..."
docker build -t "$IMAGE_TAG" .

echo ""
echo "→ Exportiere als .tar.gz..."
docker save "$IMAGE_TAG" | gzip > "$OUTPUT"

echo ""
echo "✅ Fertig!"
echo "   Archiv: $OUTPUT ($(du -sh $OUTPUT | cut -f1))"
echo ""
echo "   Nächster Schritt:"
echo "   1. HCUweb öffnen: https://hcu1-XXXX.local"
echo "   2. Plugins → 'Eigenes Plugin installieren'"
echo "   3. $OUTPUT hochladen"
