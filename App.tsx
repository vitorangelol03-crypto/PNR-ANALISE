
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { supabase } from './supabase';
import { TicketStatus, IHSTicket, DriverStats, RouteStats } from './types';
import { formatCurrency, formatDate, translateStatus, debounce } from './utils';

type SortKey = 'performance' | 'totalTickets' | 'faturados' | 'totalValue' | 'revertidos' | 'faturadosValue' | 'name';

interface DriverOverride {
  route: string;
  isExcluded: boolean;
}

// Lista de distritos oficiais de Caratinga para separação de rotas
const CARATINGA_DISTRICTS = [
  'dom lara', 
  'dom modesto', 
  'patrocinio', 
  'santa efigenia',
  'santa luzia', 
  'santo antonio do manhuacu', 
  'sapucaia', 
  'sao candido', 
  'sao joao do jacutinga',
  'cordeiro de minas'
];

const normalizeText = (text: string) => 
  text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

// Componente de Modal de Confirmação Customizado
const ConfirmModal = ({ show, title, message, onConfirm, onCancel, confirmText = "Confirmar", isDanger = false }: any) => {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl scale-in-center border border-gray-100">
        <div className="text-4xl mb-4 text-center">{isDanger ? '⚠️' : '❓'}</div>
        <h2 className="text-xl font-black text-center text-gray-800 uppercase tracking-tight">{title}</h2>
        <p className="text-gray-500 text-sm text-center mt-3 leading-relaxed">{message}</p>
        <div className="flex flex-col gap-2 mt-8">
          <button 
            onClick={onConfirm}
            className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 ${isDanger ? 'bg-red-600 text-white shadow-lg shadow-red-200' : 'bg-blue-600 text-white shadow-lg shadow-blue-200'}`}
          >
            {confirmText}
          </button>
          <button 
            onClick={onCancel}
            className="w-full py-4 bg-gray-100 text-gray-500 rounded-2xl font-black text-xs uppercase hover:bg-gray-200 transition-all"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [allData, setAllData] = useState<IHSTicket[]>([]);
  const [routeMap, setRouteMap] = useState<Record<string, string>>({});
  const [cityCache, setCityCache] = useState<Record<string, string>>({});
  const [driverOverrides, setDriverOverrides] = useState<Record<string, DriverOverride>>({});
  const [referenceDate, setReferenceDate] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState<number>(0); // Gatilho para re-enriquecer CEPs

  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('ihs_admin') === 'true';
    } catch {
      return false;
    }
  });

  const [confirmModal, setConfirmModal] = useState<{show: boolean, type: string, title: string, message: string, isDanger?: boolean}>({
    show: false, type: '', title: '', message: ''
  });

  const [showPassModal, setShowPassModal] = useState(false);
  const [passInput, setPassInput] = useState('');
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const [isLoadingSupabase, setIsLoadingSupabase] = useState(true);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isFetchingCities, setIsFetchingCities] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const [showDriverMgmtModal, setShowDriverMgmtModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  
  const [tempTickets, setTempTickets] = useState<IHSTicket[]>([]);
  const [duplicateCount, setDuplicateCount] = useState<number>(0);
  const [inputRefDate, setInputRefDate] = useState<string>('');

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [performanceSearch, setPerformanceSearch] = useState<string>('');
  const [mgmtSearch, setMgmtSearch] = useState<string>('');
  const [routeSearch, setRouteSearch] = useState<string>('');
  
  const [selectedRouteFilter, setSelectedRouteFilter] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  
  const [driverSortKey, setDriverSortKey] = useState<SortKey>('performance');
  const [driverSortOrder, setDriverSortOrder] = useState<'asc' | 'desc'>('desc');

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
      try {
        sessionStorage.setItem('ihs_admin', 'true');
      } catch {}
      setShowPassModal(false);
      setPassInput('');
      if (pendingAction) {
        pendingAction();
        setPendingAction(null);
      }
    } else {
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

  const handleRouteClick = (route: string) => {
    setSelectedRouteFilter(route);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fetchCityInfo = async (cep: string) => {
    const cleanCep = (cep as string).replace(/\D/g, '');
    if (cleanCep.length !== 8) return null;
    if (cityCache[cleanCep]) return cityCache[cleanCep];

    try {
      const response = await fetch(`https://brasilapi.com.br/api/cep/v1/${cleanCep}`);
      if (response.ok) {
        const data = await response.json();
        const neighborhood = data.neighborhood?.trim() || '';
        const city = data.city?.trim() || '';
        const state = data.state?.trim() || '';

        let info = '';
        
        // REGRA ESPECIAL CARATINGA: Agrupar bairros/ruas e separar distritos
        if (normalizeText(city) === 'caratinga') {
          const normalizedNeighborhood = normalizeText(neighborhood);
          const isDistrict = CARATINGA_DISTRICTS.some(d => normalizedNeighborhood.includes(normalizeText(d)));
          
          if (isDistrict) {
            info = `${neighborhood} - ${city}, ${state}`;
          } else {
            info = `Caratinga, ${state}`; 
          }
        } else {
          if (neighborhood && neighborhood.toLowerCase() !== 'centro' && neighborhood !== city) {
            info = `${neighborhood} - ${city}, ${state}`;
          } else {
            info = `${city}, ${state}`;
          }
        }

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
      const uniqueCeps = Array.from(new Set(Object.values(routeMap) as string[]));
      const missingCeps = uniqueCeps.filter((cep: string) => cep && !cityCache[cep.replace(/\D/g, '')]);

      if (missingCeps.length > 0) {
        setIsFetchingCities(true);
        const newCache = { ...cityCache };
        let hasNewData = false;
        
        for (const cep of missingCeps) {
          const clean = (cep as string).replace(/\D/g, '');
          if (clean.length === 8) {
            const info = await fetchCityInfo(clean);
            if (info) {
              newCache[clean] = info;
              hasNewData = true;
            }
            await new Promise(r => setTimeout(r, 250)); 
          }
        }
        
        if (hasNewData) setCityCache(newCache);
        setIsFetchingCities(false);
      }
    };
    if (Object.keys(routeMap).length > 0) enrichCeps();
  }, [routeMap, refreshKey]);

  const triggerConfirm = (type: string, title: string, message: string, isDanger: boolean = false) => {
    setConfirmModal({ show: true, type, title, message, isDanger });
  };

  const handleModalConfirm = () => {
    const type = confirmModal.type;
    setConfirmModal({ ...confirmModal, show: false });
    
    if (type === 'refresh_ceps') executeRefreshCeps();
    if (type === 'clear_tickets') executeClearAllTickets();
    if (type === 'reset_everything') executeResetEverything();
    if (type === 'delete_routes') executeDeleteRoutes();
  };

  const executeRefreshCeps = async () => {
    setIsFetchingCities(true);
    try {
      const cepsToRefresh = Array.from(new Set(Object.values(routeMap) as string[])).map((c: string) => c.replace(/\D/g, ''));
      if (cepsToRefresh.length > 0) {
        await supabase.from('city_cache').delete().in('cep', cepsToRefresh);
        setCityCache({});
        setRefreshKey(prev => prev + 1);
      }
    } catch (err) {
      console.error("Erro ao atualizar ceps:", err);
    }
  };

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
          is_excluded: merged.is_excluded 
        });
        setDriverOverrides(prev => ({ ...prev, [driverName]: merged }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const executeClearAllTickets = async () => {
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

  const executeResetEverything = async () => {
    setIsDeleting(true);
    try {
      await Promise.all([
        supabase.from('tickets').delete().neq('ticket_id', '0_ignore_internal'),
        supabase.from('route_mapping').delete().neq('spxtn', '0_ignore_internal'),
        supabase.from('city_cache').delete().neq('cep', '0_ignore_internal'),
        supabase.from('driver_overrides').delete().neq('driver_name', '0_ignore_internal'),
        supabase.from('dashboard_meta').delete().neq('key', '0_ignore_internal')
      ]);
      
      setAllData([]);
      setRouteMap({});
      setCityCache({});
      setDriverOverrides({});
      setReferenceDate('');
      location.reload();
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  const executeDeleteRoutes = async () => {
    setIsDeleting(true);
    try {
      const { error } = await supabase.from('route_mapping').delete().neq('spxtn', '0_ignore');
      if (!error) {
        setRouteMap({});
        location.reload();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    const extension = file.name.split('.').pop()?.toLowerCase();
    
    const parseRows = (rows: any[][]) => {
      const dataRows = (rows[0]?.[0]?.toString().toLowerCase().includes('id')) ? rows.slice(1) : rows;
      
      const seenSpxtn = new Set<string>();
      let dups = 0;
      const processed: IHSTicket[] = [];

      dataRows.forEach((row) => {
        const ticketIdRaw = String(row[0] || '').trim();
        const spxtnCode = String(row[2] || '').trim(); 

        if (!spxtnCode) return;

        if (seenSpxtn.has(spxtnCode)) {
          dups++;
          return;
        }

        seenSpxtn.add(spxtnCode);
        
        processed.push({
          ticketId: ticketIdRaw || `TEMP_${spxtnCode}`,
          taskId: String(row[1] || ''),
          spxtn: spxtnCode,
          driver: String(row[3] || 'Desconhecido').replace(/\d+/g, '').replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim(),
          station: String(row[4] || ''),
          slaDeadline: String(row[5] || ''),
          assignee: String(row[6] || ''),
          pnrValue: parseFloat(String(row[7] || '0').replace(',', '.').replace('R$', '').trim()) || 0,
          rejectionReason: String(row[8] || ''),
          createdTime: String(row[9] || ''),
          status: String(row[10]).toLowerCase().includes('billing') ? TicketStatus.ForBilling : TicketStatus.Reversed,
        });
      });

      setDuplicateCount(dups);
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
        }
      } catch (err) {
        console.error("Erro ao importar rotas:", err);
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
    if (!inputRefDate) return;
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
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessingFile(false);
    }
  };

  const stats = useMemo(() => {
    const dMap: Record<string, DriverStats> = {};
    const rMap: Record<string, RouteStats> = {};
    
    const activeData = allData.filter(item => !driverOverrides[item.driver]?.isExcluded);
    const driverRouteCounts: Record<string, Record<string, number>> = {};

    activeData.forEach(item => {
      let currentRoute = '';
      if (driverOverrides[item.driver]?.route) {
        currentRoute = driverOverrides[item.driver].route;
      } else {
        const rawCep = routeMap[item.spxtn];
        if (rawCep) {
          currentRoute = cityCache[rawCep] || `CEP ${rawCep}`;
        }
      }

      if (currentRoute) {
        if (!driverRouteCounts[item.driver]) driverRouteCounts[item.driver] = {};
        driverRouteCounts[item.driver][currentRoute] = (driverRouteCounts[item.driver][currentRoute] || 0) + 1;
      }
    });

    const driverPreferredRoute: Record<string, string> = {};
    Object.entries(driverRouteCounts).forEach(([driver, routes]) => {
      const sortedRoutes = Object.entries(routes).sort((a, b) => b[1] - a[1]);
      if (sortedRoutes.length > 0) driverPreferredRoute[driver] = sortedRoutes[0][0];
    });

    const getTicketFinalRoute = (item: IHSTicket) => {
      if (driverOverrides[item.driver]?.route) return driverOverrides[item.driver].route;
      const rawCep = routeMap[item.spxtn];
      if (rawCep) {
        const cityInfo = cityCache[rawCep];
        if (cityInfo) return cityInfo;
        return `CEP ${rawCep}`;
      }
      if (driverPreferredRoute[item.driver]) return driverPreferredRoute[item.driver];
      return 'Não Mapeado';
    };

    const filteredBySearch = activeData.filter(item => {
      const matchSearch = item.driver.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.ticketId.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = selectedStatus === 'All' || item.status === selectedStatus;
      return matchSearch && matchStatus;
    });

    filteredBySearch.forEach(item => {
      const route = getTicketFinalRoute(item);
      if (!rMap[route]) {
        rMap[route] = { cep: 'N/A', locationName: route, totalTickets: 0, faturados: 0, revertidos: 0, totalValue: 0, drivers: new Set() };
      }
      const r = rMap[route];
      r.totalTickets++;
      r.totalValue += item.pnrValue;
      r.drivers.add(item.driver);
      if (item.status === TicketStatus.ForBilling) r.faturados++; else r.revertidos++;
    });

    const finalFiltered = filteredBySearch.filter(item => {
      if (selectedRouteFilter === 'All') return true;
      return getTicketFinalRoute(item) === selectedRouteFilter;
    });

    finalFiltered.forEach(item => {
      if (!dMap[item.driver]) {
        dMap[item.driver] = { name: item.driver, totalTickets: 0, totalValue: 0, faturados: 0, faturadosValue: 0, revertidos: 0, revertidosValue: 0, routes: [] };
      }
      const d = dMap[item.driver];
      d.totalTickets++;
      d.totalValue += item.pnrValue;
      const currentRoute = getTicketFinalRoute(item);
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
      drivers: Object.values(dMap) as DriverStats[], 
      routes: Object.values(rMap) as RouteStats[], 
      filtered: finalFiltered 
    };
  }, [allData, routeMap, cityCache, searchTerm, selectedStatus, selectedRouteFilter, driverOverrides]);

  const totals = useMemo(() => {
    const faturadosItems = stats.filtered.filter(i => i.status === TicketStatus.ForBilling);
    return {
      total: stats.filtered.length,
      faturados: faturadosItems.length,
      revertidos: stats.filtered.filter(i => i.status === TicketStatus.Reversed).length,
      value: stats.filtered.reduce((acc, curr) => acc + curr.pnrValue, 0),
      faturadosValue: faturadosItems.reduce((acc, curr) => acc + curr.pnrValue, 0)
    };
  }, [stats.filtered]);

  const insights = useMemo(() => {
    const relevantDrivers = stats.drivers.filter(d => d.totalTickets > 10);
    const relevantRoutes = stats.routes.filter(r => r.totalTickets > 10);
    const sortByPerf = (a: any, b: any) => (b.revertidos / b.totalTickets) - (a.revertidos / a.totalTickets);
    return { 
      topDrivers: [...relevantDrivers].sort(sortByPerf).slice(0, 5),
      bottomDrivers: [...relevantDrivers].sort((a, b) => sortByPerf(b, a)).slice(0, 5),
      topVolumeDrivers: [...stats.drivers].sort((a, b) => b.totalTickets - a.totalTickets).slice(0, 5),
      topRoutes: [...relevantRoutes].sort(sortByPerf).slice(0, 5),
      bottomRoutes: [...stats.routes].sort((a, b) => b.totalTickets - a.totalTickets).slice(0, 5) 
    };
  }, [stats]);

  const routeList = useMemo(() => Array.from(new Set(stats.routes.map(r => r.locationName))).sort() as string[], [stats.routes]);
  const uniqueDriversFromData = useMemo(() => {
    const names = Array.from(new Set(allData.map(d => d.driver))).sort() as string[];
    return names.filter(n => n.toLowerCase().includes(mgmtSearch.toLowerCase()));
  }, [allData, mgmtSearch]);

  const filteredRouteStats = useMemo(() => 
    stats.routes.filter(r => r.locationName.toLowerCase().includes(routeSearch.toLowerCase()) || r.cep.includes(routeSearch))
    .sort((a, b) => b.totalTickets - a.totalTickets),
  [stats.routes, routeSearch]);

  const filteredPerformanceStats = useMemo(() => {
    let list = (stats.drivers as DriverStats[]).filter(s => s.name.toLowerCase().includes(performanceSearch.toLowerCase()));
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

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-8 space-y-4 md:space-y-8 text-[#374151]">
      
      {/* Modal de Confirmação Global */}
      <ConfirmModal 
        show={confirmModal.show}
        title={confirmModal.title}
        message={confirmModal.message}
        isDanger={confirmModal.isDanger}
        onConfirm={handleModalConfirm}
        onCancel={() => setConfirmModal({...confirmModal, show: false})}
      />

      {/* Modal de Senha */}
      {showPassModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-white rounded-3xl p-6 md:p-10 max-w-sm w-full shadow-2xl scale-in-center">
            <div className="text-4xl md:text-5xl mb-4 md:mb-6 text-center">🔒</div>
            <h2 className="text-xl md:text-2xl font-black text-center text-gray-800 uppercase tracking-tight">Área Restrita</h2>
            <p className="text-gray-400 text-xs md:text-sm text-center mt-2 font-medium">Digite a senha para administrador.</p>
            <form onSubmit={handleAuth} className="mt-6 md:mt-8 space-y-4">
              <input 
                autoFocus
                type="password" 
                placeholder="••••••" 
                value={passInput}
                onChange={(e) => setPassInput(e.target.value)}
                className="w-full px-5 py-3 md:py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl text-xl md:text-2xl font-black text-center outline-none focus:border-blue-500 transition-all tracking-[0.5em]"
              />
              <div className="flex gap-2">
                <button type="submit" className="flex-1 py-3 md:py-4 bg-[#1e3a8a] text-white rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest shadow-lg shadow-blue-200 active:scale-95 transition-all">Desbloquear</button>
                <button type="button" onClick={() => { setShowPassModal(false); setPendingAction(null); setPassInput(''); }} className="px-4 md:px-6 py-3 md:py-4 bg-gray-100 text-gray-500 rounded-2xl font-black text-[10px] md:text-xs uppercase transition-all">Sair</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-md w-full shadow-2xl scale-in-center">
            <div className="text-3xl md:text-4xl mb-3 md:mb-4 text-center">📅</div>
            <h2 className="text-lg md:text-xl font-black text-center text-gray-800 uppercase">Confirmar Importação</h2>
            <div className="bg-blue-50 p-4 rounded-xl mt-4 border border-blue-100">
              <p className="text-blue-800 font-bold text-xs md:text-sm">Tickets únicos encontrados: {tempTickets.length}</p>
              {duplicateCount > 0 && (
                <p className="text-amber-600 font-black text-[9px] md:text-[10px] uppercase mt-1">⚠️ {duplicateCount} Tickets duplicados (SPXTN repetido) foram ignorados.</p>
              )}
            </div>
            <p className="text-gray-500 text-xs md:text-sm text-center mt-6">Informe a data de referência:</p>
            <div className="mt-4 space-y-4">
              <input 
                type="text" 
                placeholder="Ex: 22/10/2023" 
                value={inputRefDate}
                onChange={(e) => setInputRefDate(e.target.value)}
                className="w-full px-5 py-3 md:py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl text-base md:text-lg font-bold text-center outline-none focus:border-blue-400 focus:bg-white transition-all"
              />
              <div className="flex gap-3 mt-4">
                <button onClick={confirmImport} disabled={isProcessingFile} className="flex-1 py-3 md:py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest shadow-lg shadow-blue-200 disabled:opacity-50 transition-all">{isProcessingFile ? 'SALVANDO...' : 'Salvar'}</button>
                <button onClick={() => setShowImportModal(false)} className="px-4 md:px-6 py-3 md:py-4 bg-gray-100 text-gray-600 rounded-2xl font-black text-[10px] md:text-xs uppercase transition-all">Sair</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDriverMgmtModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-3xl w-full shadow-2xl flex flex-col h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg md:text-xl font-black text-gray-800 uppercase">Vínculos</h2>
                <p className="text-[9px] md:text-xs text-gray-400 font-bold uppercase tracking-tighter">Gerenciar Rotas e Visibilidade</p>
              </div>
              <button onClick={() => setShowDriverMgmtModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-lg">✕</button>
            </div>
            <div className="mb-4">
              <input 
                type="text" 
                placeholder="🔍 Buscar motorista..." 
                className="w-full px-4 py-2 md:py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs md:text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                onChange={(e) => setMgmtSearch(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
              <div className="grid grid-cols-12 px-4 py-1 text-[8px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest">
                <div className="col-span-5">Motorista</div>
                <div className="col-span-4">Rota Fixa</div>
                <div className="col-span-3 text-center">Status</div>
              </div>
              {uniqueDriversFromData.map(name => {
                const override = driverOverrides[name] || { route: "", isExcluded: false };
                return (
                  <div key={name} className={`grid grid-cols-12 items-center gap-2 md:gap-4 p-2 md:p-3 bg-gray-50 rounded-xl border border-gray-100 transition-all ${override.isExcluded ? 'opacity-50' : ''}`}>
                    <div className="col-span-5">
                      <span className={`text-[10px] md:text-xs font-black uppercase truncate block ${override.isExcluded ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{name}</span>
                    </div>
                    <div className="col-span-4">
                      <select 
                        disabled={override.isExcluded}
                        value={override.route} 
                        onChange={(e) => saveDriverOverride(name, { route: e.target.value })}
                        className="w-full text-[8px] md:text-[10px] font-bold py-1 px-1 md:px-3 bg-white border border-gray-200 rounded-lg outline-none cursor-pointer"
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
                        className={`px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[8px] md:text-[9px] font-black uppercase transition-all ${override.isExcluded ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}
                      >
                        {override.isExcluded ? 'OFF' : 'ON'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-100 text-center">
              <button onClick={() => setShowDriverMgmtModal(false)} className="w-full md:w-auto px-8 py-3 bg-[#1e3a8a] text-white rounded-xl font-black text-xs uppercase tracking-widest">Concluir</button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 md:gap-6 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="space-y-1">
          <h1 className="text-xl md:text-3xl font-extrabold text-[#1e3a8a] flex items-center gap-2">
            <span className="p-1.5 bg-blue-50 rounded-lg text-lg md:text-xl">🚀</span>
            IHS Dashboard
          </h1>
          <div className="flex flex-col gap-0.5">
            {referenceDate && (
              <p className="text-blue-600 font-black text-[10px] md:text-xs flex items-center gap-1.5 uppercase">
                <span className="w-1.5 h-1.5 md:w-2 md:h-2 bg-blue-500 rounded-full animate-pulse"></span>
                Referência: {referenceDate}
              </p>
            )}
          </div>
        </div>
        
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 md:gap-4">
          <button 
            onClick={() => triggerConfirm('refresh_ceps', 'Atualizar Cidades?', 'O sistema irá re-validar todos os CEPs mapeados na API pública para normalizar nomes e distritos.', false)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 md:px-4 md:py-2.5 rounded-xl font-black text-[9px] md:text-xs border bg-white text-gray-700 border-gray-200 transition-all hover:bg-gray-50 active:scale-95"
          >
            📍 ATUALIZAR CEPS
          </button>

          <button 
            onClick={() => withAdmin(() => triggerConfirm('reset_everything', '⚠️ RESET TOTAL?', 'Isso apagará DEFINITIVAMENTE todos os dados do banco de dados na nuvem. Ação irreversível.', true))}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 md:px-4 md:py-2.5 rounded-xl font-black text-[9px] md:text-xs border transition-all active:scale-95 ${isAdmin ? 'bg-red-600 text-white border-red-700 shadow-lg shadow-red-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}
          >
            {isAdmin ? '🔥' : '🔒'} RESET TOTAL
          </button>
          
          <button onClick={() => withAdmin(() => triggerConfirm('clear_tickets', 'Limpar Tickets?', 'Isso removerá apenas os tickets do dashboard e nuvem.', true))} className={`flex items-center justify-center gap-1.5 px-3 py-2 md:px-4 md:py-2.5 rounded-xl font-black text-[9px] md:text-xs border transition-all active:scale-95 ${isAdmin ? 'bg-red-50 text-red-600 border-red-100' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
            {isAdmin ? '🗑️' : '🔒'} Limpar
          </button>
          
          <button onClick={() => withAdmin(() => setShowDriverMgmtModal(true))} className="bg-gray-100 text-[#1e3a8a] px-3 py-2 md:px-5 md:py-2.5 rounded-xl font-black flex items-center justify-center gap-1.5 text-[9px] md:text-xs border border-gray-200 active:scale-95 transition-all">
            {isAdmin ? '👤' : '🔒'} Vínculos
          </button>
          
          <button onClick={() => withAdmin(() => document.getElementById('import-tickets-input')?.click())} className="bg-[#3b82f6] text-white px-3 py-2 md:px-5 md:py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 text-[9px] md:text-xs shadow-md active:scale-95 transition-all">
            {isAdmin ? '📥' : '🔒'} Importar
          </button>
          <input id="import-tickets-input" type="file" className="hidden" accept=".csv, .xlsx, .xls" onChange={handleFileUpload} />
          
          <div className="flex gap-0.5 col-span-2 sm:col-auto">
            <button onClick={() => withAdmin(() => document.getElementById('import-routes-input')?.click())} className="flex-1 bg-emerald-600 text-white px-4 py-2 md:px-5 md:py-2.5 rounded-l-xl font-bold flex items-center justify-center gap-1.5 text-[9px] md:text-xs shadow-md border-r border-emerald-500/30 active:scale-95 transition-all">
              {isAdmin ? '🗺️' : '🔒'} Rotas
            </button>
            <input id="import-routes-input" type="file" className="hidden" accept=".csv, .xlsx, .xls" onChange={handleRouteFileUpload} />
            {Object.keys(routeMap).length > 0 && (
              <button onClick={() => withAdmin(() => triggerConfirm('delete_routes', 'Apagar Rotas?', 'Isso removerá todos os mapeamentos SPXTN-CEP.', true))} className="bg-red-500 text-white px-3 py-2 md:px-3 md:py-2.5 rounded-r-xl font-bold text-[9px] md:text-xs shadow-md transition-all active:scale-95">
                {isAdmin ? '🗑️' : '🔒'}
              </button>
            )}
          </div>
        </div>
      </header>

      {(isFetchingCities || isLoadingSupabase || isProcessingFile) && (
        <div className="bg-blue-600 text-white p-2.5 rounded-xl text-center text-[9px] md:text-xs font-black animate-pulse flex items-center justify-center gap-2">
          <div className="w-3 h-3 md:w-4 md:h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          {isLoadingSupabase ? 'SINCRONIZANDO...' : isProcessingFile ? 'SALVANDO NA NUVEM...' : 'GEOLOCALIZANDO...'}
        </div>
      )}

      {allData.length > 0 && (
        <div className="bg-white p-3 md:p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row items-center gap-3 md:gap-4">
          <div className="flex flex-col gap-1 w-full">
            <span className="text-[8px] md:text-[10px] font-black text-gray-400 uppercase ml-1">Seletor Global de Rota</span>
            <div className="relative">
              <select 
                value={selectedRouteFilter} 
                onChange={(e) => setSelectedRouteFilter(e.target.value)}
                className="w-full pl-4 pr-10 py-2.5 md:py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs md:text-sm font-bold text-gray-700 outline-none appearance-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="All">🌍 Todas as Rotas</option>
                {routeList.map(city => <option key={city} value={city}>📍 {city}</option>)}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-xs">▼</div>
            </div>
          </div>
          <button 
            onClick={() => {setSelectedRouteFilter('All'); setSelectedStatus('All'); setSearchTerm('');}} 
            className="w-full sm:w-auto px-6 py-2.5 md:py-3 bg-[#3b82f6] text-white rounded-xl text-[10px] md:text-xs font-black shadow-md shrink-0 sm:mt-4 active:scale-95 transition-all"
          >
            Limpar Filtros
          </button>
        </div>
      )}

      {allData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 md:py-40 bg-white rounded-3xl shadow-sm border border-dashed border-gray-300 mx-2">
          <div className="text-4xl md:text-6xl mb-4 text-blue-200">🚀</div>
          <p className="text-base md:text-xl font-black text-gray-600 uppercase tracking-tighter">Pronto para Iniciar</p>
          <p className="text-gray-400 text-[10px] md:text-sm mt-2 text-center max-w-[250px] md:max-w-sm px-4">Os tickets salvos no Supabase persistirão após recarregar.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-6">
            <StatCard label={`Tickets`} value={totals.total} icon="📊" color="blue" />
            <StatCard label="Faturados" value={totals.faturados} icon="🛑" color="red" />
            <StatCard label="Revertidos" value={totals.revertidos} icon="✅" color="green" />
            <StatCard label="Soma Faturados" value={formatCurrency(totals.faturadosValue)} icon="💸" color="red" isValue />
            <StatCard label="PNR Geral" value={formatCurrency(totals.value)} icon="💰" color="amber" isValue />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 md:gap-6">
            <InsightList title="Top 5 Melhores (Performance)" icon="🏆" type="best">
              {insights.topDrivers.map((d, i) => <CompactHighlight key={i} name={d.name} metric={`${((d.revertidos/d.totalTickets)*100).toFixed(0)}%`} detail={`${d.totalTickets} tks`} route={d.routes?.[0]} onRouteClick={handleRouteClick} type="best" />)}
            </InsightList>
            <InsightList title="Top 5 Volume (Volume)" icon="🚨" type="worst">
              {insights.topVolumeDrivers.map((d, i) => <CompactHighlight key={i} name={d.name} metric={d.totalTickets} detail={`Total Tickets`} route={d.routes?.[0]} onRouteClick={handleRouteClick} type="worst" />)}
            </InsightList>
            <InsightList title="Top 5 Piores (Performance)" icon="⚠️" type="worst">
              {insights.bottomDrivers.map((d, i) => <CompactHighlight key={i} name={d.name} metric={`${((d.revertidos/d.totalTickets)*100).toFixed(0)}%`} detail={`Fat: ${formatCurrency(d.faturadosValue)}`} route={d.routes?.[0]} onRouteClick={handleRouteClick} type="worst" />)}
            </InsightList>
            <InsightList title="Top 5 Rotas Eficientes (Performance)" icon="📍" type="best">
              {insights.topRoutes.map((r, i) => <CompactHighlight key={i} name={r.locationName} metric={`${((r.revertidos/r.totalTickets)*100).toFixed(0)}%`} detail={`${r.totalTickets} tks`} type="best" />)}
            </InsightList>
            <InsightList title="Top 5 Rotas Críticas (Volume)" icon="📉" type="worst">
              {insights.bottomRoutes.map((r, i) => <CompactHighlight key={i} name={r.locationName} metric={r.totalTickets} detail={`Taxa: ${((r.revertidos/r.totalTickets)*100).toFixed(0)}%`} type="worst" />)}
            </InsightList>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 md:gap-8">
            <div className="xl:col-span-1 bg-white rounded-2xl md:rounded-3xl shadow-lg overflow-hidden border border-gray-100 h-fit">
              <div className="p-4 md:p-6 border-b border-gray-100 bg-[#1e293b] text-white">
                <h3 className="text-base md:text-lg font-bold uppercase tracking-tight">Monitoramento de Rotas</h3>
              </div>
              <div className="max-h-[300px] md:max-h-[500px] overflow-y-auto">
                <table className="w-full text-left divide-y divide-gray-50">
                  <tbody className="divide-y divide-gray-100">
                    {filteredRouteStats.map((r, idx) => {
                      const perf = (r.revertidos / (r.totalTickets || 1)) * 100;
                      return (
                        <tr key={idx} className={`hover:bg-blue-50 transition-colors cursor-pointer ${selectedRouteFilter === r.locationName ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`} onClick={() => setSelectedRouteFilter(r.locationName)}>
                          <td className="px-4 py-3 md:px-5 md:py-4 flex flex-col">
                            <span className="font-black text-[10px] md:text-xs uppercase text-gray-700 truncate max-w-[150px] md:max-w-none">{r.locationName}</span>
                            <span className="text-[8px] md:text-[9px] text-gray-400">{r.drivers.size} entregadores</span>
                          </td>
                          <td className="px-4 py-3 md:px-5 md:py-4 text-right">
                             <span className={`text-[10px] md:text-xs font-black ${perf > 70 ? 'text-emerald-600' : 'text-red-600'}`}>{perf.toFixed(0)}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="xl:col-span-2 bg-white rounded-2xl md:rounded-3xl shadow-lg overflow-hidden border border-gray-100">
              <div className="p-4 md:p-6 border-b border-gray-100 header-gradient text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h3 className="text-base md:text-xl font-black uppercase tracking-tight">Ranking</h3>
                <input type="text" placeholder="Filtrar motorista..." className="px-4 py-2 bg-white/10 border border-white/20 rounded-xl text-xs md:text-sm text-white outline-none w-full sm:w-48 placeholder-white/50" onChange={(e) => handlePerformanceSearchChange(e.target.value)} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[500px] md:min-w-0">
                  <thead className="bg-gray-100 text-gray-500 text-[8px] md:text-[9px] font-black uppercase tracking-widest border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 md:px-6 md:py-4 cursor-pointer" onClick={() => toggleSort('name')}>Motorista</th>
                      <th className="px-4 py-3 md:px-6 md:py-4 text-center cursor-pointer" onClick={() => toggleSort('performance')}>Taxa</th>
                      <th className="px-4 py-3 md:px-6 md:py-4 text-center cursor-pointer" onClick={() => toggleSort('totalTickets')}>Tks</th>
                      <th className="px-4 py-3 md:px-6 md:py-4 text-center cursor-pointer" onClick={() => toggleSort('faturados')}>Fat</th>
                      <th className="px-4 py-3 md:px-6 md:py-4 text-right cursor-pointer" onClick={() => toggleSort('totalValue')}>PNR</th>
                      <th className="px-4 py-3 md:px-6 md:py-4 text-right text-red-600 cursor-pointer" onClick={() => toggleSort('faturadosValue')}>Faturado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredPerformanceStats.map((stat, idx) => (
                      <tr key={idx} className="hover:bg-blue-50/50 transition-all">
                        <td className="px-4 py-4 md:px-6 md:py-5 flex flex-col gap-1">
                          <span className="font-bold text-gray-800 text-[10px] md:text-xs uppercase truncate max-w-[120px] md:max-w-none">{stat.name}</span>
                          {stat.routes?.[0] && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRouteClick(stat.routes![0]);
                              }}
                              className="text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded border uppercase bg-blue-50 text-blue-600 border-blue-100 w-fit hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                            >
                              {stat.routes[0]}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-4 md:px-6 md:py-5 text-center font-black text-[10px] md:text-xs">
                          {((stat.revertidos/(stat.totalTickets || 1))*100).toFixed(1)}%
                        </td>
                        <td className="px-4 py-4 md:px-6 md:py-5 text-center font-bold text-gray-700 text-[10px] md:text-xs">{stat.totalTickets}</td>
                        <td className="px-4 py-4 md:px-6 md:py-5 text-center font-bold text-red-500 text-[10px] md:text-xs">{stat.faturados}</td>
                        <td className="px-4 py-4 md:px-6 md:py-5 text-right font-semibold text-gray-600 text-[10px] md:text-xs">{formatCurrency(stat.totalValue)}</td>
                        <td className="px-4 py-4 md:px-6 md:py-5 text-right text-red-600 font-black text-[10px] md:text-xs">{formatCurrency(stat.faturadosValue)}</td>
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

const StatCard = ({ label, value, icon, color, isValue }: any) => {
  const colors: any = { 
    blue: 'bg-blue-50 text-blue-600 border-blue-100', 
    amber: 'bg-amber-50 text-amber-600 border-amber-100', 
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100', 
    red: 'bg-red-50 text-red-600 border-red-100' 
  };
  return (
    <div className={`bg-white p-3 md:p-6 rounded-2xl shadow-sm border flex items-center justify-between transition-all ${colors[color]}`}>
      <div className="overflow-hidden">
        <p className="text-gray-500 font-black text-[7px] md:text-[9px] uppercase tracking-widest truncate">{label}</p>
        <p className={`font-black text-gray-900 tracking-tighter ${isValue ? 'text-sm md:text-xl' : 'text-lg md:text-2xl'}`}>{value}</p>
      </div>
      <div className={`hidden sm:flex p-2.5 md:p-4 rounded-xl text-lg md:text-2xl ${colors[color]}`}>{icon}</div>
    </div>
  );
};

const InsightList = ({ title, icon, type, children }: any) => (
  <div className={`bg-white rounded-2xl shadow-sm border-t-4 ${type === 'best' ? 'border-emerald-500' : 'border-red-500'} overflow-hidden`}>
    <div className="px-3 py-2 md:px-4 md:py-3 bg-gray-50 border-b border-gray-100">
      <h4 className="text-[8px] md:text-[10px] font-black uppercase text-gray-500 truncate">{icon} {title}</h4>
    </div>
    <div className="p-2 md:p-3 space-y-2">{children}</div>
  </div>
);

const CompactHighlight = ({ name, metric, detail, type, route, onRouteClick }: any) => (
  <div className="flex items-center justify-between p-1.5 md:p-2 rounded-xl bg-gray-50 border border-gray-100 hover:border-blue-200 transition-colors">
    <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
      <span className="text-[9px] md:text-[11px] font-black text-gray-800 uppercase line-clamp-1 truncate">{name}</span>
      <div className="flex items-center gap-1 overflow-hidden">
        <span className="text-[7px] md:text-[9px] text-gray-400 whitespace-nowrap">{detail}</span>
        {route && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRouteClick?.(route);
            }}
            className="text-[6px] md:text-[7px] font-black px-1 py-0.5 rounded border uppercase bg-blue-50 text-blue-600 border-blue-100 whitespace-nowrap"
          >
            {route}
          </button>
        )}
      </div>
    </div>
    <span className={`text-[11px] md:text-sm font-black shrink-0 ml-2 ${type === 'best' ? 'text-emerald-600' : 'text-red-600'}`}>{metric}</span>
  </div>
);

export default App;
