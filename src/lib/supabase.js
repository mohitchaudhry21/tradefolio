import { createClient } from '@supabase/supabase-js';

const URL_KEY  = 'tf_supabase_url';
const ANON_KEY = 'tf_supabase_anon_key';

export function getSupabaseConfig() {
  return {
    url: localStorage.getItem(URL_KEY)  || '',
    key: localStorage.getItem(ANON_KEY) || '',
  };
}

export function saveSupabaseConfig(url, key) {
  localStorage.setItem(URL_KEY, url.trim());
  localStorage.setItem(ANON_KEY, key.trim());
}

export function clearSupabaseConfig() {
  localStorage.removeItem(URL_KEY);
  localStorage.removeItem(ANON_KEY);
}

export function isSupabaseConfigured() {
  const { url, key } = getSupabaseConfig();
  return !!(url && key);
}

export function getSupabaseClient() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  try { return createClient(url, key); }
  catch { return null; }
}

export async function loadAllFromSupabase(client) {
  try {
    const { data, error } = await client.from('tf_data').select('key,value');
    if (error) throw error;
    const result = {};
    (data || []).forEach(row => { result[row.key] = row.value; });
    return result;
  } catch (err) {
    console.error('[Supabase] load error:', err.message);
    return null;
  }
}

export async function saveToSupabase(client, key, value) {
  if (!client) return false;
  try {
    const { error } = await client
      .from('tf_data')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] save error:', err.message);
    return false;
  }
}

export async function testSupabaseConnection(url, key) {
  try {
    const client = createClient(url.trim(), key.trim());
    const { error } = await client.from('tf_data').select('key').limit(1);
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export const SETUP_SQL = `create table if not exists tf_data (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz default now()
);`;
