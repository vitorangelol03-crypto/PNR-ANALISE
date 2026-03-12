
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://flcncdidxmmornkgkfbb.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsY25jZGlkeG1tb3Jua2drZmJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxNjc5MzMsImV4cCI6MjA4NDc0MzkzM30.mBbCzkZA6w5Hp5j8W0BBHrdtvZlR4VHTVU5rwJVeVSo';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;
