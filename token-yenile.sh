#!/bin/bash
# Instagram Login anahtarları 60 günde biter. launchd (com.yekvisual.reels-bot-token) bunu haftada bir çalıştırır:
# Anahtar Zinciri'ndeki anahtarı yeniler, Anahtar Zinciri'ne ve GitHub secret'ına yazar.
# GitHub'daki refresh-token işinin yerini alır (GH_PAT gerekmez, bu Mac'teki gh oturumu kullanılır).
set -uo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
REPO=yekvisual/reels-bot

fail() {
  echo "$(date '+%F %T') HATA: $1"
  osascript -e "display notification \"$1\" with title \"reels-bot anahtarı\"" >/dev/null 2>&1
  exit 1
}

T=$(security find-generic-password -a "$REPO" -s reels-bot-ig -w 2>/dev/null) \
  || fail "Anahtar Zinciri'nde anahtar yok; ./token-ayarla.sh çalıştır."
resp=$(curl -sS -G "https://graph.instagram.com/refresh_access_token" \
  --data-urlencode "grant_type=ig_refresh_token" --data-urlencode "access_token=$T") || fail "Instagram'a ulaşılamadı."
new=$(jq -r '.access_token // empty' <<<"$resp")
[ -n "$new" ] || fail "Yenileme başarısız: $(jq -r '.error.message // "bilinmeyen hata"' <<<"$resp")"

security add-generic-password -U -a "$REPO" -s reels-bot-ig -w "$new"
printf %s "$new" | gh secret set IG_ACCESS_TOKEN -R "$REPO" || fail "GitHub secret'ı yazılamadı (gh oturumu?)."
echo "$(date '+%F %T') yenilendi, $(( $(jq -r '.expires_in' <<<"$resp") / 86400 )) gün geçerli."
