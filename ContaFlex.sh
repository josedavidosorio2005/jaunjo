#!/usr/bin/env bash
# Lanzador de ContaFlex para Linux
# Uso: chmod +x ContaFlex.sh && ./ContaFlex.sh

cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "[ContaFlex] Instalando dependencias..."
  npm install
fi

node scripts/launch.js
