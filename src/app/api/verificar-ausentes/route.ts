import { supabase } from '@/lib/supabaseClient';

const TIMEOUT_SEGUNDOS = 90;

export async function GET() {
  const limite = new Date(Date.now() - TIMEOUT_SEGUNDOS * 1000).toISOString();

  const { data, error } = await supabase
    .from('tickets')
    .update({ status: 'ABSENT', station_id: null })
    .eq('status', 'CALLING')
    .lt('called_at', limite)
    .select();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ marcadosAusentes: data?.length ?? 0 });
}
