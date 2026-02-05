const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://gbxksgxezbljwlnlpkpz.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'telegram-bridge' });
});

// Telegram webhook endpoint
app.post('/webhook/telegram', async (req, res) => {
  try {
    const update = req.body;

    // Extract message data
    const message = update.message || update.edited_message;
    if (!message) {
      return res.sendStatus(200);
    }

    const messageData = {
      telegram_id: message.message_id,
      chat_id: message.chat.id,
      user_id: message.from.id,
      username: message.from.username || null,
      first_name: message.from.first_name || null,
      text: message.text || null,
      message_type: message.photo ? 'photo' : message.document ? 'document' : 'text',
      raw_data: update,
      read: false,
      timestamp: new Date(message.date * 1000).toISOString()
    };

    // Store in Supabase
    const { error } = await supabase
      .from('telegram_messages')
      .insert([messageData]);

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('Message stored:', messageData.text);
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint for Claude to check messages
app.get('/messages/unread', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('telegram_messages')
      .select('*')
      .eq('read', false)
      .order('timestamp', { ascending: true });

    if (error) throw error;

    res.json({ count: data.length, messages: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark messages as read
app.post('/messages/mark-read', async (req, res) => {
  try {
    const { ids } = req.body;

    const { error } = await supabase
      .from('telegram_messages')
      .update({ read: true })
      .in('id', ids);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Telegram bridge running on port ${PORT}`);
});
