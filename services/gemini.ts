import { supabase } from '../supabase';

function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

interface QueryIntent {
  matchedDrivers: any[];
  ceps: string[];
  wantsRoutes: boolean;
  wantsCeps: boolean;
  wantsDrivers: boolean;
  wantsReasons: boolean;
  isSpecific: boolean;
}

function classifyQuery(query: string, drivers: any[]): QueryIntent {
  const nq = normalizeText(query);
  const cepMatches = query.match(/\b\d{5}[-]?\d{0,3}\b/g) || [];

  const matchedDrivers = drivers.filter(d => {
    const dn = normalizeText(d.name);
    if (nq.includes(dn)) return true;
    return d.name.split(' ').length > 1 && dn.split(' ').some((w: string) => w.length > 3 && nq.includes(w));
  });

  const wantsRoutes = /rota|route|grupo|vinculo|vincul/.test(nq);
  const wantsCeps = /cep|regiao|area|bairro|cidade|endereco/.test(nq) || cepMatches.length > 0;
  const wantsDrivers = /motorista|driver|ofensor|ranking|top|pior|melhor|desempenho|performance/.test(nq) || matchedDrivers.length > 0;
  const wantsReasons = /motivo|razao|reason|rejeic|rejeit|porque|por que/.test(nq);

  const isSpecific = matchedDrivers.length > 0 || cepMatches.length > 0;

  return { matchedDrivers, ceps: cepMatches, wantsRoutes, wantsCeps, wantsDrivers, wantsReasons, isSpecific };
}

