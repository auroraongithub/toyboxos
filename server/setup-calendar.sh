#!/usr/bin/env bash
# Install the daily cron job after creating the private calendar config.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$DIR/setup_calendar.py"
