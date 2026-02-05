const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const FormData = require('form-data');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://gbxksgxezbljwlnlpkpz.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Download a file from Telegram and return it as a Buffer
async function downloadTelegramFile(fileId) {
  const fileRes = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  if (!fileRes.ok) throw new Error(`Telegram getFile failed: ${fileRes.status}`);
  const fileData = await fileRes.json();
  if (!fileData.ok) throw new Error(`Telegram getFile error: ${fileData.description}`);

  const downloadRes = await fetch(
    `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`
  );
  if (!downloadRes.ok) throw new Error(`Telegram download failed: ${downloadRes.status}`);

  const buffer = await downloadRes.buffer();
  // Extract extension from file_path (e.g. "voice/file_1.oga" -> "oga")
  const ext = fileData.result.file_path.split('.').pop() || 'oga';
  return { buffer, ext };
}

// Transcribe audio buffer using OpenAI Whisper
async function transcribeAudio(audioBuffer, ext) {
  const form = new FormData();
  form.append('file', audioBuffer, { filename: `voice.${ext}`, contentType: 'audio/ogg' });
  form.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: form
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper API error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return data.text;
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'telegram-bridge' });
});

// Telegram webhook endpoint
app.post('/webhook/telegram', async (req, res) => {
  // Respond 200 immediately so Telegram doesn't retry
  res.sendStatus(200);

  try {
    const update = req.body;
    const message = update.message || update.edited_message;
    if (!message) return;

    // Determine message type
    const isVoice = !!message.voice;
    const isAudio = !!message.audio;
    const isPhoto = !!message.photo;
    const isDocument = !!message.document;

    let messageType = 'text';
    if (isVoice) messageType = 'voice';
    else if (isAudio) messageType = 'audio';
    else if (isPhoto) messageType = 'photo';
    else if (isDocument) messageType = 'document';

    let text = message.text || message.caption || null;
    let transcription = null;

    // Auto-transcribe voice/audio messages
    if ((isVoice || isAudio) && TELEGRAM_BOT_TOKEN && OPENAI_API_KEY) {
      try {
        const fileId = isVoice ? message.voice.file_id : message.audio.file_id;
        const { buffer, ext } = await downloadTelegramFile(fileId);
        transcription = await transcribeAudio(buffer, ext);
        console.log('Transcribed:', transcription);
        // If no text, use transcription as the text so it shows up naturally
        if (!text) text = transcription;
      } catch (err) {
        console.error('Transcription failed:', err.message);
        transcription = `[transcription failed: ${err.message}]`;
      }
    }

    const messageData = {
      telegram_id: message.message_id,
      chat_id: message.chat.id,
      user_id: message.from.id,
      username: message.from.username || null,
      first_name: message.from.first_name || null,
      text,
      transcription,
      message_type: messageType,
      raw_data: update,
      read: false,
      timestamp: new Date(message.date * 1000).toISOString()
    };

    const { error } = await supabase
      .from('telegram_messages')
      .insert([messageData]);

    if (error) {
      console.error('Supabase insert error:', error);
    } else {
      console.log(`Message stored [${messageType}]:`, text || '(no text)');
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
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

// Get latest N messages (read or unread)
app.get('/messages/latest', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const { data, error } = await supabase
      .from('telegram_messages')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);

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