async function buildContext(userQuery: string): Promise<string> {
  const parts: string[] = [];

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

  const intent = classifyQuery(userQuery, drivers);

  const metaMap = new Map<string, string>();
  metaRows.forEach((m: any) => metaMap.set(m.key, m.value));
  if (metaMap.has('reference_date')) parts.push(`PERÍODO: ${metaMap.get('reference_date')}`);

  const faturados = tickets.filter(t => t.status === 'ForBilling');
  const revertidos = tickets.filter(t => t.status === 'Reversed');
  parts.push(`TOTAL: ${tickets.length} tickets | Faturados: ${faturados.length} (R$ ${faturados.reduce((s, t) => s + (t.pnr_value || 0), 0).toFixed(2)}) | Revertidos: ${revertidos.length} (R$ ${revertidos.reduce((s, t) => s + (t.pnr_value || 0), 0).toFixed(2)})`);

  const driverStats = new Map<string, { total: number; rev: number; val: number; revVal: number; ceps: Set<string>; reasons: Map<string, number> }>();
  tickets.forEach(t => {
    const d = t.driver || 'Desconhecido';
    const s = driverStats.get(d) || { total: 0, rev: 0, val: 0, revVal: 0, ceps: new Set<string>(), reasons: new Map<string, number>() };
    s.total++;
    s.val += (t.pnr_value || 0);
    if (t.cep) s.ceps.add(t.cep);
    if (t.status === 'Reversed') {
      s.rev++;
      s.revVal += (t.pnr_value || 0);
      const r = t.rejection_reason || t.rejectionReason || 'Sem motivo';
      s.reasons.set(r, (s.reasons.get(r) || 0) + 1);
    }
    driverStats.set(d, s);
  });

  if (intent.matchedDrivers.length > 0) {
    parts.push(`\nDETALHES DOS MOTORISTAS MENCIONADOS:`);
    intent.matchedDrivers.forEach(d => {
      const stats = driverStats.get(d.name);
      const driverLinks = links.filter(l => l.driver_id === d.id);
      const linkedRoutes = driverLinks.map(l => routes.find(r => r.id === l.route_id)?.name || '?').join(', ');
      parts.push(`- ${d.name} | Rota fixa: ${d.fixed_route || '-'} | Rotas: ${linkedRoutes || '-'} | Ativo: ${d.is_active ? 'sim' : 'não'}`);
      if (stats) {
        const pct = stats.total > 0 ? ((stats.rev / stats.total) * 100).toFixed(0) : '0';
        parts.push(`  ${stats.total} tickets, ${stats.rev} rev (${pct}%), R$ ${stats.revVal.toFixed(2)} revertido, R$ ${stats.val.toFixed(2)} total`);
        if (stats.reasons.size > 0) {
          const topReasons = [...stats.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
          parts.push(`  Motivos: ${topReasons.map(([r, c]) => `${r} (${c}x)`).join(', ')}`);
        }
        if (stats.ceps.size > 0) {
          parts.push(`  CEPs: ${[...stats.ceps].slice(0, 5).join(', ')}${stats.ceps.size > 5 ? ` (+${stats.ceps.size - 5})` : ''}`);
        }
      }
    });

    if (!intent.wantsDrivers) {
      parts.push(`\nMOTORISTAS: ${drivers.length} cadastrados, ${drivers.filter(d => d.is_active).length} ativos`);
      return parts.join('\n');
    }
  }

  if (intent.ceps.length > 0) {
    parts.push(`\nCEPs SOLICITADOS:`);
    intent.ceps.forEach(cep => {
      const prefix = cep.replace('-', '');
      const cepTickets = tickets.filter(t => (t.cep || '').startsWith(prefix));
      const cepRev = cepTickets.filter(t => t.status === 'Reversed');
      parts.push(`- CEP ${cep}: ${cepTickets.length} tickets, ${cepRev.length} revertidos`);
      const cepDrivers = new Map<string, number>();
      cepRev.forEach(t => cepDrivers.set(t.driver || '?', (cepDrivers.get(t.driver || '?') || 0) + 1));
      if (cepDrivers.size > 0) {
        const topD = [...cepDrivers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        parts.push(`  Motoristas com reversões: ${topD.map(([n, c]) => `${n} (${c}x)`).join(', ')}`);
      }
    });

    if (!intent.wantsDrivers && !intent.wantsRoutes) {
      parts.push(`\nMOTORISTAS: ${drivers.length} | ROTAS: ${routes.length}`);
      return parts.join('\n');
    }
  }

  if (intent.wantsDrivers || !intent.isSpecific) {
    const sortedDriverStats = [...driverStats.entries()].sort((a, b) => b[1].rev - a[1].rev);
    const limit = intent.isSpecific ? 5 : 10;
    parts.push(`\nTOP ${limit} MOTORISTAS POR REVERSÕES:`);
    sortedDriverStats.slice(0, limit).forEach(([name, s]) => {
      const pct = s.total > 0 ? ((s.rev / s.total) * 100).toFixed(0) : '0';
      parts.push(`- ${name}: ${s.total} tix, ${s.rev} rev (${pct}%), R$ ${s.revVal.toFixed(2)}`);
    });
  }

  if (intent.wantsCeps || !intent.isSpecific) {
    const cepStats = new Map<string, { total: number; rev: number }>();
    tickets.forEach(t => {
      const cep = t.cep || 'sem-cep';
      const s = cepStats.get(cep) || { total: 0, rev: 0 };
      s.total++;
      if (t.status === 'Reversed') s.rev++;
      cepStats.set(cep, s);
    });
    const limit = intent.isSpecific ? 5 : 8;
    parts.push(`\nTOP ${limit} CEPs PROBLEMÁTICOS:`);
    [...cepStats.entries()].sort((a, b) => b[1].rev - a[1].rev).slice(0, limit).forEach(([cep, s]) => {
      parts.push(`- ${cep}: ${s.total} tix, ${s.rev} rev`);
    });
  }

  if (intent.wantsReasons || !intent.isSpecific) {
    const reasons = new Map<string, number>();
    revertidos.forEach(t => {
      const r = t.rejection_reason || t.rejectionReason || 'Sem motivo';
      reasons.set(r, (reasons.get(r) || 0) + 1);
    });
    parts.push(`\nMOTIVOS DE REVERSÃO:`);
    [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([reason, count]) => {
      parts.push(`- ${reason}: ${count}x`);
    });
  }

  if (intent.wantsRoutes) {
    const sortedRoutes = routes
      .map(r => {
        const routeTickets = tickets.filter(t => {
          const routeCeps = r.ceps || [];
          return routeCeps.some((rc: string) => (t.cep || '').startsWith(rc));
        });
        const routeRev = routeTickets.filter(t => t.status === 'Reversed').length;
        return { ...r, ticketCount: routeTickets.length, revCount: routeRev };
      })
      .sort((a, b) => b.revCount - a.revCount);

    parts.push(`\nROTAS (top 10 por reversões):`);
    sortedRoutes.slice(0, 10).forEach(r => {
      const driverCount = links.filter(l => l.route_id === r.id).length;
      parts.push(`- ${r.name} | Grupo: ${r.route_group || '-'} | ${driverCount} mot | ${r.ticketCount} tix, ${r.revCount} rev`);
    });
  }

  parts.push(`\nRESUMO: ${drivers.length} motoristas (${drivers.filter(d => d.is_active).length} ativos) | ${routes.length} rotas | ${links.length} vínculos`);

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
