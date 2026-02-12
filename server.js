const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const FormData = require('form-data');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json());

// CORS - allow Orbit dashboard and any origin
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://gbxksgxezbljwlnlpkpz.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Keywords cache (refreshed every 5 minutes)
let keywordsCache = [];
let keywordsCacheTime = 0;

async function getKeywords() {
  const now = Date.now();
  if (keywordsCache.length > 0 && now - keywordsCacheTime < 5 * 60 * 1000) {
    return keywordsCache;
  }
  const { data, error } = await supabase
    .from('orbit_project_keywords')
    .select('*')
    .order('priority', { ascending: false });
  if (!error && data) {
    keywordsCache = data;
    keywordsCacheTime = now;
  }
  return keywordsCache;
}

// Auto-classify a message text to a project_id
async function classifyMessage(text) {
  if (!text) return 'uncategorized';
  const lowerText = text.toLowerCase().trim();
  const keywords = await getKeywords();

  // Phase 1: Check for "ProjectName:" prefix pattern (highest priority)
  for (const kw of keywords) {
    if (kw.keyword.endsWith(':')) {
      if (lowerText.startsWith(kw.keyword.toLowerCase())) {
        return kw.project_id;
      }
    }
  }

  // Phase 2: Check for colon-prefix patterns like "Squire: something"
  const colonIdx = lowerText.indexOf(':');
  if (colonIdx > 0 && colonIdx < 40) {
    const prefix = lowerText.substring(0, colonIdx).trim();
    for (const kw of keywords) {
      if (kw.keyword.toLowerCase() === prefix) {
        return kw.project_id;
      }
    }
  }

  // Phase 3: Scan full text for keyword matches (longest match first)
  const sortedByLength = [...keywords].sort((a, b) => b.keyword.length - a.keyword.length);
  for (const kw of sortedByLength) {
    if (!kw.keyword.endsWith(':') && lowerText.includes(kw.keyword.toLowerCase())) {
      return kw.project_id;
    }
  }

  return 'uncategorized';
}

// Generate a short title from message text
function generateTitle(text) {
  if (!text) return 'Untitled task';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 80) return clean;
  return clean.substring(0, 77) + '...';
}

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
  res.json({ status: 'ok', service: 'telegram-bridge', features: ['tasks', 'classification', 'cors'] });
});

// Telegram webhook endpoint
app.post('/webhook/telegram', async (req, res) => {
  res.sendStatus(200);

  try {
    const update = req.body;
    const message = update.message || update.edited_message;
    if (!message) return;

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

    if ((isVoice || isAudio) && TELEGRAM_BOT_TOKEN && OPENAI_API_KEY) {
      try {
        const fileId = isVoice ? message.voice.file_id : message.audio.file_id;
        const { buffer, ext } = await downloadTelegramFile(fileId);
        transcription = await transcribeAudio(buffer, ext);
        console.log('Transcribed:', transcription);
        if (!text) text = transcription;
      } catch (err) {
        console.error('Transcription failed:', err.message);
        transcription = `[transcription failed: ${err.message}]`;
      }
    }

    // Auto-classify the message to a project
    const projectId = await classifyMessage(text);
    console.log(`Classified to project: ${projectId}`);

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
      timestamp: new Date(message.date * 1000).toISOString(),
      project_id: projectId
    };

    const { data: msgData, error: msgError } = await supabase
      .from('telegram_messages')
      .insert([messageData])
      .select('id')
      .single();

    if (msgError) {
      console.error('Supabase insert error:', msgError);
      return;
    }

    console.log(`Message stored [${messageType}] project=${projectId}:`, text || '(no text)');

    // Skip task creation for trivial messages (greetings, status checks, etc.)
    const trivialPatterns = /^(sup|hi|hello|hey|yo|ok|yes|no|are you|test|listen|let me know)/i;
    if (text && !trivialPatterns.test(text.trim()) && text.length > 20) {
      // Create an orbit_task from this message
      const { error: taskError } = await supabase
        .from('orbit_tasks')
        .insert([{
          project_id: projectId,
          source: 'telegram',
          source_msg_id: msgData.id,
          title: generateTitle(text),
          body: text,
          status: 'pending',
          priority: /urgent|asap|now|immediately/i.test(text) ? 2 : (/next|soon|important/i.test(text) ? 1 : 0)
        }]);

      if (taskError) {
        console.error('Task creation error:', taskError);
      } else {
        console.log(`Task created for project ${projectId}`);
      }
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
  }
});

