#!/bin/bash
# publish.py ↔ Worker anahtarını üretir ve üç yere yazar: Worker secret, GitHub secret, Mac Keychain.
# Bir kez çalıştırılır; yeniden çalıştırılırsa anahtar yenilenir (üçü birden değişir).
set -euo pipefail
cd "$(dirname "$0")"
KEY=$(openssl rand -hex 24)
printf '%s' "$KEY" | npx wrangler secret put OTOMASYON_ANAHTARI
printf '%s' "$KEY" | gh secret set DM_WORKER_ANAHTAR -R yekvisual/reels-bot
security add-generic-password -a yekvisual/reels-bot -s reels-bot-dm -w "$KEY" -U
echo "Anahtar yazıldı: Worker (OTOMASYON_ANAHTARI), GitHub (DM_WORKER_ANAHTAR), Keychain (reels-bot-dm)"
