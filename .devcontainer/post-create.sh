#!/usr/bin/env bash
#
# Provisiona el Codespace estandar (Linux nativo, sin GPU) para scaffold-stylus.
# Corre una sola vez, al crear el contenedor.
set -euo pipefail

echo ">> Instalando Foundry (cast/forge) para deploy y pruebas manuales..."
curl -L https://foundry.paradigm.xyz | bash
export PATH="$HOME/.foundry/bin:$PATH"
grep -qxF 'export PATH="$HOME/.foundry/bin:$PATH"' "$HOME/.bashrc" || \
  echo 'export PATH="$HOME/.foundry/bin:$PATH"' >> "$HOME/.bashrc"
foundryup

echo ">> Anadiendo target wasm (rust-toolchain.toml fija rustc 1.91.0)..."
rustup target add wasm32-unknown-unknown

echo ">> Instalando cargo-stylus 0.10.8 (version exigida por el scaffold)..."
cargo install --locked cargo-stylus@0.10.8

echo ">> Instalando dependencias del frontend (yarn 3 vendorizado)..."
corepack enable
yarn install

echo ">> Entorno listo. Siguiente: yarn chain / yarn deploy / yarn start"
