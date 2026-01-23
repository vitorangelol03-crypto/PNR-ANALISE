
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://flcncdidxmmornkgkfbb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsY25jZGlkeG1tb3Jua2drZmJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxNjc5MzMsImV4cCI6MjA4NDc0MzkzM30.mBbCzkZA6w5Hp5j8W0BBHrdtvZlR4VHTVU5rwJVeVSo';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
