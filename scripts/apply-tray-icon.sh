#!/bin/bash
set -euo pipefail
SRC="/Users/sunanang/src/Pome-Panel"
APP="/Applications/Pome Panel.app/Contents/Resources/app"
osascript -e 'quit app "Pome Panel"' >/dev/null 2>&1 || true
sleep 1
pkill -f "Pome Panel" >/dev/null 2>&1 || true
sleep 1
mkdir -p "$APP/build"
cp -f "$SRC/build/pome-trayTemplate.png" "$APP/build/"
cp -f "$SRC/build/pome-trayTemplate@2x.png" "$APP/build/"
# bump comment if still 18pt
python3 - <<'PY'
from pathlib import Path
p = Path("/Users/sunanang/src/Pome-Panel/main.js")
t = p.read_text()
p.write_text(t.replace("18pt Template（@2x=36px）", "22pt Template（@2x=44px）").replace("18pt Template", "22pt Template"))
print("main.js ok")
PY
cp -f "$SRC/main.js" "$APP/"
open -a "Pome Panel"
echo "Pome Panel tray icon updated to 22pt and relaunched."
