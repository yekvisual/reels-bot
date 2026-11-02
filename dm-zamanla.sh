#!/bin/bash
# dm.py'yi bu Mac'te 2 dakikada bir çalıştıran launchd görevini kurar (bir kez çalıştırılır).
# Mac açıkken yorum → DM gecikmesi 1–2 dakikaya iner; kapalıyken GitHub'daki iş (10 dk) devralır.
# Kaldırmak için: launchctl bootout gui/$(id -u)/com.yekvisual.reels-bot-dm && rm ~/Library/LaunchAgents/com.yekvisual.reels-bot-dm.plist
set -euo pipefail
# 2 Kasım 2026'dan beri DM'ler Cloudflare Worker'da (dm-worker/). Bu betik eski sistemi geri açar ve aynı kişiye
# iki mesaj gitmesine yol açar. Gerçekten gerekiyorsa: ./dm-zamanla.sh --eski-sistemi-ac
if [ "${1:-}" != "--eski-sistemi-ac" ]; then
  echo "Eski DM sistemi kapalı; DM'ler dm-worker/ içindeki Cloudflare Worker'dan gidiyor. Bilerek açmak için: $0 --eski-sistemi-ac" >&2
  exit 1
fi
ETIKET=com.yekvisual.reels-bot-dm
P="$HOME/Library/LaunchAgents/$ETIKET.plist"
DEPO="$(cd "$(dirname "$0")" && pwd)"
PY=/usr/bin/python3
DURUM="$HOME/Library/Application Support/reels-bot/dm-durum.json"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$(dirname "$DURUM")"
"$PY" -c "import requests" || { echo "$PY içinde requests yok: $PY -m pip install --user requests"; exit 1; }

cat > "$P" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETIKET</string>
  <key>ProgramArguments</key>
  <array><string>$PY</string><string>$DEPO/dm.py</string></array>
  <key>WorkingDirectory</key><string>$DEPO</string>
  <key>EnvironmentVariables</key>
  <dict><key>DM_DURUM</key><string>$DURUM</string></dict>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/reels-bot-dm.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/reels-bot-dm.log</string>
</dict>
</plist>
EOF
plutil -lint "$P" >/dev/null
launchctl bootout "gui/$(id -u)/$ETIKET" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$P"
echo "Kuruldu: 2 dakikada bir $DEPO/dm.py (günlük: ~/Library/Logs/reels-bot-dm.log)"
sleep 15; tail -3 "$HOME/Library/Logs/reels-bot-dm.log"
