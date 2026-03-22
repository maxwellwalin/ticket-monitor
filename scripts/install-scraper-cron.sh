#!/bin/bash
# Installs a macOS launchd job to run the scraper every 30 minutes.
# Usage: bash scripts/install-scraper-cron.sh

PLIST_NAME="com.ticket-monitor.scraper"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
BUN_PATH="$(which bun)"

mkdir -p "$LOG_DIR"

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>cd $PROJECT_DIR &amp;&amp; set -a &amp;&amp; source .env &amp;&amp; set +a &amp;&amp; $BUN_PATH run scripts/scraper.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/scraper.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/scraper-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:$HOME/.bun/bin</string>
    </dict>
</dict>
</plist>
EOF

# Load the job
launchctl unload "$PLIST_PATH" 2>/dev/null
launchctl load "$PLIST_PATH"

echo "Installed: $PLIST_PATH"
echo "Scraper will run every 30 minutes."
echo "Logs: $LOG_DIR/scraper.log"
echo ""
echo "To uninstall: launchctl unload $PLIST_PATH && rm $PLIST_PATH"
