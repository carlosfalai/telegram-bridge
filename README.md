# Telegram Bridge for Claude Code

Webhook service that captures Telegram messages and stores them in Supabase for Claude Code to read.

## Setup

### 1. Create Supabase Table

Run this SQL in Supabase SQL Editor (https://supabase.com/dashboard/project/gbxksgxezbljwlnlpkpz/sql/new):

```sql
CREATE TABLE IF NOT EXISTS telegram_messages (
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

### 2. Deploy to Render

Service is deployed at: **https://telegram-bridge.onrender.com**

Webhook URL: `https://telegram-bridge.onrender.com/webhook/telegram`

### 3. Configure Telegram Bot

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://telegram-bridge.onrender.com/webhook/telegram"}'
```

### 4. Claude Code Integration

Future Claude sessions will check messages on startup:

```bash
curl https://telegram-bridge.onrender.com/messages/unread
```

## Environment Variables

Required on Render:
- `SUPABASE_URL`: https://gbxksgxezbljwlnlpkpz.supabase.co
- `SUPABASE_SERVICE_ROLE_KEY`: (from .env)

## API Endpoints

- `GET /` - Health check
- `POST /webhook/telegram` - Telegram webhook (bot sends messages here)
- `GET /messages/unread` - Get unread messages
- `POST /messages/mark-read` - Mark messages as read
