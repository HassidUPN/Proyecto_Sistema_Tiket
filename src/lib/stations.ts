import { supabase } from '@/lib/supabaseClient';

export async function inicializarEstaciones(n: number, m: number) {
  const cajas = Array.from({ length: n }, (_, i) => ({
    station_type: 'CAJA' as const,
    label: String(i + 1),
    active: true,
  }));

  const cubiculos = Array.from({ length: m }, (_, i) => ({
    station_type: 'CUBICULO' as const,
    label: String.fromCharCode(65 + i),
    active: true,
  }));

  const { data, error } = await supabase.from('stations').insert([...cajas, ...cubiculos]).select();

  if (error) throw error;
  return data;
}

export async function toggleStation(stationId: string, active: boolean) {
  const { data, error } = await supabase.from('stations').update({ active }).eq('id', stationId).select();

  if (error) throw error;
  return data;
}
