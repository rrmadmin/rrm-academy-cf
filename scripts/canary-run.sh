#!/bin/bash
# Cron wrapper for canary.mjs — sources secrets from 1Password
# Install: crontab -e → */30 * * * * /Users/brian/iCode/projects/rrm-academy-cf/scripts/canary-run.sh >> /tmp/canary.log 2>&1

export PATH="/opt/homebrew/bin:$PATH"

# Secrets cached in ~/.canary-env (chmod 600) to avoid op CLI TCC popups from cron
# Regenerate: source ~/.zshrc && op read 'op://Automation/Resend API/credential' etc.
source ~/.canary-env 2>/dev/null

export RESEND_API_KEY
export TELEGRAM_BOT_TOKEN
export TELEGRAM_CHAT_ID="PLACEHOLDER"  # TODO: set Brian's chat ID
export CANARY_SECRET

cd /Users/brian/iCode/projects/rrm-academy-cf
node scripts/canary.mjs
