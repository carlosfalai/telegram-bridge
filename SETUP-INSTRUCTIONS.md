# Telegram Bridge Setup Instructions

## What's Been Done

✅ Created webhook service (Node.js + Express)
✅ Integrated with Supabase for message storage
✅ Created GitHub repo: https://github.com/carlosfalai/telegram-bridge
✅ Configured for Render deployment
✅ Created startup script for future Claude sessions
✅ Updated Ralph Wiggum plugin

## What You Need to Do

### Step 1: Create Supabase Table

Go to: https://supabase.com/dashboard/project/gbxksgxezbljwlnlpkpz/sql/new

Run this SQL:

```sql
CREATE TABLE telegram_messages (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  text TEXT,
  message_type TEXT DEFAULT 'text',
  raw_data JSONB,
  read BOOLEAN DEFAULT false,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_telegram_messages_read ON telegram_messages(read);
CREATE INDEX idx_telegram_messages_timestamp ON telegram_messages(timestamp DESC);

ALTER TABLE telegram_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access" ON telegram_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### Step 2: Deploy to Render

1. Go to: https://dashboard.render.com/
2. Click "New +" → "Web Service"
3. Connect GitHub repo: `carlosfalai/telegram-bridge`
4. Render will auto-detect `render.yaml`
5. Add environment variables:
   - Key: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: Get from Supabase Dashboard → Project Settings → API → service_role (secret)
   - Key: `SUPABASE_URL`
   - Value: `https://gbxksgxezbljwlnlpkpz.supabase.co`
   - Key: `TELEGRAM_BOT_TOKEN`
   - Value: Your Telegram bot token from @BotFather
   - Key: `OPENAI_API_KEY`
   - Value: Your OpenAI API key (for voice transcription)
6. Click "Create Web Service"
7. **Copy your Render URL** (e.g., `https://telegram-bridge-xxxx.onrender.com`)

### Step 3: Create/Configure Telegram Bot

If you don't have a bot yet:
1. Message @BotFather on Telegram
2. Send `/newbot`
3. Follow instructions to create bot
4. **Copy the bot token**

Configure webhook:
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://telegram-bridge-XXXX.onrender.com/webhook/telegram"}'
```

Replace:
- `<YOUR_BOT_TOKEN>` with your actual bot token
- `XXXX` with your Render service ID

### Step 4: Update Claude Startup Script

Edit `C:\Users\Carlos Faviel Font\.claude\check-telegram.sh`:
- Replace `WEBHOOK_URL="https://telegram-bridge-XXXX.onrender.com"` with your actual Render URL

### Step 5: Test It!

1. Message your Telegram bot
2. Check if message was received:
```bash
curl https://telegram-bridge-XXXX.onrender.com/messages/unread
```

3. Restart Claude Code - future sessions will check messages on startup!

## How Future Claude Sessions Will Work

When you start Claude Code, it will:
1. Check for Telegram messages automatically
2. Display unread messages
3. Ask if you want to mark them as read
4. You can communicate with Claude via Telegram!

## Troubleshooting

**Service not responding:**
- Check Render logs: https://dashboard.render.com/
- Verify environment variables are set

**Messages not saving:**
- Check Supabase table was created correctly
- Verify service role key is correct

**Bot not sending messages:**
- Verify webhook is set: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
- Check Render URL is correct and service is running

## Security Notes

- NEVER commit `.env` files or hardcode API keys
- Always use environment variables for sensitive credentials
- The service role key should ONLY be stored in Render environment variables
- If you suspect a key has been exposed, rotate it immediately in Supabase Dashboard

## Next Steps After Restart

After you restart Claude Code with Opus 4.6:
1. Claude will check Telegram messages on startup
2. You can message the bot to give Claude instructions
3. Use Ralph Wiggum for autonomous iteration: `/ralph-loop "your task..."`
4. Enjoy the new workflow! 🚀
