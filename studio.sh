#!/bin/sh
# UltraGame Studio: editor de juegos 2D/3D (macOS / Linux). Uso: ./studio.sh [--port 5210] [--workspace carpeta]
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "No se encuentra Node.js. Instalalo desde https://nodejs.org (version 18 o superior)."
  exit 1
fi
exec node tools/studio-server.js "$@"
