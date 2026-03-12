import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../supabase';

interface RouteGroup {
  id: string;
  group_name: string;
  description: string;
  color: string;
}

interface Route {
  id: string;
  name: string;
  route_group: string | null;
  ceps: string[];
  description: string | null;
  is_active: boolean;
}

interface Driver {
  id: number;
  name: string;
  fixed_route: string | null;
  is_active: boolean;
  is_excluded: boolean;
}

interface RouteLink {
  id: string;
  driver_id: number;
  route_id: string;
  is_primary: boolean;
}

interface GroupedData {
  group: RouteGroup | null;
  routes: {
    route: Route;
    drivers: Driver[];
  }[];
}

interface DragPayload {
  type: 'driver' | 'route';
  driverId?: number;
  driverName?: string;
  sourceRouteId?: string;
  routeId?: string;
  routeName?: string;
}

interface RadialMenuState {
  origin: { x: number; y: number };
  driverId: number;
  driverName: string;
  sourceRouteId?: string;
  expandedGroup: string | null;
  hoveredRouteId: string | null;
}

const DRAG_THRESHOLD = 6;
const HOLD_DELAY = 300;

const BancoDeRotas: React.FC = () => {
  const [groups, setGroups] = useState<RouteGroup[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [links, setLinks] = useState<RouteLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterGroup, setFilterGroup] = useState<string>('all');

  const [showNewRouteModal, setShowNewRouteModal] = useState(false);
  const [newRouteName, setNewRouteName] = useState('');
  const [newRouteGroup, setNewRouteGroup] = useState('');
  const [newRouteCeps, setNewRouteCeps] = useState<string[]>([]);
  const [newRouteCepInput, setNewRouteCepInput] = useState('');
  const [newRouteDescription, setNewRouteDescription] = useState('');
  const [savingRoute, setSavingRoute] = useState(false);

  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedDriverIds, setSelectedDriverIds] = useState<Set<number>>(new Set());
  const [savingLinks, setSavingLinks] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');

  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [editName, setEditName] = useState('');
  const [editGroup, setEditGroup] = useState('');
  const [editCeps, setEditCeps] = useState<string[]>([]);
  const [editCepInput, setEditCepInput] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [dragOverRouteId, setDragOverRouteId] = useState<string | null>(null);
  const [dragOverGroupName, setDragOverGroupName] = useState<string | null | undefined>(undefined);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const dragPayloadRef = useRef<DragPayload | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const pendingClickRef = useRef<(() => void) | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFiredRef = useRef(false);

  const [radialMenu, setRadialMenu] = useState<RadialMenuState | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [groupsRes, routesRes, driversRes, linksRes] = await Promise.all([
        supabase.from('route_groups').select('*').order('group_name'),
        supabase.from('routes').select('*').order('name'),
        supabase.from('drivers').select('*').eq('is_excluded', false).eq('is_active', true).order('name'),
        supabase.from('driver_route_links').select('*'),
      ]);
      if (groupsRes.data) setGroups(groupsRes.data);
      if (routesRes.data) setRoutes(routesRes.data);
      if (driversRes.data) setDrivers(driversRes.data);
      if (linksRes.data) setLinks(linksRes.data);
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && radialMenu) setRadialMenu(null);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [radialMenu]);

  const getDropTarget = (x: number, y: number) => {
    if (ghostRef.current) ghostRef.current.style.display = 'none';
    const els = document.elementsFromPoint(x, y);
    if (ghostRef.current) ghostRef.current.style.display = '';
    const routeEl = els.find(el => el.hasAttribute('data-drop-route-id'));
    const groupEl = els.find(el => el.hasAttribute('data-drop-group'));
    return {
      routeId: routeEl?.getAttribute('data-drop-route-id') ?? null,
      groupName: groupEl ? (groupEl.getAttribute('data-drop-group') === '__none__' ? null : groupEl.getAttribute('data-drop-group')) : undefined,
    };
  };

  const linkDriverToRoute = useCallback(async (driverId: number, driverName: string, targetRouteId: string, sourceRouteId?: string) => {
    if (sourceRouteId === targetRouteId) return;
    try {
      if (sourceRouteId) {
        const oldLink = links.find(l => l.driver_id === driverId && l.route_id === sourceRouteId);
        if (oldLink) await supabase.from('driver_route_links').delete().eq('id', oldLink.id);
      }
      const alreadyLinked = links.some(l => l.driver_id === driverId && l.route_id === targetRouteId);
      if (!alreadyLinked) {
        await supabase.from('driver_route_links').insert({ driver_id: driverId, route_id: targetRouteId, is_primary: true });
      }
      const rName = routes.find(r => r.id === targetRouteId)?.name || 'rota';
      showToast(sourceRouteId ? `🔄 ${driverName} movido para ${rName}` : `✅ ${driverName} vinculado a ${rName}`);
      await loadData();
    } catch { showToast('Erro ao vincular motorista', 'error'); }
  }, [links, routes, loadData]);

  const radialPayloadRef = useRef<{ driverId: number; driverName: string; sourceRouteId?: string } | null>(null);

  const onPointerDownDraggable = useCallback((
    e: React.PointerEvent,
    payload: DragPayload,
    label: string,
    onClick?: () => void,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragPayloadRef.current = payload;
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = false;
    pendingClickRef.current = onClick ?? null;
    holdFiredRef.current = false;

    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);

    const isDriver = payload.type === 'driver' && payload.driverId != null;
    const originX = e.clientX;
    const originY = e.clientY;

    if (isDriver && groups.length > 0 && e.pointerType === 'mouse') {
      holdTimerRef.current = setTimeout(() => {
        holdFiredRef.current = true;
        pendingClickRef.current = null;
        radialPayloadRef.current = { driverId: payload.driverId!, driverName: payload.driverName || '', sourceRouteId: payload.sourceRouteId };
        setRadialMenu({
          origin: { x: originX, y: originY },
          driverId: payload.driverId!,
          driverName: payload.driverName || '',
          sourceRouteId: payload.sourceRouteId,
          expandedGroup: null,
          hoveredRouteId: null,
        });
      }, HOLD_DELAY);
    }

    const onMove = (me: PointerEvent) => {
      if (holdFiredRef.current) {
        const els = document.elementsFromPoint(me.clientX, me.clientY);
        const groupEl = els.find(el => el.hasAttribute('data-radial-group'));
        const routeEl = els.find(el => el.hasAttribute('data-radial-route-id'));

        if (groupEl) {
          const gName = groupEl.getAttribute('data-radial-group');
          setRadialMenu(prev => prev ? { ...prev, expandedGroup: gName, hoveredRouteId: null } : null);
        } else if (routeEl) {
          const rId = routeEl.getAttribute('data-radial-route-id');
          setRadialMenu(prev => prev ? { ...prev, hoveredRouteId: rId } : null);
        } else {
          setRadialMenu(prev => prev ? { ...prev, hoveredRouteId: null } : null);
        }
        return;
      }

      const dx = me.clientX - dragStartPosRef.current!.x;
      const dy = me.clientY - dragStartPosRef.current!.y;
      if (!isDraggingRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }

      if (!isDraggingRef.current) {
        isDraggingRef.current = true;
        pendingClickRef.current = null;
        const ghost = document.createElement('div');
        ghost.style.cssText = `position:fixed;pointer-events:none;z-index:9999;padding:8px 14px;background:#3b82f6;color:white;border-radius:10px;font-size:11px;font-weight:800;text-transform:uppercase;opacity:0.92;transform:translate(-50%,-50%);white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,0.25);letter-spacing:0.04em;`;
        ghost.textContent = payload.type === 'driver' ? `✋ ${label}` : `📋 ${label}`;
        document.body.appendChild(ghost);
        ghostRef.current = ghost;
      }

      if (ghostRef.current) {
        ghostRef.current.style.left = `${me.clientX}px`;
        ghostRef.current.style.top = `${me.clientY}px`;
      }

      const { routeId, groupName } = getDropTarget(me.clientX, me.clientY);
      setDragOverRouteId(routeId);
      setDragOverGroupName(groupName);
    };

    const onUp = async (ue: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }

      if (holdFiredRef.current) {
        holdFiredRef.current = false;
        const rp = radialPayloadRef.current;
        radialPayloadRef.current = null;
        dragPayloadRef.current = null;
        dragStartPosRef.current = null;

        const els = document.elementsFromPoint(ue.clientX, ue.clientY);
        const routeEl = els.find(el => el.hasAttribute('data-radial-route-id'));
        setRadialMenu(null);

        if (routeEl && rp) {
          const targetRouteId = routeEl.getAttribute('data-radial-route-id')!;
          await linkDriverToRoute(rp.driverId, rp.driverName, targetRouteId, rp.sourceRouteId);
        }
        return;
      }

      if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }

      if (!isDraggingRef.current) {
        pendingClickRef.current?.();
        pendingClickRef.current = null;
        dragPayloadRef.current = null;
        dragStartPosRef.current = null;
        return;
      }

      isDraggingRef.current = false;
      setDragOverRouteId(null);
      setDragOverGroupName(undefined);

      const { routeId, groupName } = getDropTarget(ue.clientX, ue.clientY);
      const pl = dragPayloadRef.current;
      dragPayloadRef.current = null;
      dragStartPosRef.current = null;
      if (!pl) return;

      if (pl.type === 'driver' && pl.driverId != null && routeId) {
        await linkDriverToRoute(pl.driverId, pl.driverName || '', routeId, pl.sourceRouteId);
      } else if (pl.type === 'route' && pl.routeId && groupName !== undefined) {
        const route = routes.find(r => r.id === pl.routeId);
        if (!route || route.route_group === groupName) return;
        try {
          await supabase.from('routes').update({ route_group: groupName }).eq('id', pl.routeId);
          showToast(`📋 ${pl.routeName} movida para ${groupName ?? 'Sem Grupo'}`);
          await loadData();
        } catch { showToast('Erro ao mover rota', 'error'); }
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [links, routes, groups, loadData, linkDriverToRoute]);


  const groupedData = useMemo(() => {
    const driverMap = new Map<number, Driver>();
    drivers.forEach(d => driverMap.set(d.id, d));

    const linksByRoute = new Map<string, Driver[]>();
    links.forEach(l => {
      const driver = driverMap.get(l.driver_id);
      if (driver) {
        if (!linksByRoute.has(l.route_id)) linksByRoute.set(l.route_id, []);
        linksByRoute.get(l.route_id)!.push(driver);
      }
    });

    const normalizedSearch = searchTerm.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const matchesSearch = (text: string) => {
      if (!normalizedSearch) return true;
      return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(normalizedSearch);
    };

    const filteredRoutes = routes.filter(r => {
      if (filterGroup !== 'all') {
        if (filterGroup === 'none' && r.route_group !== null) return false;
        if (filterGroup !== 'none' && r.route_group !== filterGroup) return false;
      }
      if (!normalizedSearch) return true;
      const routeDrivers = linksByRoute.get(r.id) || [];
      return matchesSearch(r.name) || routeDrivers.some(d => matchesSearch(d.name));
    });

    const filterDriversForRoute = (r: Route) => {
      const all = (linksByRoute.get(r.id) || []).sort((a, b) => a.name.localeCompare(b.name));
      if (!normalizedSearch || matchesSearch(r.name)) return all;
      return all.filter(d => matchesSearch(d.name));
    };

    const result: GroupedData[] = [];

    groups.forEach(group => {
      const groupRoutes = filteredRoutes
        .filter(r => r.route_group === group.group_name)
        .map(r => ({ route: r, drivers: filterDriversForRoute(r) }));
      if (filterGroup === 'all' || filterGroup === group.group_name) {
        result.push({ group, routes: groupRoutes });
      }
    });

    const ungroupedRoutes = filteredRoutes
      .filter(r => !r.route_group || !groups.some(g => g.group_name === r.route_group))
      .map(r => ({ route: r, drivers: filterDriversForRoute(r) }));
    if (ungroupedRoutes.length > 0) {
      result.push({ group: null, routes: ungroupedRoutes });
    }

    return result;
  }, [groups, routes, drivers, links, searchTerm, filterGroup]);

  const unlinkedDrivers = useMemo(() => {
    const linkedIds = new Set(links.map(l => l.driver_id));
    const normalizedSearch = searchTerm.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return drivers.filter(d => {
      if (linkedIds.has(d.id) || d.is_excluded) return false;
      if (normalizedSearch) return d.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(normalizedSearch);
      return true;
    });
  }, [drivers, links, searchTerm]);

  const handleSaveNewRoute = async () => {
    if (!newRouteName.trim()) return;
    setSavingRoute(true);
    try {
      const { error } = await supabase.from('routes').insert({
        name: newRouteName.trim(), route_group: newRouteGroup || null,
        ceps: newRouteCeps, description: newRouteDescription.trim() || null, is_active: true,
      });
      if (error) throw error;
      setShowNewRouteModal(false); setNewRouteName(''); setNewRouteGroup('');
      setNewRouteCeps([]); setNewRouteCepInput(''); setNewRouteDescription('');
      await loadData();
    } catch (err) { console.error(err); } finally { setSavingRoute(false); }
  };

  const handleAddCep = (input: string, setCeps: React.Dispatch<React.SetStateAction<string[]>>, setInput: React.Dispatch<React.SetStateAction<string>>) => {
    const clean = input.replace(/\D/g, '');
    if (clean.length >= 5) { setCeps(prev => [...prev, clean]); setInput(''); }
  };

  const openLinkModal = (route: Route) => {
    setSelectedRoute(route);
    const currentDriverIds = links.filter(l => l.route_id === route.id).map(l => l.driver_id);
    setSelectedDriverIds(new Set(currentDriverIds));
    setLinkSearch(''); setShowLinkModal(true);
  };

  const handleSaveLinks = async () => {
    if (!selectedRoute) return;
    setSavingLinks(true);
    try {
      const currentLinks = links.filter(l => l.route_id === selectedRoute.id);
      const currentIds = new Set(currentLinks.map(l => l.driver_id));
      const toAdd = [...selectedDriverIds].filter(id => !currentIds.has(id));
      const toRemove = currentLinks.filter(l => !selectedDriverIds.has(l.driver_id));
      if (toRemove.length > 0) await supabase.from('driver_route_links').delete().in('id', toRemove.map(l => l.id));
      if (toAdd.length > 0) await supabase.from('driver_route_links').insert(toAdd.map(driverId => ({ driver_id: driverId, route_id: selectedRoute.id, is_primary: true })));
      setShowLinkModal(false); await loadData();
    } catch (err) { console.error(err); } finally { setSavingLinks(false); }
  };

  const openEditModal = (route: Route) => {
    setEditingRoute(route); setEditName(route.name); setEditGroup(route.route_group || '');
    setEditCeps(route.ceps || []); setEditCepInput(''); setEditDescription(route.description || '');
  };

  const handleSaveEdit = async () => {
    if (!editingRoute || !editName.trim()) return;
    setSavingEdit(true);
    try {
      const { error } = await supabase.from('routes').update({
        name: editName.trim(), route_group: editGroup || null, ceps: editCeps, description: editDescription.trim() || null,
      }).eq('id', editingRoute.id);
      if (error) throw error;
      setEditingRoute(null); await loadData();
    } catch (err) { console.error(err); } finally { setSavingEdit(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
          <p className="text-sm font-black text-gray-400 uppercase tracking-wider">Carregando rotas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-8 space-y-6 select-none">
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[300] px-5 py-3 rounded-2xl shadow-xl text-sm font-bold text-white transition-all duration-300 ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-[#1e3a8a] uppercase tracking-tight flex items-center gap-2">
            <span className="p-1.5 bg-blue-50 rounded-lg text-lg">🗺️</span>
            Banco de Rotas
          </h1>
          <p className="text-[10px] md:text-xs text-gray-400 font-bold uppercase mt-1">
            {routes.length} rotas · {drivers.length} motoristas · {links.length} vínculos
            <span className="ml-2 text-violet-400">· segure para atalho · arraste para vincular</span>
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            placeholder="Buscar rota ou motorista..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20 w-full sm:w-56"
          />
          <select
            value={filterGroup}
            onChange={e => setFilterGroup(e.target.value)}
            className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all">Todos os Grupos</option>
            {groups.map(g => <option key={g.id} value={g.group_name}>{g.group_name}</option>)}
            <option value="none">Sem Grupo</option>
          </select>
          <button
            onClick={() => setShowNewRouteModal(true)}
            className="px-5 py-2.5 bg-[#3b82f6] text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-md hover:bg-blue-700 transition-all active:scale-95"
          >
            + Nova Rota
          </button>
        </div>
      </div>

      {unlinkedDrivers.length > 0 && (
        <div className="bg-amber-50 rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
          <div className="p-4 md:p-5 bg-amber-100 border-b border-amber-200">
            <h3 className="text-sm font-black text-amber-700 uppercase tracking-tight flex items-center gap-2">
              <span className="animate-pulse">⏳</span>
              Motoristas Aguardando Vinculação ({unlinkedDrivers.length})
              <span className="text-[10px] font-normal text-amber-500 normal-case ml-1">— segure para atalho ou arraste até uma rota</span>
            </h3>
          </div>
          <div className="p-4 md:p-5 flex flex-wrap gap-2">
            {unlinkedDrivers.map(d => (
              <div
                key={d.id}
                onPointerDown={e => onPointerDownDraggable(e, { type: 'driver', driverId: d.id, driverName: d.name }, d.name)}
                className="px-3 py-1.5 bg-white border-2 border-amber-300 rounded-lg text-[10px] md:text-xs font-bold text-amber-800 uppercase cursor-grab active:cursor-grabbing hover:bg-amber-50 hover:shadow-md transition-all touch-none"
                title="Segure para atalho · Arraste para vincular"
              >
                ✋ {d.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {groupedData.map((gd, gIdx) => (
        <GroupSection
          key={gIdx}
          group={gd.group}
          routes={gd.routes}
          onRouteClick={openLinkModal}
          onEditRoute={openEditModal}
          dragOverRouteId={dragOverRouteId}
          dragOverGroupName={dragOverGroupName}
          onPointerDownDraggable={onPointerDownDraggable}
        />
      ))}

      {radialMenu && (
        <RadialMenu
          menu={radialMenu}
          groups={groups}
          routes={routes}
        />
      )}

      {showNewRouteModal && (
        <Modal onClose={() => setShowNewRouteModal(false)} title="Nova Rota">
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">Nome da Rota</label>
              <input autoFocus type="text" value={newRouteName} onChange={e => setNewRouteName(e.target.value)} placeholder="Ex: Caratinga, MG"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">Grupo</label>
              <select value={newRouteGroup} onChange={e => setNewRouteGroup(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20">
                <option value="">Sem grupo</option>
                {groups.map(g => <option key={g.id} value={g.group_name}>{g.group_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">CEPs</label>
              <div className="flex gap-2">
                <input type="text" value={newRouteCepInput} onChange={e => setNewRouteCepInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCep(newRouteCepInput, setNewRouteCeps, setNewRouteCepInput); }}}
                  placeholder="Digite o CEP e pressione Enter"
                  className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20" />
                <button onClick={() => handleAddCep(newRouteCepInput, setNewRouteCeps, setNewRouteCepInput)}
                  className="px-4 py-2.5 bg-blue-100 text-blue-700 rounded-xl text-xs font-black hover:bg-blue-200 transition-all">+</button>
              </div>
              {newRouteCeps.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {newRouteCeps.map((cep, i) => (
                    <span key={i} className="px-2 py-1 bg-blue-50 border border-blue-100 rounded-lg text-[10px] font-bold text-blue-700 flex items-center gap-1">
                      {cep}<button onClick={() => setNewRouteCeps(prev => prev.filter((_, idx) => idx !== i))} className="text-blue-400 hover:text-red-500 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">Descrição (opcional)</label>
              <textarea value={newRouteDescription} onChange={e => setNewRouteDescription(e.target.value)} rows={2}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20 resize-none" />
            </div>
            <button onClick={handleSaveNewRoute} disabled={savingRoute || !newRouteName.trim()}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg disabled:opacity-50 hover:bg-blue-700 transition-all active:scale-95">
              {savingRoute ? 'Salvando...' : 'Criar Rota'}
            </button>
          </div>
        </Modal>
      )}

      {showLinkModal && selectedRoute && (
        <Modal onClose={() => setShowLinkModal(false)} title={`Motoristas → ${selectedRoute.name}`}>
          <div className="space-y-4">
            <input type="text" value={linkSearch} onChange={e => setLinkSearch(e.target.value)} placeholder="Buscar motorista..."
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20" />
            <div className="max-h-[50vh] overflow-y-auto space-y-1.5 pr-1">
              {drivers.filter(d => !d.is_excluded && d.name.toLowerCase().includes(linkSearch.toLowerCase())).map(d => (
                <label key={d.id} className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all ${selectedDriverIds.has(d.id) ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-100 hover:border-gray-200'}`}>
                  <input type="checkbox" checked={selectedDriverIds.has(d.id)}
                    onChange={() => setSelectedDriverIds(prev => { const next = new Set(prev); if (next.has(d.id)) next.delete(d.id); else next.add(d.id); return next; })}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-xs font-bold text-gray-700 uppercase">{d.name}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-gray-400">{selectedDriverIds.size} selecionados</span>
              <button onClick={handleSaveLinks} disabled={savingLinks}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg disabled:opacity-50 hover:bg-blue-700 transition-all active:scale-95">
                {savingLinks ? 'Salvando...' : 'Salvar Vínculos'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editingRoute && (
        <Modal onClose={() => setEditingRoute(null)} title={`Editar: ${editingRoute.name}`}>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">Nome da Rota</label>
              <input autoFocus type="text" value={editName} onChange={e => setEditName(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">Grupo</label>
              <select value={editGroup} onChange={e => setEditGroup(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20">
                <option value="">Sem grupo</option>
                {groups.map(g => <option key={g.id} value={g.group_name}>{g.group_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">CEPs</label>
              <div className="flex gap-2">
                <input type="text" value={editCepInput} onChange={e => setEditCepInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCep(editCepInput, setEditCeps, setEditCepInput); }}}
                  placeholder="Digite o CEP e pressione Enter"
                  className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20" />
                <button onClick={() => handleAddCep(editCepInput, setEditCeps, setEditCepInput)}
                  className="px-4 py-2.5 bg-blue-100 text-blue-700 rounded-xl text-xs font-black hover:bg-blue-200 transition-all">+</button>
              </div>
              {editCeps.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {editCeps.map((cep, i) => (
                    <span key={i} className="px-2 py-1 bg-blue-50 border border-blue-100 rounded-lg text-[10px] font-bold text-blue-700 flex items-center gap-1">
                      {cep}<button onClick={() => setEditCeps(prev => prev.filter((_, idx) => idx !== i))} className="text-blue-400 hover:text-red-500 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">Descrição (opcional)</label>
              <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={2}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20 resize-none" />
            </div>
            <button onClick={handleSaveEdit} disabled={savingEdit || !editName.trim()}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg disabled:opacity-50 hover:bg-blue-700 transition-all active:scale-95">
              {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

const RadialMenu: React.FC<{
  menu: RadialMenuState;
  groups: RouteGroup[];
  routes: Route[];
}> = ({ menu, groups, routes }) => {
  const BUBBLE_RADIUS = 100;

  const groupBubbles = useMemo(() => {
    const n = groups.length;
    if (n === 0) return [];
    const startAngle = Math.PI * 0.3;
    const endAngle = Math.PI * 0.7;
    const step = n > 1 ? (endAngle - startAngle) / (n - 1) : 0;
    return groups.map((g, i) => {
      const angle = n > 1 ? startAngle + step * i : Math.PI * 0.5;
      const x = Math.cos(angle) * BUBBLE_RADIUS;
      const y = Math.sin(angle) * BUBBLE_RADIUS;
      const groupRoutes = routes.filter(r => r.route_group === g.group_name).sort((a, b) => a.name.localeCompare(b.name));
      return { group: g, x, y, routes: groupRoutes };
    });
  }, [groups, routes]);

  const clampedOrigin = useMemo(() => {
    const pad = 200;
    return {
      x: Math.max(pad, Math.min(window.innerWidth - pad, menu.origin.x)),
      y: Math.max(60, Math.min(window.innerHeight - 250, menu.origin.y)),
    };
  }, [menu.origin]);

  return (
    <div
      className="fixed inset-0 z-[250] pointer-events-none"
      style={{ background: 'radial-gradient(circle at center, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.4) 100%)', animation: 'radialFadeIn 200ms ease-out' }}
    >
      <style>{`
        @keyframes radialFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes radialBubblePop { from { opacity: 0; transform: translate(-50%, -50%) scale(0.6); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      `}</style>
      <div
        className="absolute text-center pointer-events-none"
        style={{ left: clampedOrigin.x, top: clampedOrigin.y, transform: 'translate(-50%, -50%)' }}
      >
        <div className="px-4 py-2 bg-white/95 backdrop-blur rounded-xl shadow-lg border border-gray-200 inline-block">
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-wide">Vincular: {menu.driverName}</p>
          <p className="text-[8px] font-bold text-gray-400 mt-0.5">Arraste até o grupo e solte na rota</p>
        </div>
      </div>

      {groupBubbles.map(({ group, x, y, routes: groupRoutes }, idx) => {
        const isExpanded = menu.expandedGroup === group.group_name;
        const isOther = menu.expandedGroup !== null && !isExpanded;
        const bx = clampedOrigin.x + x;
        const by = clampedOrigin.y + y + 50;

        return (
          <div key={group.id} style={{ position: 'absolute', left: bx, top: by, transform: 'translate(-50%, -50%)', zIndex: isExpanded ? 10 : 5, animation: `radialBubblePop 250ms ease-out ${idx * 60}ms both` }}>
            <div
              data-radial-group={group.group_name}
              className="flex flex-col items-center justify-center rounded-full transition-all duration-300 border-2 shadow-lg pointer-events-auto"
              style={{
                width: isExpanded ? 90 : 80,
                height: isExpanded ? 90 : 80,
                backgroundColor: group.color,
                borderColor: `${group.color}cc`,
                opacity: isOther ? 0.4 : 1,
                transform: `scale(${isOther ? 0.85 : 1})`,
              }}
            >
              <span className="text-white font-black text-[11px] md:text-xs uppercase tracking-tight text-center px-1 leading-tight pointer-events-none">
                {group.group_name}
              </span>
              <span className="text-white/70 text-[8px] font-bold mt-0.5 pointer-events-none">{groupRoutes.length} rotas</span>
            </div>

            {isExpanded && groupRoutes.length > 0 && (
              <div
                className="absolute left-1/2 -translate-x-1/2 mt-3 bg-white rounded-2xl shadow-2xl border overflow-hidden min-w-[180px] max-w-[260px] max-h-[220px] overflow-y-auto pointer-events-auto"
                style={{ borderColor: `${group.color}40`, top: '100%' }}
              >
                <div className="p-2 border-b text-center pointer-events-none" style={{ backgroundColor: `${group.color}15`, borderColor: `${group.color}30` }}>
                  <p className="text-[9px] font-black uppercase" style={{ color: group.color }}>{group.group_name}</p>
                </div>
                <div className="p-2 space-y-1">
                  {groupRoutes.map(r => (
                    <div
                      key={r.id}
                      data-radial-route-id={r.id}
                      className={`w-full text-left px-3 py-2 rounded-lg text-[10px] md:text-xs font-bold uppercase transition-all border pointer-events-auto ${
                        menu.hoveredRouteId === r.id
                          ? 'shadow-md scale-[1.02]'
                          : 'bg-white border-gray-100'
                      }`}
                      style={menu.hoveredRouteId === r.id ? { backgroundColor: `${group.color}15`, borderColor: `${group.color}50`, color: group.color } : { color: '#374151' }}
                    >
                      {r.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {isExpanded && groupRoutes.length === 0 && (
              <div className="absolute left-1/2 -translate-x-1/2 mt-3 bg-white rounded-xl shadow-lg border border-gray-200 px-4 py-3 pointer-events-none" style={{ top: '100%' }}>
                <p className="text-[10px] font-bold text-gray-400 italic whitespace-nowrap">Nenhuma rota neste grupo</p>
              </div>
            )}
          </div>
        );
      })}

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2 bg-white/90 backdrop-blur rounded-xl shadow-lg pointer-events-none">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Solte em área vazia para cancelar · ESC para fechar</p>
      </div>
    </div>
  );
};

const Modal: React.FC<{ onClose: () => void; title: string; children: React.ReactNode }> = ({ onClose, title, children }) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
    <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-black text-gray-800 uppercase tracking-tight">{title}</h2>
        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-all text-lg">✕</button>
      </div>
      {children}
    </div>
  </div>
);

const GroupSection: React.FC<{
  group: RouteGroup | null;
  routes: { route: Route; drivers: Driver[] }[];
  onRouteClick: (route: Route) => void;
  onEditRoute: (route: Route) => void;
  dragOverRouteId: string | null;
  dragOverGroupName: string | null | undefined;
  onPointerDownDraggable: (e: React.PointerEvent, payload: DragPayload, label: string, onClick?: () => void) => void;
}> = ({ group, routes, onRouteClick, onEditRoute, dragOverRouteId, dragOverGroupName, onPointerDownDraggable }) => {
  const color = group?.color || '#94a3b8';
  const groupName = group?.group_name || 'Sem Grupo Definido';
  const groupKey = group?.group_name ?? null;
  const dropGroupAttr = groupKey ?? '__none__';
  const isGroupHovered = dragOverGroupName === groupKey;

  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border overflow-hidden transition-all duration-150 ${isGroupHovered ? 'ring-2 ring-offset-1' : ''}`}
      style={{ borderColor: isGroupHovered ? color : `${color}40`, ...(isGroupHovered ? { '--tw-ring-color': color } as any : {}) }}
    >
      <div
        data-drop-group={dropGroupAttr}
        className={`p-4 md:p-5 border-b flex items-center gap-3 transition-all ${isGroupHovered ? 'opacity-90' : ''}`}
        style={{ backgroundColor: isGroupHovered ? `${color}25` : `${color}10`, borderColor: `${color}30` }}
      >
        <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: color }}></div>
        <h3 className="text-sm md:text-base font-black uppercase tracking-tight" style={{ color }}>{groupName}</h3>
        <span className="text-[10px] font-bold text-gray-400 uppercase">{routes.length} rotas</span>
        {isGroupHovered && (
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: color }}>
            Solte aqui para mover rota
          </span>
        )}
      </div>

      <div className="p-4 md:p-6 space-y-4" data-drop-group={dropGroupAttr}>
        {routes.length === 0 && (
          <div
            data-drop-group={dropGroupAttr}
            className={`py-6 text-center rounded-xl border-2 border-dashed transition-all ${isGroupHovered ? 'border-opacity-60' : 'border-gray-200'}`}
            style={isGroupHovered ? { borderColor: color } : {}}
          >
            <p className="text-xs font-bold text-gray-300 uppercase italic">
              {isGroupHovered ? 'Solte para mover rota aqui' : 'Nenhuma rota neste grupo'}
            </p>
          </div>
        )}
        {routes.map(({ route, drivers: routeDrivers }) => (
          <WorkflowRow
            key={route.id}
            route={route}
            drivers={routeDrivers}
            color={color}
            onRouteClick={onRouteClick}
            onEditRoute={onEditRoute}
            isDragOver={dragOverRouteId === route.id}
            onPointerDownDraggable={onPointerDownDraggable}
          />
        ))}
      </div>
    </div>
  );
};

const WorkflowRow: React.FC<{
  route: Route;
  drivers: Driver[];
  color: string;
  onRouteClick: (route: Route) => void;
  onEditRoute: (route: Route) => void;
  isDragOver: boolean;
  onPointerDownDraggable: (e: React.PointerEvent, payload: DragPayload, label: string, onClick?: () => void) => void;
}> = ({ route, drivers, color, onRouteClick, onEditRoute, isDragOver, onPointerDownDraggable }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const routeRef = useRef<HTMLDivElement>(null);
  const driverRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);

  useEffect(() => {
    const updateLines = () => {
      if (!containerRef.current || !routeRef.current || drivers.length === 0) { setLines([]); return; }
      const containerRect = containerRef.current.getBoundingClientRect();
      const routeRect = routeRef.current.getBoundingClientRect();
      const newLines = driverRefs.current.filter(Boolean).map(driverEl => {
        const driverRect = driverEl!.getBoundingClientRect();
        return {
          x1: routeRect.right - containerRect.left,
          y1: routeRect.top + routeRect.height / 2 - containerRect.top,
          x2: driverRect.left - containerRect.left,
          y2: driverRect.top + driverRect.height / 2 - containerRect.top,
        };
      });
      setLines(newLines);
    };
    updateLines();
    window.addEventListener('resize', updateLines);
    return () => window.removeEventListener('resize', updateLines);
  }, [drivers]);

  return (
    <div ref={containerRef} className="relative flex items-start gap-8 md:gap-16 min-h-[60px]">
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
        {lines.map((l, i) => (
          <path key={i}
            d={`M ${l.x1} ${l.y1} C ${l.x1 + (l.x2 - l.x1) * 0.5} ${l.y1}, ${l.x1 + (l.x2 - l.x1) * 0.5} ${l.y2}, ${l.x2} ${l.y2}`}
            fill="none" stroke={color} strokeWidth="2" strokeOpacity="0.35" />
        ))}
      </svg>

      <div
        ref={routeRef}
        data-drop-route-id={route.id}
        onPointerDown={e => onPointerDownDraggable(
          e, { type: 'route', routeId: route.id, routeName: route.name }, route.name, () => onRouteClick(route),
        )}
        className={`relative z-10 shrink-0 w-48 md:w-56 p-3 md:p-4 rounded-xl border-2 bg-white shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-all group touch-none ${isDragOver ? 'ring-2 ring-offset-1 scale-105' : ''}`}
        style={{
          borderColor: isDragOver ? color : `${color}60`,
          backgroundColor: isDragOver ? `${color}15` : 'white',
          ...(isDragOver ? { '--tw-ring-color': color } as any : {})
        }}
        title="Arraste para mover de grupo · Clique para gerenciar motoristas"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs md:text-sm font-black text-gray-800 uppercase truncate">{route.name}</p>
            {route.ceps && route.ceps.length > 0 && (
              <p className="text-[9px] md:text-[10px] text-gray-400 font-bold mt-1 truncate">{route.ceps.join(', ')}</p>
            )}
          </div>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onEditRoute(route); }}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-blue-600 transition-all text-xs"
            title="Editar rota"
          >✏️</button>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }}></div>
          <span className="text-[8px] md:text-[9px] font-bold text-gray-400 uppercase">
            {isDragOver ? '⬇ Solte aqui' : `${drivers.length} motorista${drivers.length !== 1 ? 's' : ''}`}
          </span>
        </div>
      </div>

      <div className="relative z-10 flex flex-col gap-1.5 flex-1 pt-1" data-drop-route-id={route.id}>
        {drivers.length === 0 ? (
          <div
            data-drop-route-id={route.id}
            className={`px-3 py-4 rounded-lg border-2 border-dashed transition-all ${isDragOver ? 'border-opacity-80 bg-opacity-10' : 'border-gray-200'}`}
            style={isDragOver ? { borderColor: color, backgroundColor: `${color}10` } : {}}
          >
            <span className="text-[10px] text-gray-400 font-bold italic">
              {isDragOver ? '⬇ Solte o motorista aqui' : 'Nenhum motorista vinculado'}
            </span>
          </div>
        ) : (
          drivers.map((d, i) => (
            <div
              key={d.id}
              ref={el => { driverRefs.current[i] = el; }}
              onPointerDown={e => onPointerDownDraggable(
                e, { type: 'driver', driverId: d.id, driverName: d.name, sourceRouteId: route.id }, d.name,
              )}
              className="px-3 py-2 bg-white border rounded-lg shadow-sm hover:shadow cursor-grab active:cursor-grabbing transition-all touch-none"
              style={{ borderColor: `${color}30` }}
              title="Segure para atalho · Arraste para mover"
            >
              <span className="text-[10px] md:text-xs font-bold text-gray-700 uppercase">{d.name}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default BancoDeRotas;
