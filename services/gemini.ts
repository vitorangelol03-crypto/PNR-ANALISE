import { supabase } from '../supabase';

async function buildContext(): Promise<string> {
  const parts: string[] = [];

  const [ticketsRes, driversRes, routesRes, linksRes, routeMapRes, metaRes, cityCacheRes] = await Promise.all([
    supabase.from('tickets').select('*').limit(2000),
    supabase.from('drivers').select('*').eq('is_excluded', false).order('name'),
    supabase.from('routes').select('*').order('name'),
    supabase.from('driver_route_links').select('*'),
    supabase.from('route_mapping').select('*'),
    supabase.from('dashboard_meta').select('*').limit(1),
    supabase.from('city_cache').select('*'),
  ]);

  const tickets = ticketsRes.data || [];
  const drivers = driversRes.data || [];
  const routes = routesRes.data || [];
  const links = linksRes.data || [];
  const routeMap = routeMapRes.data || [];
  const meta = metaRes.data?.[0] || null;
  const cityCache = cityCacheRes.data || [];

  if (meta) {
    parts.push(`DATA DE REFERÊNCIA: ${meta.reference_date || 'não definida'}`);
    parts.push(`ÚLTIMA ATUALIZAÇÃO: ${meta.last_updated || 'não definida'}`);
  }

  parts.push(`\nRESUMO GERAL:`);
  parts.push(`Total de tickets: ${tickets.length}`);
  const faturados = tickets.filter(t => t.status === 'ForBilling');
  const revertidos = tickets.filter(t => t.status === 'Reversed');
  parts.push(`Faturados: ${faturados.length} (R$ ${faturados.reduce((s, t) => s + (t.pnr_value || t.pnrValue || 0), 0).toFixed(2)})`);
  parts.push(`Revertidos: ${revertidos.length} (R$ ${revertidos.reduce((s, t) => s + (t.pnr_value || t.pnrValue || 0), 0).toFixed(2)})`);

  if (tickets.length > 0) {
    const driverStats = new Map<string, { total: number; rev: number; val: number; revVal: number }>();
    tickets.forEach(t => {
      const d = t.driver || 'Desconhecido';
      const s = driverStats.get(d) || { total: 0, rev: 0, val: 0, revVal: 0 };
      s.total++;
      s.val += (t.pnr_value || t.pnrValue || 0);
      if (t.status === 'Reversed') {
        s.rev++;
        s.revVal += (t.pnr_value || t.pnrValue || 0);
      }
      driverStats.set(d, s);
    });

    parts.push(`\nESTATÍSTICAS POR MOTORISTA:`);
    const sortedDrivers = [...driverStats.entries()].sort((a, b) => b[1].rev - a[1].rev);
    sortedDrivers.slice(0, 30).forEach(([name, s]) => {
      parts.push(`- ${name}: ${s.total} tickets, ${s.rev} revertidos (R$ ${s.revVal.toFixed(2)}), total R$ ${s.val.toFixed(2)}`);
    });

    const cepStats = new Map<string, { total: number; rev: number }>();
    tickets.forEach(t => {
      const cep = t.cep || 'sem-cep';
      const s = cepStats.get(cep) || { total: 0, rev: 0 };
      s.total++;
      if (t.status === 'Reversed') s.rev++;
      cepStats.set(cep, s);
    });
    parts.push(`\nCEPs COM MAIS REVERSÕES:`);
    [...cepStats.entries()].sort((a, b) => b[1].rev - a[1].rev).slice(0, 15).forEach(([cep, s]) => {
      parts.push(`- CEP ${cep}: ${s.total} tickets, ${s.rev} revertidos`);
    });

    const reasons = new Map<string, number>();
    revertidos.forEach(t => {
      const r = t.rejection_reason || t.rejectionReason || 'Sem motivo';
      reasons.set(r, (reasons.get(r) || 0) + 1);
    });
    parts.push(`\nMOTIVOS DE REVERSÃO:`);
    [...reasons.entries()].sort((a, b) => b[1] - a[1]).forEach(([reason, count]) => {
      parts.push(`- ${reason}: ${count} ocorrências`);
    });
  }

  if (drivers.length > 0) {
    parts.push(`\nMOTORISTAS CADASTRADOS (${drivers.length}):`);
    drivers.forEach(d => {
      const driverLinks = links.filter(l => l.driver_id === d.id);
      const linkedRoutes = driverLinks.map(l => {
        const route = routes.find(r => r.id === l.route_id);
        return route?.name || 'desconhecida';
      });
      parts.push(`- ${d.name} | Rota fixa: ${d.fixed_route || 'nenhuma'} | Ativo: ${d.is_active ? 'sim' : 'não'} | Rotas vinculadas: ${linkedRoutes.join(', ') || 'nenhuma'}`);
    });
  }

  if (routes.length > 0) {
    parts.push(`\nROTAS (${routes.length}):`);
    routes.forEach(r => {
      const routeLinks = links.filter(l => l.route_id === r.id);
      const routeDrivers = routeLinks.map(l => {
        const driver = drivers.find(d => d.id === l.driver_id);
        return driver?.name || 'desconhecido';
      });
      parts.push(`- ${r.name} | Grupo: ${r.route_group || 'sem grupo'} | CEPs: ${(r.ceps || []).join(', ') || 'nenhum'} | Motoristas: ${routeDrivers.join(', ') || 'nenhum'}`);
    });
  }

  if (routeMap.length > 0) {
    parts.push(`\nMAPEAMENTO CEP→ROTA (${routeMap.length} entradas):`);
    routeMap.slice(0, 30).forEach(m => {
      parts.push(`- CEP ${m.cep_prefix}: ${m.route_name}`);
    });
  }

  if (cityCache.length > 0) {
    parts.push(`\nCACHE DE CIDADES (${cityCache.length} entradas):`);
    cityCache.slice(0, 30).forEach(c => {
      parts.push(`- CEP ${c.cep}: ${c.city || 'desconhecida'}, ${c.state || ''}`);
    });
  }

  return parts.join('\n');
}

