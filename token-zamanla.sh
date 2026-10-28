#!/bin/bash
# token-yenile.sh'yi her pazartesi 10:00'da çalıştıran launchd görevini kurar (bir kez çalıştırılır).
# Kaldırmak için: launchctl bootout gui/$(id -u)/com.yekvisual.reels-bot-token && rm ~/Library/LaunchAgents/com.yekvisual.reels-bot-token.plist
set -euo pipefail
ETIKET=com.yekvisual.reels-bot-token
P="$HOME/Library/LaunchAgents/$ETIKET.plist"
BETIK="$(cd "$(dirname "$0")" && pwd)/token-yenile.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$P" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETIKET</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$BETIK</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/reels-bot-token.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/reels-bot-token.log</string>
</dict>
</plist>
EOF
plutil -lint "$P" >/dev/null
launchctl bootout "gui/$(id -u)/$ETIKET" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$P"
echo "Kuruldu: her pazartesi 10:00 → $BETIK (günlük: ~/Library/Logs/reels-bot-token.log)"

# GitHub'daki yenileme işi GH_PAT olmadan çalışamıyor; yerine bu görev geçtiği için kapat.
gh workflow disable "Instagram token yenile" -R yekvisual/reels-bot 2>/dev/null && echo "GitHub'daki 'Instagram token yenile' işi kapatıldı." || true

# Şimdi bir kez yenile ve sonucu göster
bash "$BETIK"