// ========== EXISTING MESSAGE ENDPOINTS ==========

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

// Reassign a message to a different project
app.post('/messages/:id/assign', async (req, res) => {
  try {
    const msgId = parseInt(req.params.id);
    const { project_id } = req.body;

    // Update message project
    const { error: msgErr } = await supabase
      .from('telegram_messages')
      .update({ project_id })
      .eq('id', msgId);
    if (msgErr) throw msgErr;

    // Update associated task if exists
    const { error: taskErr } = await supabase
      .from('orbit_tasks')
      .update({ project_id, updated_at: new Date().toISOString() })
      .eq('source_msg_id', msgId);
    if (taskErr) console.error('Task reassign error:', taskErr);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== TASK ENDPOINTS ==========

// Get tasks, optionally filtered by project and/or status
app.get('/tasks', async (req, res) => {
  try {
    let query = supabase.from('orbit_tasks').select('*');

    if (req.query.project_id) query = query.eq('project_id', req.query.project_id);
    if (req.query.status) query = query.eq('status', req.query.status);

    query = query.order('priority', { ascending: false })
                 .order('created_at', { ascending: true });

    if (req.query.limit) query = query.limit(parseInt(req.query.limit));

    const { data, error } = await query;
    if (error) throw error;

    res.json({ count: data.length, tasks: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get task counts per project (for dashboard badges)
app.get('/tasks/summary', async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const { data, error } = await supabase
      .from('orbit_tasks')
      .select('project_id, status');

    if (error) throw error;

    const summary = {};
    let totalPending = 0;
    let totalInProgress = 0;
    let totalDone = 0;

    for (const task of data) {
      if (!summary[task.project_id]) {
        summary[task.project_id] = { pending: 0, in_progress: 0, done: 0 };
      }
      summary[task.project_id][task.status] = (summary[task.project_id][task.status] || 0) + 1;
      if (task.status === 'pending') totalPending++;
      else if (task.status === 'in_progress') totalInProgress++;
      else if (task.status === 'done') totalDone++;
    }

    res.json({
      total: { pending: totalPending, in_progress: totalInProgress, done: totalDone },
      projects: summary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a task (status, priority, project)
app.patch('/tasks/:id', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const updates = { updated_at: new Date().toISOString() };

    if (req.body.status) updates.status = req.body.status;
    if (req.body.priority !== undefined) updates.priority = req.body.priority;
    if (req.body.project_id) updates.project_id = req.body.project_id;
    if (req.body.title) updates.title = req.body.title;
    if (req.body.status === 'done') updates.completed_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('orbit_tasks')
      .update(updates)
      .eq('id', taskId)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, task: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a task manually
app.post('/tasks', async (req, res) => {
  try {
    const { project_id, title, body, priority } = req.body;
    if (!project_id || !title) {
      return res.status(400).json({ error: 'project_id and title are required' });
    }

    const { data, error } = await supabase
      .from('orbit_tasks')
      .insert([{
        project_id,
        source: 'manual',
        title,
        body: body || null,
        priority: priority || 0,
        status: 'pending'
      }])
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, task: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get project keywords
app.get('/projects/keywords', async (req, res) => {
  try {
    const keywords = await getKeywords();
    res.json({ count: keywords.length, keywords });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Telegram bridge running on port ${PORT}`);
  console.log('Features: CORS, auto-classification, task management');
});
