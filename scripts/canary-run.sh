#!/bin/bash
# Cron wrapper for canary.mjs — sources secrets from 1Password
# Install: crontab -e → */30 * * * * /Users/brian/iCode/projects/rrm-academy-cf/scripts/canary-run.sh >> /tmp/canary.log 2>&1

export PATH="/opt/homebrew/bin:$PATH"

# Secrets cached in ~/.canary-env (chmod 600) to avoid op CLI TCC popups from cron
# Regenerate with AWS SES + Telegram creds
source ~/.canary-env 2>/dev/null

export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_SES_REGION
export TELEGRAM_BOT_TOKEN
export TELEGRAM_CHAT_ID="8444326757"
export CANARY_SECRET

cd /Users/brian/iCode/projects/rrm-academy-cf
node scripts/canary.mjs
