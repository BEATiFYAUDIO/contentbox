#!/usr/bin/env bash
set -euo pipefail

LND_DIR="${LND_DIR:-$HOME/.lnd}"
BITCOIN_DIR="${BITCOIN_DIR:-$HOME/.bitcoin}"

chmod_if_exists() {
  local mode="$1"
  local path="$2"
  if [[ -e "$path" ]]; then
    chmod "$mode" "$path"
    printf 'set %s %s\n' "$mode" "$path"
  fi
}

if [[ -d "$LND_DIR" ]]; then
  chmod_if_exists 700 "$LND_DIR"
  chmod_if_exists 700 "$LND_DIR/data"
  chmod_if_exists 700 "$LND_DIR/data/chain"
  chmod_if_exists 700 "$LND_DIR/data/chain/bitcoin"
  chmod_if_exists 700 "$LND_DIR/data/chain/bitcoin/mainnet"
  chmod_if_exists 600 "$LND_DIR/lnd.conf"
  chmod_if_exists 600 "$LND_DIR/tls.key"
  chmod_if_exists 600 "$LND_DIR/data/chain/bitcoin/mainnet/admin.macaroon"
  chmod_if_exists 600 "$LND_DIR/data/chain/bitcoin/mainnet/invoice.macaroon"
  chmod_if_exists 600 "$LND_DIR/data/chain/bitcoin/mainnet/invoices.macaroon"
  chmod_if_exists 600 "$LND_DIR/data/chain/bitcoin/mainnet/readonly.macaroon"
  chmod_if_exists 600 "$LND_DIR/data/chain/bitcoin/mainnet/router.macaroon"
  chmod_if_exists 600 "$LND_DIR/data/chain/bitcoin/mainnet/walletkit.macaroon"
  chmod_if_exists 600 "$LND_DIR/data/chain/bitcoin/mainnet/signer.macaroon"
  chmod_if_exists 600 "$LND_DIR/data/chain/bitcoin/mainnet/chainnotifier.macaroon"
  find "$LND_DIR/data/chain/bitcoin/mainnet" -maxdepth 1 -type f -name 'certifyd-*.macaroon' -print0 2>/dev/null |
    while IFS= read -r -d '' macaroon; do
      chmod_if_exists 600 "$macaroon"
    done
fi

if [[ -d "$BITCOIN_DIR" ]]; then
  chmod_if_exists 700 "$BITCOIN_DIR"
  chmod_if_exists 600 "$BITCOIN_DIR/bitcoin.conf"
  chmod_if_exists 600 "$BITCOIN_DIR/.cookie"
fi
