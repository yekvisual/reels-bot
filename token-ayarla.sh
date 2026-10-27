#!/bin/bash
# Panodaki Instagram anahtarını (Meta paneli → Generate token) kontrol eder, GitHub secret'ına ve
# Anahtar Zinciri'ne yazar, eşitleme işini açıp bir kez çalıştırır. Anahtar ekrana hiç basılmaz.
#
#   1. Meta panelinde @yekvisual için Generate token → Kopyala
#   2. ./token-ayarla.sh
set -euo pipefail
REPO=yekvisual/reels-bot
HESAP=${REELS_BOT_HESAP:-yekvisual}
SYNC="Instagram paylaşımlarını eşitle"

T="$(pbpaste | tr -d '[:space:]')"
case "$T" in
  IG*) ;;
  *) echo "Panodaki değer Instagram anahtarı değil (IG ile başlamalı, ${#T} karakter geldi)."
     echo "Meta panelinde 'Generate token' ile alıp kopyala, sonra yeniden çalıştır."; exit 1 ;;
esac

resp=$(curl -sS -G "https://graph.instagram.com/v26.0/me" \
  --data-urlencode "fields=user_id,username,account_type" --data-urlencode "access_token=$T")
user=$(jq -r '.username // empty' <<<"$resp")
if [ -z "$user" ]; then
  echo "Instagram anahtarı kabul etmedi: $(jq -c '.error.message // .' <<<"$resp")"; exit 1
fi
if [ "$user" != "$HESAP" ]; then
  echo "Bu anahtar @$user hesabının; bu depo @$HESAP için. Doğru hesabın anahtarını kopyala."; exit 1
fi
echo "Anahtar geçerli: @$user ($(jq -r '.account_type' <<<"$resp"))"

# Yerel yenileme (token-yenile.sh) buradan okur.
security add-generic-password -U -a "$REPO" -s reels-bot-ig -w "$T"
printf %s "$T" | gh secret set IG_ACCESS_TOKEN -R "$REPO"
pbcopy </dev/null
echo "GitHub secret'ı ve Anahtar Zinciri güncellendi, pano temizlendi."

gh workflow enable "$SYNC" -R "$REPO"
gh workflow run "$SYNC" -R "$REPO"
sleep 8
id=$(gh run list -R "$REPO" -w "$SYNC" -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$id" -R "$REPO" --exit-status >/dev/null && echo "Eşitleme başarılı: instagram/son.json güncellendi." \
  || { echo "Eşitleme düştü:"; gh run view "$id" -R "$REPO" --log-failed | grep -E "Paylaşım alınamadı|error" | tail -3; exit 1; }
