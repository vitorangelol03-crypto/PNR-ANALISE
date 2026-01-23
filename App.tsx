
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { supabase } from './supabase';
import { TicketStatus, IHSTicket, DriverStats, RouteStats } from './types';
import { formatCurrency, formatDate, translateStatus, debounce } from './utils';

type SortKey = 'performance' | 'totalTickets' | 'totalValue' | 'revertidos' | 'faturadosValue' | 'name';

interface DriverOverride {
  route: string;
  isExcluded: boolean;
}

const App: React.FC = () => {
  const [allData, setAllData] = useState<IHSTicket[]>([]);
  const [routeMap, setRouteMap] = useState<Record<string, string>>({});
  const [cityCache, setCityCache] = useState<Record<string, string>>({});
  const [driverOverrides, setDriverOverrides] = useState<Record<string, DriverOverride>>({});
  const [referenceDate, setReferenceDate] = useState<string>('');

  // Segurança
  const [isAdmin, setIsAdmin] = useState<boolean>(() => sessionStorage.getItem('ihs_admin') === 'true');
  const [showPassModal, setShowPassModal] = useState(false);
  const [passInput, setPassInput] = useState('');
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const [isLoadingSupabase, setIsLoadingSupabase] = useState(true);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isFetchingCities, setIsFetchingCities] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDriverMgmtModal, setShowDriverMgmtModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  
  const [tempTickets, setTempTickets] = useState<IHSTicket[]>([]);
  const [inputRefDate, setInputRefDate] = useState<string>('');

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [performanceSearch, setPerformanceSearch] = useState<string>('');
  const [mgmtSearch, setMgmtSearch] = useState<string>('');
  const [routeSearch, setRouteSearch] = useState<string>('');
  
  const [selectedRouteFilter, setSelectedRouteFilter] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  
  const [driverSortKey, setDriverSortKey] = useState<SortKey>('performance');
  const [driverSortOrder, setDriverSortOrder] = useState<'asc' | 'desc'>('desc');

  // Carregar dados iniciais do Supabase
  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoadingSupabase(true);
      try {
        const { data: mappingData } = await supabase.from('route_mapping').select('spxtn, cep');
        const { data: cacheData } = await supabase.from('city_cache').select('cep, city_info');
        const { data: overrideData } = await supabase.from('driver_overrides').select('driver_name, overridden_route, is_excluded');
        const { data: metaData } = await supabase.from('dashboard_meta').select('key, value');
        
        const refDate = metaData?.find(m => m.key === 'reference_date')?.value;
        if (refDate) setReferenceDate(refDate);

        const { data: ticketData } = await supabase.from('tickets').select('*');

        if (mappingData) {
          const m: Record<string, string> = {};
          mappingData.forEach(row => m[row.spxtn] = row.cep);
          setRouteMap(m);
        }

        if (cacheData) {
          const c: Record<string, string> = {};
          cacheData.forEach(row => c[row.cep] = row.city_info);
          setCityCache(c);
        }

        if (overrideData) {
          const o: Record<string, DriverOverride> = {};
          overrideData.forEach(row => {
            o[row.driver_name] = { 
              route: row.overridden_route || "", 
              isExcluded: !!row.is_excluded 
            };
          });
          setDriverOverrides(o);
        }

        if (ticketData) {
          setAllData(ticketData.map(t => ({
            ticketId: t.ticket_id,
            taskId: t.task_id,
            spxtn: t.spxtn,
            driver: t.driver,
            station: t.station,
            slaDeadline: t.sla_deadline,
            assignee: t.assignee,
            pnrValue: t.pnr_value,
            // Fix: Map rejection_reason from Supabase to camelCase property
            rejectionReason: t.rejection_reason,
            createdTime: t.created_time,
            status: t.status as TicketStatus
          })));
        }
      } catch (err) {
        console.error("Erro ao carregar dados do Supabase:", err);
      } finally {
        setIsLoadingSupabase(false);
      }
    };
    loadInitialData();
  }, []);

  const handleAuth = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (passInput === '684171') {
      setIsAdmin(true);
      sessionStorage.setItem('ihs_admin', 'true');
      setShowPassModal(false);
      setPassInput('');
      if (pendingAction) {
        pendingAction();
        setPendingAction(null);
      }
    } else {
      alert('Senha incorreta!');
      setPassInput('');
    }
  };

  const withAdmin = (action: () => void) => {
    if (isAdmin) {
      action();
    } else {
      setPendingAction(() => action);
      setShowPassModal(true);
    }
  };

  const fetchCityInfo = async (cep: string) => {
    const cleanCep = cep.replace(/\D/g, '');
    if (cleanCep.length !== 8) return null;
    if (cityCache[cleanCep]) return cityCache[cleanCep];

    try {
      const response = await fetch(`https://brasilapi.com.br/api/cep/v1/${cleanCep}`);
      if (response.ok) {
        const data = await response.json();
        const info = `${data.city}, ${data.state}`;
        await supabase.from('city_cache').upsert({ cep: cleanCep, city_info: info });
        return info;
      }
    } catch (e) {
      console.error("Erro ao buscar CEP:", cleanCep);
    }
    return null;
  };

  useEffect(() => {
    const enrichCeps = async () => {
      const uniqueCeps = Array.from(new Set(Object.values(routeMap)));
      const missingCeps = uniqueCeps.filter(cep => cep && !cityCache[cep.replace(/\D/g, '')]);

      if (missingCeps.length > 0) {
        setIsFetchingCities(true);
        const newCache = { ...cityCache };
        let hasNewData = false;
        
        for (const cep of missingCeps) {
          const clean = cep.replace(/\D/g, '');
          if (clean.length === 8) {
            const info = await fetchCityInfo(clean);
            if (info) {
              newCache[clean] = info;
              hasNewData = true;
            }
            await new Promise(r => setTimeout(r, 200));
          }
        }
        
        if (hasNewData) setCityCache(newCache);
        setIsFetchingCities(false);
      }
    };
    if (Object.keys(routeMap).length > 0) enrichCeps();
  }, [routeMap]);

  const saveDriverOverride = async (driverName: string, updates: Partial<DriverOverride>) => {
    try {
      const current = driverOverrides[driverName] || { route: "", isExcluded: false };
      const merged = { ...current, ...updates };

      if (merged.route === "" && !merged.isExcluded) {
        await supabase.from('driver_overrides').delete().eq('driver_name', driverName);
        const newOverrides = { ...driverOverrides };
        delete newOverrides[driverName];
        setDriverOverrides(newOverrides);
      } else {
        await supabase.from('driver_overrides').upsert({ 
          driver_name: driverName, 
          overridden_route: merged.route, 
          is_excluded: merged.isExcluded 
        });
        setDriverOverrides(prev => ({ ...prev, [driverName]: merged }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const clearAllTickets = async () => {
    if (!confirm("Isso apagará TODOS os tickets do sistema e da nuvem. Deseja continuar?")) return;
    setIsDeleting(true);
    try {
      await supabase.from('tickets').delete().neq('ticket_id', '0_ignore');
      await supabase.from('dashboard_meta').delete().eq('key', 'reference_date');
      setAllData([]);
      setReferenceDate('');
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  const confirmClearDatabase = async () => {
    setIsDeleting(true);
    try {
      const { error } = await supabase.from('route_mapping').delete().neq('spxtn', '0_ignore');
      if (!error) {
        setRouteMap({});
        location.reload();
      } else {
        alert("Erro ao apagar dados do banco.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    const extension = file.name.split('.').pop()?.toLowerCase();
    
    const parseRows = (rows: any[][]) => {
      const dataRows = (rows[0]?.[0]?.toString().toLowerCase().includes('id')) ? rows.slice(1) : rows;
      const processed: IHSTicket[] = dataRows.map((row) => ({
        ticketId: String(row[0] || ''),
        taskId: String(row[1] || ''),
        spxtn: String(row[2] || '').trim(),
        driver: String(row[3] || 'Desconhecido').replace(/\d+/g, '').replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim(),
        station: String(row[4] || ''),
        slaDeadline: String(row[5] || ''),
        assignee: String(row[6] || ''),
        pnrValue: parseFloat(String(row[7] || '0').replace(',', '.').replace('R$', '').trim()) || 0,
        rejectionReason: String(row[8] || ''),
        createdTime: String(row[9] || ''),
        status: String(row[10]).toLowerCase().includes('billing') ? TicketStatus.ForBilling : TicketStatus.Reversed,
      }));
      setTempTickets(processed);
      setShowImportModal(true);
      event.target.value = ""; 
    };

    if (extension === 'csv') {
      Papa.parse(file, { complete: (res) => parseRows(res.data as any[][]), header: false, skipEmptyLines: true });
    } else {
      reader.onload = (e) => {
        const wb = XLSX.read(e.target?.result, { type: 'binary' });
        parseRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][]);
      };
      reader.readAsBinaryString(file);
    }
  };

  // Fix: Implemented missing handleRouteFileUpload for route mapping synchronization
  const handleRouteFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    const extension = file.name.split('.').pop()?.toLowerCase();

    const parseRows = async (rows: any[][]) => {
      setIsProcessingFile(true);
      try {
        const dataRows = rows.filter(r => r.length >= 2);
        const newMapping: Record<string, string> = {};
        const upsertData: { spxtn: string, cep: string }[] = [];

        dataRows.forEach(row => {
          const spxtn = String(row[0] || '').trim();
          const cep = String(row[1] || '').trim().replace(/\D/g, '');
          if (spxtn && cep) {
            newMapping[spxtn] = cep;
            upsertData.push({ spxtn, cep });
          }
        });

        if (upsertData.length > 0) {
          const { error } = await supabase.from('route_mapping').upsert(upsertData, { onConflict: 'spxtn' });
          if (error) throw error;
          
          setRouteMap(prev => ({ ...prev, ...newMapping }));
          alert("Mapeamento de rotas atualizado com sucesso!");
        }
      } catch (err) {
        console.error("Erro ao importar rotas:", err);
        alert("Erro ao importar rotas.");
      } finally {
        setIsProcessingFile(false);
        if (event.target) event.target.value = "";
      }
    };

    if (extension === 'csv') {
      Papa.parse(file, { complete: (res) => parseRows(res.data as any[][]), header: false, skipEmptyLines: true });
    } else {
      reader.onload = (e) => {
        const wb = XLSX.read(e.target?.result, { type: 'binary' });
        parseRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][]);
      };
      reader.readAsBinaryString(file);
    }
  };

  const confirmImport = async () => {
    if (!inputRefDate) {
      alert("Por favor, informe a data de referência.");
      return;
    }
    setIsProcessingFile(true);
    try {
      await supabase.from('tickets').delete().neq('ticket_id', '0_ignore');
      await supabase.from('dashboard_meta').upsert({ key: 'reference_date', value: inputRefDate });
      
      const chunkSize = 1000;
      for (let i = 0; i < tempTickets.length; i += chunkSize) {
        const chunk = tempTickets.slice(i, i + chunkSize).map(t => ({
          ticket_id: t.ticketId,
          task_id: t.taskId,
          spxtn: t.spxtn,
          driver: t.driver,
          station: t.station,
          sla_deadline: t.slaDeadline,
          assignee: t.assignee,
          pnr_value: t.pnrValue,
          rejection_reason: t.rejectionReason,
          created_time: t.createdTime,
          status: t.status
        }));
        await supabase.from('tickets').insert(chunk);
      }

      setAllData(tempTickets);
      setReferenceDate(inputRefDate);
      setShowImportModal(false);
      alert("Importação concluída e salva na nuvem!");
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar dados.");
    } finally {
      setIsProcessingFile(false);
    }
  };

  const stats = useMemo(() => {
    const dMap: Record<string, DriverStats> = {};
    const rMap: Record<string, RouteStats> = {};
    
    // Filtrar motoristas excluídos da contagem
    const activeData = allData.filter(item => !driverOverrides[item.driver]?.isExcluded);

    const filteredBySearch = activeData.filter(item => {
      const matchSearch = item.driver.toLowerCase().includes(searchTerm.toLowerCase()) || item.ticketId.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = selectedStatus === 'All' || item.status === selectedStatus;
      return matchSearch && matchStatus;
    });

    filteredBySearch.forEach(item => {
      const rawRoute = driverOverrides[item.driver]?.route || (() => {
        const rawCep = routeMap[item.spxtn] || 'Não Mapeado';
        return cityCache[rawCep] || (rawCep === 'Não Mapeado' ? 'Não Mapeado' : `CEP ${rawCep}`);
      })();
      
      const city = rawRoute;
      
      if (!rMap[city]) rMap[city] = { cep: 'N/A', locationName: city, totalTickets: 0, faturados: 0, revertidos: 0, totalValue: 0, drivers: new Set() };
      rMap[city].totalTickets++;
      rMap[city].totalValue += item.pnrValue;
      rMap[city].drivers.add(item.driver);
      if (item.status === TicketStatus.ForBilling) rMap[city].faturados++; else rMap[city].revertidos++;
    });

    const finalFiltered = filteredBySearch.filter(item => {
      if (selectedRouteFilter === 'All') return true;
      const currentRoute = driverOverrides[item.driver]?.route || (() => {
        const rawCep = routeMap[item.spxtn] || 'Não Mapeado';
        return cityCache[rawCep] || (rawCep === 'Não Mapeado' ? 'Não Mapeado' : `CEP ${rawCep}`);
      })();
      return currentRoute === selectedRouteFilter;
    });

    finalFiltered.forEach(item => {
      if (!dMap[item.driver]) {
        dMap[item.driver] = { name: item.driver, totalTickets: 0, totalValue: 0, faturados: 0, faturadosValue: 0, revertidos: 0, revertidosValue: 0, routes: [] };
      }
      const d = dMap[item.driver];
      d.totalTickets++;
      d.totalValue += item.pnrValue;

      const currentRoute = driverOverrides[item.driver]?.route || (() => {
        const rawCep = routeMap[item.spxtn] || 'Não Mapeado';
        return cityCache[rawCep] || (rawCep === 'Não Mapeado' ? 'Não Mapeado' : `CEP ${rawCep}`);
      })();
      if (!d.routes?.includes(currentRoute)) d.routes?.push(currentRoute);

      if (item.status === TicketStatus.ForBilling) {
        d.faturados++;
        d.faturadosValue += item.pnrValue;
      } else {
        d.revertidos++;
        d.revertidosValue += item.pnrValue;
      }
    });

    return { 
      drivers: Object.values(dMap), 
      routes: Object.values(rMap), 
      filtered: finalFiltered 
    };
  }, [allData, routeMap, cityCache, searchTerm, selectedStatus, selectedRouteFilter, driverOverrides]);

  const totals = useMemo(() => ({
    total: stats.filtered.length,
    faturados: stats.filtered.filter(i => i.status === TicketStatus.ForBilling).length,
    revertidos: stats.filtered.filter(i => i.status === TicketStatus.Reversed).length,
    value: stats.filtered.reduce((acc, curr) => acc + curr.pnrValue, 0)
  }), [stats.filtered]);

  const insights = useMemo(() => {
    const relevantDrivers = stats.drivers.filter(d => d.totalTickets > 10);
    const relevantRoutes = stats.routes.filter(r => r.totalTickets > 10);
    const sortByPerf = (a: any, b: any) => (b.revertidos / b.totalTickets) - (a.revertidos / a.totalTickets);

    return { 
      topDrivers: [...relevantDrivers].sort(sortByPerf).slice(0, 4),
      bottomDrivers: [...relevantDrivers].sort((a, b) => sortByPerf(b, a)).slice(0, 4),
      topRoutes: [...relevantRoutes].sort(sortByPerf).slice(0, 4),
      bottomRoutes: [...relevantRoutes].sort((a, b) => sortByPerf(b, a)).slice(0, 4)
    };
  }, [stats]);

  const routeList = useMemo(() => Array.from(new Set(stats.routes.map(r => r.locationName))).sort(), [stats.routes]);

  const uniqueDriversFromData = useMemo(() => {
    const names = Array.from(new Set(allData.map(d => d.driver))).sort();
    return names.filter(n => n.toLowerCase().includes(mgmtSearch.toLowerCase()));
  }, [allData, mgmtSearch]);

  const filteredRouteStats = useMemo(() => 
    stats.routes.filter(r => r.locationName.toLowerCase().includes(routeSearch.toLowerCase()) || r.cep.includes(routeSearch))
    .sort((a, b) => b.totalTickets - a.totalTickets),
  [stats.routes, routeSearch]);

  const filteredPerformanceStats = useMemo(() => {
    let list = stats.drivers.filter(s => s.name.toLowerCase().includes(performanceSearch.toLowerCase()));
    list.sort((a, b) => {
      let valA: any = a[driverSortKey as keyof DriverStats];
      let valB: any = b[driverSortKey as keyof DriverStats];
      if (driverSortKey === 'performance') {
        valA = a.revertidos / (a.totalTickets || 1);
        valB = b.revertidos / (b.totalTickets || 1);
      }
      if (driverSortOrder === 'desc') return valB > valA ? 1 : -1;
      return valA > valB ? 1 : -1;
    });
    return list;
  }, [stats.drivers, performanceSearch, driverSortKey, driverSortOrder]);

  const toggleSort = (key: SortKey) => {
    if (driverSortKey === key) setDriverSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    else { setDriverSortKey(key); setDriverSortOrder('desc'); }
  };

  const handlePerformanceSearchChange = useCallback(debounce((v: string) => setPerformanceSearch(v), 300), []);

  const routeCount = Object.keys(routeMap).length;

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-8 space-y-6 text-[#374151]">
      {/* Modal de Senha */}
      {showPassModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-white rounded-3xl p-10 max-w-sm w-full shadow-2xl border border-gray-100 scale-in-center">
            <div className="text-5xl mb-6 text-center">🔒</div>
            <h2 className="text-2xl font-black text-center text-gray-800 uppercase tracking-tight">Área Restrita</h2>
            <p className="text-gray-400 text-sm text-center mt-2 font-medium">Digite a senha para desbloquear as funções de administrador.</p>
            <form onSubmit={handleAuth} className="mt-8 space-y-4">
              <input 
                autoFocus
                type="password" 
                placeholder="••••••" 
                value={passInput}
                onChange={(e) => setPassInput(e.target.value)}
                className="w-full px-5 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl text-2xl font-black text-center outline-none focus:border-blue-500 transition-all tracking-[0.5em]"
              />
              <div className="flex gap-2">
                <button 
                  type="submit"
                  className="flex-1 py-4 bg-[#1e3a8a] text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 active:scale-95 transition-all"
                >
                  Desbloquear
                </button>
                <button 
                  type="button"
                  onClick={() => { setShowPassModal(false); setPendingAction(null); setPassInput(''); }}
                  className="px-6 py-4 bg-gray-100 text-gray-500 rounded-2xl font-black text-xs uppercase transition-all"
                >
                  Sair
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Outros Modais (Tickets, Vínculos, etc) */}
      {showImportModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="bg-white rounded-3xl p-8 max-md w-full shadow-2xl border border-gray-100 scale-in-center">
            <div className="text-4xl mb-4 text-center">📅</div>
            <h2 className="text-xl font-black text-center text-gray-800 uppercase">Data de Referência</h2>
            <p className="text-gray-500 text-sm text-center mt-2">Informe a data que estes tickets representam.</p>
            <div className="mt-6 space-y-4">
              <input 
                type="text" 
                placeholder="Ex: 22/10/2023" 
                value={inputRefDate}
                onChange={(e) => setInputRefDate(e.target.value)}
                className="w-full px-5 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl text-lg font-bold text-center outline-none focus:border-blue-400 focus:bg-white transition-all"
              />
              <div className="flex gap-3 mt-4">
                <button 
                  onClick={confirmImport}
                  disabled={isProcessingFile}
                  className="flex-1 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 disabled:opacity-50 transition-all"
                >
                  {isProcessingFile ? 'SALVANDO...' : 'Salvar e Iniciar'}
                </button>
                <button onClick={() => setShowImportModal(false)} className="px-6 py-4 bg-gray-100 text-gray-600 rounded-2xl font-black text-xs uppercase transition-all">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDriverMgmtModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 max-w-3xl w-full shadow-2xl border border-gray-100 flex flex-col h-[85vh]">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-black text-gray-800 uppercase">Vínculos de Motoristas</h2>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-tighter">Gerenciar Rotas e Visibilidade</p>
              </div>
              <button onClick={() => setShowDriverMgmtModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-xl">✕</button>
            </div>
            <div className="mb-4">
              <input 
                type="text" 
                placeholder="🔍 Buscar motorista..." 
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                onChange={(e) => setMgmtSearch(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
              <div className="grid grid-cols-12 px-4 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                <div className="col-span-5">Motorista</div>
                <div className="col-span-4">Rota Fixa</div>
                <div className="col-span-3 text-center">Status</div>
              </div>
              {uniqueDriversFromData.map(name => {
                const override = driverOverrides[name] || { route: "", isExcluded: false };
                return (
                  <div key={name} className={`grid grid-cols-12 items-center gap-4 p-3 bg-gray-50 rounded-xl border border-gray-100 hover:border-blue-200 transition-all ${override.isExcluded ? 'opacity-60 bg-red-50/20' : ''}`}>
                    <div className="col-span-5">
                      <span className={`text-xs font-black uppercase truncate block ${override.isExcluded ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{name}</span>
                    </div>
                    <div className="col-span-4">
                      <select 
                        disabled={override.isExcluded}
                        value={override.route} 
                        onChange={(e) => saveDriverOverride(name, { route: e.target.value })}
                        className="w-full text-[10px] font-bold py-1.5 px-3 bg-white border border-gray-200 rounded-lg outline-none cursor-pointer focus:border-blue-400 disabled:opacity-50 disabled:bg-gray-100"
                      >
                        <option value="">Auto Detect</option>
                        {routeList.filter(r => r !== 'Não Mapeado').map(route => (
                          <option key={route} value={route}>{route}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3 flex justify-center">
                      <button 
                        onClick={() => saveDriverOverride(name, { isExcluded: !override.isExcluded })}
                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all shadow-sm ${override.isExcluded ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-emerald-500 text-white hover:bg-emerald-600'}`}
                      >
                        {override.isExcluded ? 'Oculto' : 'Ativo'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 pt-4 border-t border-gray-100 text-center">
              <button onClick={() => setShowDriverMgmtModal(false)} className="px-8 py-3 bg-[#1e3a8a] text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all">Concluir</button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-gray-100 scale-in-center">
            <div className="text-4xl mb-4 text-center">🗑️</div>
            <h2 className="text-xl font-black text-center text-gray-800 uppercase">Apagar Tudo?</h2>
            <p className="text-gray-500 text-sm text-center mt-3">Remover rotas permanentemente da nuvem.</p>
            <div className="flex flex-col gap-3 mt-8">
              <button onClick={confirmClearDatabase} disabled={isDeleting} className="w-full py-4 bg-red-600 text-white rounded-2xl font-black text-xs uppercase transition-all">{isDeleting ? 'APAGANDO...' : 'Apagar Definitivamente'}</button>
              <button onClick={() => setShowDeleteModal(false)} className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-black text-xs uppercase transition-all">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold text-[#1e3a8a] flex items-center gap-2">
            <span className="p-2 bg-blue-50 rounded-lg text-xl">🚀</span>
            IHS Dashboard Elite
          </h1>
          <div className="flex flex-col gap-0.5">
            <p className="text-gray-500 font-medium text-[10px] uppercase tracking-widest">Database Sync: Supabase Cloud</p>
            {referenceDate && (
              <p className="text-blue-600 font-black text-xs flex items-center gap-1.5 uppercase">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
                Referência: {referenceDate}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {allData.length > 0 && (
            <button 
              onClick={() => withAdmin(clearAllTickets)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs border transition-all active:scale-95 ${isAdmin ? 'bg-red-50 text-red-600 border-red-100' : 'bg-gray-50 text-gray-400 border-gray-200'}`}
            >
              {isAdmin ? '🗑️ Limpar Tickets' : '🔒 Limpar'}
            </button>
          )}
          <button 
            onClick={() => withAdmin(() => setShowDriverMgmtModal(true))}
            className="bg-gray-100 hover:bg-gray-200 text-[#1e3a8a] px-5 py-2.5 rounded-xl font-black flex items-center gap-2 text-xs shadow-sm transition-all active:scale-95 border border-gray-200"
          >
            {isAdmin ? '👤 Gerenciar Vínculos' : '🔒 Vínculos'}
          </button>
          <label className="cursor-pointer bg-[#3b82f6] hover:bg-[#2563eb] text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 text-xs shadow-md transition-all active:scale-95">
            {isAdmin ? '📥 Importar Tickets' : '🔒 Importar'}
            {isAdmin && <input type="file" className="hidden" accept=".csv, .xlsx, .xls" onChange={handleFileUpload} />}
            {!isAdmin && <button onClick={() => withAdmin(() => {})} className="absolute inset-0 opacity-0"></button>}
          </label>
          <div className="flex gap-1">
            <label className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-l-xl font-bold flex items-center gap-2 text-xs shadow-md transition-all active:scale-95 border-r border-emerald-500/30">
              {isAdmin ? '🗺️ Sincronizar Rotas' : '🔒 Rotas'}
              {isAdmin && <input type="file" className="hidden" accept=".csv, .xlsx, .xls" onChange={handleRouteFileUpload} />}
              {!isAdmin && <button onClick={() => withAdmin(() => {})} className="absolute inset-0 opacity-0"></button>}
            </label>
            {routeCount > 0 && (
              <button 
                onClick={() => withAdmin(() => setShowDeleteModal(true))}
                className="bg-red-500 hover:bg-red-600 text-white px-3 py-2.5 rounded-r-xl font-bold text-xs shadow-md transition-all"
              >
                {isAdmin ? '🗑️' : '🔒'}
              </button>
            )}
          </div>
          {isAdmin && (
            <button onClick={() => { setIsAdmin(false); sessionStorage.removeItem('ihs_admin'); }} className="p-2 text-gray-400 hover:text-red-500 transition-colors" title="Sair do modo Admin">🔓</button>
          )}
        </div>
      </header>

      {(isFetchingCities || isLoadingSupabase || isProcessingFile) && (
        <div className="bg-blue-600 text-white p-3 rounded-xl text-center text-xs font-black animate-pulse flex items-center justify-center gap-3">
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          {isLoadingSupabase ? 'SINCRONIZANDO COM SUPABASE...' : 
           isProcessingFile ? 'SALVANDO TICKETS NA NUVEM...' :
           'ATUALIZANDO GEO-LOCALIZAÇÃO DAS ROTAS...'}
        </div>
      )}

      {allData.length > 0 && (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-wrap items-center gap-4">
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <span className="text-[10px] font-black text-gray-400 uppercase ml-1">Seletor Global de Rota</span>
            <div className="relative">
              <select 
                value={selectedRouteFilter} 
                onChange={(e) => setSelectedRouteFilter(e.target.value)}
                className="w-full pl-4 pr-10 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none appearance-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer"
              >
                <option value="All">🌍 Todas as Rotas (Visão Geral)</option>
                {routeList.map(city => <option key={city} value={city}>📍 {city}</option>)}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">▼</div>
            </div>
          </div>
          <button onClick={() => {setSelectedRouteFilter('All'); setSelectedStatus('All'); setSearchTerm('');}} className="mt-5 px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded-xl text-xs font-black transition-colors">Resetar Filtros</button>
        </div>
      )}

      {allData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-40 bg-white rounded-3xl shadow-sm border border-dashed border-gray-300">
          <div className="text-6xl mb-4 text-blue-200">🚀</div>
          <p className="text-xl font-black text-gray-600 uppercase tracking-tighter">Pronto para Análise</p>
          <p className="text-gray-400 text-sm mt-2 text-center max-w-sm">Os tickets salvos no Supabase persistirão após o recarregamento da página.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard label={`Tickets (${selectedRouteFilter === 'All' ? 'Geral' : selectedRouteFilter})`} value={totals.total} icon="📊" color="blue" />
            <StatCard label="Faturados (Prejuízo)" value={totals.faturados} icon="🛑" color="red" />
            <StatCard label="Revertidos (Sucesso)" value={totals.revertidos} icon="✅" color="green" />
            <StatCard label="PNR Geral" value={formatCurrency(totals.value)} icon="💰" color="amber" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <InsightList title="Top 4 Melhores Profissionais" icon="🏆" type="best">
              {insights.topDrivers.map((d, i) => <CompactHighlight key={i} name={d.name} metric={`${((d.revertidos/d.totalTickets)*100).toFixed(0)}%`} detail={`${d.totalTickets} tks`} type="best" />)}
            </InsightList>
            <InsightList title="Top 4 Piores Profissionais" icon="⚠️" type="worst">
              {insights.bottomDrivers.map((d, i) => <CompactHighlight key={i} name={d.name} metric={`${((d.revertidos/d.totalTickets)*100).toFixed(0)}%`} detail={`Perda: ${formatCurrency(d.faturadosValue)}`} type="worst" />)}
            </InsightList>
            <InsightList title="Top 4 Rotas Eficientes" icon="📍" type="best">
              {insights.topRoutes.map((r, i) => <CompactHighlight key={i} name={r.locationName} metric={`${((r.revertidos/r.totalTickets)*100).toFixed(0)}%`} detail={`${r.totalTickets} tickets`} type="best" />)}
            </InsightList>
            <InsightList title="Top 4 Rotas Críticas" icon="📉" type="worst">
              {insights.bottomRoutes.map((r, i) => <CompactHighlight key={i} name={r.locationName} metric={`${((r.revertidos/r.totalTickets)*100).toFixed(0)}%`} detail={`Vol: ${r.totalTickets} tks`} type="worst" />)}
            </InsightList>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-1 bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 h-fit">
              <div className="p-6 border-b border-gray-100 bg-[#1e293b] text-white">
                <h3 className="text-lg font-bold">Monitoramento de Rotas</h3>
              </div>
              <div className="max-h-[500px] overflow-y-auto">
                <table className="w-full text-left divide-y divide-gray-50">
                  <tbody>
                    {filteredRouteStats.map((r, idx) => {
                      const perf = (r.revertidos / (r.totalTickets || 1)) * 100;
                      return (
                        <tr key={idx} className={`hover:bg-blue-50 transition-colors cursor-pointer ${selectedRouteFilter === r.locationName ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`} onClick={() => setSelectedRouteFilter(r.locationName)}>
                          <td className="px-5 py-4 flex flex-col">
                            <span className="font-black text-xs uppercase text-gray-700">{r.locationName}</span>
                            <span className="text-[9px] text-gray-400">{r.drivers.size} entregadores</span>
                          </td>
                          <td className="px-5 py-4 text-right">
                             <span className={`text-xs font-black ${perf > 70 ? 'text-emerald-600' : 'text-red-600'}`}>{perf.toFixed(0)}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="xl:col-span-2 bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100">
              <div className="p-6 border-b border-gray-100 header-gradient text-white flex justify-between items-center">
                <h3 className="text-xl font-black">Ranking de Profissionais</h3>
                <input type="text" placeholder="Filtrar nome..." className="px-4 py-2 bg-white/10 border border-white/20 rounded-xl text-sm text-white outline-none w-48" onChange={(e) => handlePerformanceSearchChange(e.target.value)} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-100 text-gray-500 text-[9px] font-black uppercase tracking-widest border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-4 cursor-pointer" onClick={() => toggleSort('name')}>Motorista</th>
                      <th className="px-6 py-4 text-center cursor-pointer" onClick={() => toggleSort('performance')}>Taxa</th>
                      <th className="px-6 py-4 text-center cursor-pointer" onClick={() => toggleSort('totalTickets')}>Tks</th>
                      <th className="px-6 py-4 text-right cursor-pointer" onClick={() => toggleSort('totalValue')}>PNR</th>
                      <th className="px-6 py-4 text-right text-red-600 cursor-pointer" onClick={() => toggleSort('faturadosValue')}>Faturado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredPerformanceStats.map((stat, idx) => (
                      <tr key={idx} className="hover:bg-blue-50/50 transition-all">
                        <td className="px-6 py-5 flex flex-col gap-1">
                          <span className="font-bold text-gray-800 text-xs uppercase">{stat.name}</span>
                          {stat.routes?.[0] && <span className="text-[8px] font-black px-1.5 py-0.5 rounded border uppercase bg-blue-50 text-blue-600 border-blue-100 w-fit">{stat.routes[0]}</span>}
                        </td>
                        <td className="px-6 py-5 text-center font-black text-xs">
                          {((stat.revertidos/(stat.totalTickets || 1))*100).toFixed(1)}%
                        </td>
                        <td className="px-6 py-5 text-center font-bold text-gray-700 text-xs">{stat.totalTickets}</td>
                        <td className="px-6 py-5 text-right font-semibold text-gray-600 text-xs">{formatCurrency(stat.totalValue)}</td>
                        <td className="px-6 py-5 text-right text-red-600 font-black text-xs">{formatCurrency(stat.faturadosValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const StatCard = ({ label, value, icon, color }: any) => {
  const colors: any = { blue: 'bg-blue-50 text-blue-600 border-blue-100', amber: 'bg-amber-50 text-amber-600 border-amber-100', green: 'bg-emerald-50 text-emerald-600 border-emerald-100', red: 'bg-red-50 text-red-600 border-red-100' };
  return (
    <div className={`bg-white p-6 rounded-2xl shadow-lg border-2 flex items-center justify-between transition-all ${colors[color]}`}>
      <div><p className="text-gray-500 font-black text-[9px] uppercase tracking-widest">{label}</p><p className="text-2xl font-black text-gray-900 tracking-tighter">{value}</p></div>
      <div className={`p-4 rounded-xl text-2xl ${colors[color]}`}>{icon}</div>
    </div>
  );
};

const InsightList = ({ title, icon, type, children }: any) => (
  <div className={`bg-white rounded-2xl shadow-md border-t-4 ${type === 'best' ? 'border-emerald-500' : 'border-red-500'} overflow-hidden`}>
    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100"><h4 className="text-[10px] font-black uppercase text-gray-500">{icon} {title}</h4></div>
    <div className="p-3 space-y-2">{children}</div>
  </div>
);

const CompactHighlight = ({ name, metric, detail, type }: any) => (
  <div className="flex items-center justify-between p-2 rounded-xl bg-gray-50 border border-gray-100">
    <div className="flex flex-col"><span className="text-[11px] font-black text-gray-800 uppercase line-clamp-1">{name}</span><span className="text-[9px] text-gray-400">{detail}</span></div>
    <span className={`text-sm font-black ${type === 'best' ? 'text-emerald-600' : 'text-red-600'}`}>{metric}</span>
  </div>
);

export default App;
