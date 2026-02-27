#!/bin/bash
# Cron wrapper for canary.mjs — sources secrets from 1Password
# Install: crontab -e → */30 * * * * /Users/brian/iCode/projects/rrm-academy-cf/scripts/canary-run.sh >> /tmp/canary.log 2>&1

export PATH="/opt/homebrew/bin:$PATH"
source ~/.zshrc 2>/dev/null

export RESEND_API_KEY=$(op read 'op://Automation/Resend API/credential' 2>/dev/null)
export TELEGRAM_BOT_TOKEN=$(op read 'op://Automation/rrmClaudeCode Telegram Bot Token/credential' 2>/dev/null)
export TELEGRAM_CHAT_ID="PLACEHOLDER"  # TODO: set Brian's chat ID

cd /Users/brian/iCode/projects/rrm-academy-cf
node scripts/canary.mjs
