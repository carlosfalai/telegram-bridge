const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  'https://gbxksgxezbljwlnlpkpz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdieGtzZ3hlemJsandsbmxwa3B6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0ODc1MTU4OSwiZXhwIjoyMDY0MzI3NTg5fQ.o9R4Z9_p3CEnOzcJ66_zn0Fg0vdauHoSt-cM3KiGXdo'
);

async function setupDatabase() {
  console.log('Setting up telegram_messages table...');

  const sql = fs.readFileSync('schema.sql', 'utf8');

  // Split SQL into individual statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    try {
      console.log('Executing:', statement.substring(0, 50) + '...');
      const { error } = await supabase.rpc('exec', { sql: statement });
      if (error) {
        console.error('Error:', error);
      } else {
        console.log('✓ Success');
      }
    } catch (err) {
      console.error('Error:', err.message);
    }
  }

  console.log('\nDatabase setup complete!');
}

setupDatabase();
