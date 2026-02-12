const https = require('https');

const data = JSON.stringify({
  query: `
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

    CREATE INDEX IF NOT EXISTS idx_telegram_messages_read ON telegram_messages(read);
    CREATE INDEX IF NOT EXISTS idx_telegram_messages_timestamp ON telegram_messages(timestamp DESC);

    ALTER TABLE telegram_messages ENABLE ROW LEVEL SECURITY;

    CREATE POLICY IF NOT EXISTS "Service role has full access" ON telegram_messages
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  `
});

const options = {
  hostname: 'gbxksgxezbljwlnlpkpz.supabase.co',
  port: 443,
  path: '/rest/v1/rpc',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdieGtzZ3hlemJsandsbmxwa3B6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0ODc1MTU4OSwiZXhwIjoyMDY0MzI3NTg5fQ.o9R4Z9_p3CEnOzcJ66_zn0Fg0vdauHoSt-cM3KiGXdo',
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdieGtzZ3hlemJsandsbmxwa3B6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0ODc1MTU4OSwiZXhwIjoyMDY0MzI3NTg5fQ.o9R4Z9_p3CEnOzcJ66_zn0Fg0vdauHoSt-cM3KiGXdo'
  }
};

console.log('Creating telegram_messages table...');

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('✓ Table created successfully!');
    } else {
      console.log('✗ Failed to create table');
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();
