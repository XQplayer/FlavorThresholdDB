import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const analyticsEnabled = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = analyticsEnabled
  ? createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export async function fetchSearchStats(limit = 30) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('search_stats')
    .select('cas, common_name, chinese_name, search_count, last_searched_at')
    .order('search_count', { ascending: false })
    .order('last_searched_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function fetchAnalyticsSummary() {
  if (!supabase) return { total_visits: 0, total_searches: 0, today_searches: 0 };
  const { data, error } = await supabase.rpc('get_analytics_summary');
  if (error) throw error;
  return data || { total_visits: 0, total_searches: 0, today_searches: 0 };
}

export async function recordVisit() {
  if (!supabase) return false;
  const { error } = await supabase.rpc('increment_visit');
  if (error) throw error;
  return true;
}

export async function recordCompoundSearch({ cas, commonName, chineseName }) {
  if (!supabase || !cas || !commonName) return false;
  const { error } = await supabase.rpc('increment_search', {
    p_cas: cas,
    p_common_name: commonName,
    p_chinese_name: chineseName || null,
  });
  if (error) throw error;
  return true;
}