export async function queryGemini(userQuery: string): Promise<{ response: string; resultsCount: number }> {
  const context = await buildContext();

  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: userQuery, context }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro de conexão com o servidor.' }));
    throw new Error(err.error || `Erro ${res.status}`);
  }

  return res.json();
}

export async function saveToSearchHistory(query: string, resultsCount: number): Promise<void> {
  await supabase.from('search_history').insert({
    query,
    results_count: resultsCount,
    source: 'ai_assistant',
    created_at: new Date().toISOString(),
  });
}

export async function saveAIReport(query: string, response: string): Promise<boolean> {
  const title = query.length > 80 ? query.substring(0, 80) + '...' : query;
  const { error } = await supabase.from('ai_reports').insert({
    title,
    user_prompt: query,
    ai_response: response,
    created_at: new Date().toISOString(),
  });
  return !error;
}

export async function getRecentSearches(limit = 20) {
  const { data } = await supabase
    .from('search_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function getFrequentSearches(limit = 5) {
  const { data } = await supabase
    .from('search_history')
    .select('query');
  if (!data) return [];

  const counts = new Map<string, number>();
  const original = new Map<string, string>();
  data.forEach(row => {
    const key = row.query.trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!original.has(key)) original.set(key, row.query.trim());
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ query: original.get(key) || key, count }));
}

export async function clearSearchHistory(): Promise<void> {
  await supabase.from('search_history').delete().gte('created_at', '1970-01-01');
}

export async function getAutocompleteSuggestions(input: string) {
  if (!input.trim()) return [];
  const { data } = await supabase
    .from('search_history')
    .select('query')
    .ilike('query', `%${input}%`)
    .order('created_at', { ascending: false })
    .limit(10);
  if (!data) return [];

  const seen = new Set<string>();
  return data
    .map(r => r.query)
    .filter(q => {
      const key = q.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}
