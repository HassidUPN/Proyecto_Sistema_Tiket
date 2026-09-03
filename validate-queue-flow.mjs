const fs = require('fs');
const path = require('path');
const envPath = path.join(process.cwd(), '.env.local');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  if (!line || line.trim().startsWith('#')) continue;
  const idx = line.indexOf('=');
  if (idx === -1) continue;
  const key = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim().replace(/^['\"]|['\"]$/g, '');
  env[key] = value;
}
process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const { createClient } = require('@supabase/supabase-js');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
(async () => {
  const stationRes = await supabase.from('stations').select('*').eq('station_type', 'CAJA').order('label', { ascending: true }).limit(10);
  if (stationRes.error) throw stationRes.error;
  console.log('STATIONS', JSON.stringify(stationRes.data.map(s => ({ id: s.id, label: s.label, type: s.station_type })), null, 2));
  const station = (stationRes.data || []).find(s => s.label === '1') || (stationRes.data || [])[0];
  if (!station) throw new Error('No CAJA station available');

  const code = `FLOW-${Date.now()}`;
  const insertRes = await supabase.from('tickets').insert({
    code,
    profile: 'PN',
    service_type: 'CAJA',
    status: 'WAITING',
    sequence: Date.now() % 100000,
    attempts: 0,
  }).select().single();
  if (insertRes.error) throw insertRes.error;
  const ticketId = insertRes.data.id;
  console.log('INSERTED', JSON.stringify(insertRes.data, null, 2));

  const callRes = await supabase.rpc('call_next_ticket', { p_service_type: 'CAJA', p_station_id: station.id });
  if (callRes.error) throw callRes.error;
  console.log('CALL_RPC', JSON.stringify(callRes.data, null, 2));

  const afterCall = await supabase.from('tickets').select('*').eq('id', ticketId).single();
  if (afterCall.error) throw afterCall.error;
  console.log('AFTER_CALL', JSON.stringify(afterCall.data, null, 2));

  const publicView = await supabase.from('tickets').select('*').in('status', ['CALLING', 'IN_PROGRESS', 'COMPLETED', 'ABSENT']).order('called_at', { ascending: false }).limit(5);
  if (publicView.error) throw publicView.error;
  console.log('PUBLIC_VIEW', JSON.stringify(publicView.data, null, 2));

  const finalRes = await supabase.from('tickets').update({
    status: 'COMPLETED',
    station_id: null,
    completed_at: new Date().toISOString(),
  }).eq('id', ticketId).select().single();
  if (finalRes.error) throw finalRes.error;
  console.log('FINALIZED', JSON.stringify(finalRes.data, null, 2));
})();
