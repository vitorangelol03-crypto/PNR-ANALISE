import { supabase } from '../supabase';

function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function detectQueryIntent(query: string): { drivers: string[]; ceps: string[]; isGeneral: boolean } {
  const normalized = normalizeText(query);
  const drivers: string[] = [];
  const ceps: string[] = [];

  const cepMatches = query.match(/\b\d{5}[-]?\d{0,3}\b/g);
  if (cepMatches) ceps.push(...cepMatches);

  const isGeneral = !cepMatches || cepMatches.length === 0;
  return { drivers, ceps, isGeneral };
}

async function buildContext(userQuery: string): Promise<string> {
  const parts: string[] = [];
  const intent = detectQueryIntent(userQuery);
  const normalizedQuery = normalizeText(userQuery);

  const [ticketsRes, driversRes, routesRes, linksRes, metaRes] = await Promise.all([
    supabase.from('tickets').select('*').limit(2000),
    supabase.from('drivers').select('*').eq('is_excluded', false).order('name'),
    supabase.from('routes').select('*').order('name'),
    supabase.from('driver_route_links').select('*'),
    supabase.from('dashboard_meta').select('*').limit(5),
  ]);

  const tickets = ticketsRes.data || [];
  const drivers = driversRes.data || [];
  const routes = routesRes.data || [];
  const links = linksRes.data || [];
  const metaRows = metaRes.data || [];

  const metaMap = new Map<string, string>();
  metaRows.forEach((m: any) => metaMap.set(m.key, m.value));
  if (metaMap.has('reference_date')) {
    parts.push(`PERÍODO: ${metaMap.get('reference_date')}`);
  }

  const faturados = tickets.filter(t => t.status === 'ForBilling');
  const revertidos = tickets.filter(t => t.status === 'Reversed');
  parts.push(`TOTAL: ${tickets.length} tickets | Faturados: ${faturados.length} (R$ ${faturados.reduce((s, t) => s + (t.pnr_value || 0), 0).toFixed(2)}) | Revertidos: ${revertidos.length} (R$ ${revertidos.reduce((s, t) => s + (t.pnr_value || 0), 0).toFixed(2)})`);

  const driverStats = new Map<string, { total: number; rev: number; val: number; revVal: number }>();
  tickets.forEach(t => {
    const d = t.driver || 'Desconhecido';
    const s = driverStats.get(d) || { total: 0, rev: 0, val: 0, revVal: 0 };
    s.total++;
    s.val += (t.pnr_value || 0);
    if (t.status === 'Reversed') { s.rev++; s.revVal += (t.pnr_value || 0); }
    driverStats.set(d, s);
  });

  const matchedDriverNames = drivers.filter(d =>
    normalizedQuery.includes(normalizeText(d.name)) ||
    (d.name.split(' ').length > 1 && normalizeText(d.name).split(' ').some((word: string) =>
      word.length > 3 && normalizedQuery.includes(word)
    ))
  );

  if (matchedDriverNames.length > 0) {
    parts.push(`\nMOTORISTAS MENCIONADOS NA PERGUNTA:`);
    matchedDriverNames.forEach(d => {
      const stats = driverStats.get(d.name);
      const driverLinks = links.filter(l => l.driver_id === d.id);
      const linkedRoutes = driverLinks.map(l => routes.find(r => r.id === l.route_id)?.name || '?').join(', ');
      parts.push(`- ${d.name} | Rota fixa: ${d.fixed_route || '-'} | Rotas: ${linkedRoutes || '-'} | Ativo: ${d.is_active ? 'sim' : 'não'}`);
      if (stats) {
        parts.push(`  → ${stats.total} tickets, ${stats.rev} revertidos (R$ ${stats.revVal.toFixed(2)}), total R$ ${stats.val.toFixed(2)}`);
      }
    });
  }

  const sortedDriverStats = [...driverStats.entries()].sort((a, b) => b[1].rev - a[1].rev);
  parts.push(`\nTOP 15 MOTORISTAS POR REVERSÕES:`);
  sortedDriverStats.slice(0, 15).forEach(([name, s]) => {
    const pct = s.total > 0 ? ((s.rev / s.total) * 100).toFixed(0) : '0';
    parts.push(`- ${name}: ${s.total} tickets, ${s.rev} rev (${pct}%), R$ ${s.revVal.toFixed(2)}`);
  });

  if (intent.ceps.length > 0) {
    parts.push(`\nCEPs DA PERGUNTA:`);
    intent.ceps.forEach(cep => {
      const cepTickets = tickets.filter(t => (t.cep || '').startsWith(cep.replace('-', '')));
      const cepRev = cepTickets.filter(t => t.status === 'Reversed');
      parts.push(`- CEP ${cep}: ${cepTickets.length} tickets, ${cepRev.length} revertidos`);
    });
  }

  const cepStats = new Map<string, { total: number; rev: number }>();
  tickets.forEach(t => {
    const cep = t.cep || 'sem-cep';
    const s = cepStats.get(cep) || { total: 0, rev: 0 };
    s.total++;
    if (t.status === 'Reversed') s.rev++;
    cepStats.set(cep, s);
  });
  parts.push(`\nTOP 10 CEPs PROBLEMÁTICOS:`);
  [...cepStats.entries()].sort((a, b) => b[1].rev - a[1].rev).slice(0, 10).forEach(([cep, s]) => {
    parts.push(`- ${cep}: ${s.total} tickets, ${s.rev} rev`);
  });

  const reasons = new Map<string, number>();
  revertidos.forEach(t => {
    const r = t.rejection_reason || t.rejectionReason || 'Sem motivo';
    reasons.set(r, (reasons.get(r) || 0) + 1);
  });
  parts.push(`\nMOTIVOS DE REVERSÃO:`);
  [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([reason, count]) => {
    parts.push(`- ${reason}: ${count}x`);
  });

  if (normalizedQuery.includes('rota') || normalizedQuery.includes('route') || normalizedQuery.includes('grupo')) {
    parts.push(`\nROTAS (${routes.length}):`);
    routes.forEach(r => {
      const routeDriverCount = links.filter(l => l.route_id === r.id).length;
      parts.push(`- ${r.name} | Grupo: ${r.route_group || '-'} | ${routeDriverCount} motoristas`);
    });
  }

  parts.push(`\nMOTORISTAS: ${drivers.length} cadastrados, ${drivers.filter(d => d.is_active).length} ativos`);
  parts.push(`ROTAS: ${routes.length} | VÍNCULOS: ${links.length}`);

  return parts.join('\n');
}

export async function queryGeminiStream(
  userQuery: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const context = await buildContext(userQuery);

  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: userQuery, context }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro de conexão com o servidor.' }));
    throw new Error(err.error || `Erro ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Streaming não suportado.');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.done) {
            onDone();
            return;
          }
          if (data.error) {
            onError(data.error);
            return;
          }
          if (data.text) {
            onChunk(data.text);
          }
        } catch {}
      }
    }
  }

  onDone();
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
