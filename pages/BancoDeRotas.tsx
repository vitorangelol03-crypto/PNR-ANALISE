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
      const routeMatch = matchesSearch(r.name);
      const routeDrivers = linksByRoute.get(r.id) || [];
      const driverMatch = routeDrivers.some(d => matchesSearch(d.name));
      return routeMatch || driverMatch;
    });

    const result: GroupedData[] = [];

    const filterDriversForRoute = (r: Route) => {
      const allDrivers = (linksByRoute.get(r.id) || []).sort((a, b) => a.name.localeCompare(b.name));
      if (!normalizedSearch || matchesSearch(r.name)) return allDrivers;
      return allDrivers.filter(d => matchesSearch(d.name));
    };

    groups.forEach(group => {
      const groupRoutes = filteredRoutes
        .filter(r => r.route_group === group.group_name)
        .map(r => ({
          route: r,
          drivers: filterDriversForRoute(r),
        }));
      if (filterGroup === 'all' || filterGroup === group.group_name) {
        result.push({ group, routes: groupRoutes });
      }
    });

    const ungroupedRoutes = filteredRoutes
      .filter(r => !r.route_group || !groups.some(g => g.group_name === r.route_group))
      .map(r => ({
        route: r,
        drivers: filterDriversForRoute(r),
      }));
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
      if (normalizedSearch) {
        return d.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(normalizedSearch);
      }
      return true;
    });
  }, [drivers, links, searchTerm]);

  const handleSaveNewRoute = async () => {
    if (!newRouteName.trim()) return;
    setSavingRoute(true);
    try {
      const { error } = await supabase.from('routes').insert({
        name: newRouteName.trim(),
        route_group: newRouteGroup || null,
        ceps: newRouteCeps,
        description: newRouteDescription.trim() || null,
        is_active: true,
      });
      if (error) throw error;
      setShowNewRouteModal(false);
      setNewRouteName('');
      setNewRouteGroup('');
      setNewRouteCeps([]);
      setNewRouteCepInput('');
      setNewRouteDescription('');
      await loadData();
    } catch (err) {
      console.error('Erro ao criar rota:', err);
    } finally {
      setSavingRoute(false);
    }
  };

  const handleAddCep = (input: string, setCeps: React.Dispatch<React.SetStateAction<string[]>>, setInput: React.Dispatch<React.SetStateAction<string>>) => {
    const clean = input.replace(/\D/g, '');
    if (clean.length >= 5) {
      setCeps(prev => [...prev, clean]);
      setInput('');
    }
  };

  const openLinkModal = (route: Route) => {
    setSelectedRoute(route);
    const currentDriverIds = links.filter(l => l.route_id === route.id).map(l => l.driver_id);
    setSelectedDriverIds(new Set(currentDriverIds));
    setLinkSearch('');
    setShowLinkModal(true);
  };

  const handleSaveLinks = async () => {
    if (!selectedRoute) return;
    setSavingLinks(true);
    try {
      const currentLinks = links.filter(l => l.route_id === selectedRoute.id);
      const currentIds = new Set(currentLinks.map(l => l.driver_id));

      const toAdd = [...selectedDriverIds].filter(id => !currentIds.has(id));
      const toRemove = currentLinks.filter(l => !selectedDriverIds.has(l.driver_id));

      if (toRemove.length > 0) {
        await supabase.from('driver_route_links').delete().in('id', toRemove.map(l => l.id));
      }
      if (toAdd.length > 0) {
        await supabase.from('driver_route_links').insert(
          toAdd.map(driverId => ({
            driver_id: driverId,
            route_id: selectedRoute.id,
            is_primary: true,
          }))
        );
      }

      setShowLinkModal(false);
      await loadData();
    } catch (err) {
      console.error('Erro ao salvar vínculos:', err);
    } finally {
      setSavingLinks(false);
    }
  };

  const openEditModal = (route: Route) => {
    setEditingRoute(route);
    setEditName(route.name);
    setEditGroup(route.route_group || '');
    setEditCeps(route.ceps || []);
    setEditCepInput('');
    setEditDescription(route.description || '');
  };

  const handleSaveEdit = async () => {
    if (!editingRoute || !editName.trim()) return;
    setSavingEdit(true);
    try {
      const { error } = await supabase.from('routes').update({
        name: editName.trim(),
        route_group: editGroup || null,
        ceps: editCeps,
        description: editDescription.trim() || null,
      }).eq('id', editingRoute.id);
      if (error) throw error;
      setEditingRoute(null);
      await loadData();
    } catch (err) {
      console.error('Erro ao editar rota:', err);
    } finally {
      setSavingEdit(false);
    }
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
    <div className="max-w-[1400px] mx-auto p-4 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-[#1e3a8a] uppercase tracking-tight flex items-center gap-2">
            <span className="p-1.5 bg-blue-50 rounded-lg text-lg">🗺️</span>
            Banco de Rotas
          </h1>
          <p className="text-[10px] md:text-xs text-gray-400 font-bold uppercase mt-1">
            {routes.length} rotas · {drivers.length} motoristas · {links.length} vínculos
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
            {groups.map(g => (
              <option key={g.id} value={g.group_name}>{g.group_name}</option>
            ))}
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

      {groupedData.map((gd, gIdx) => (
        <GroupSection
          key={gIdx}
          group={gd.group}
          routes={gd.routes}
          onRouteClick={openLinkModal}
          onEditRoute={openEditModal}
        />
      ))}

      {unlinkedDrivers.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 md:p-5 bg-gray-100 border-b border-gray-200">
            <h3 className="text-sm font-black text-gray-600 uppercase tracking-tight flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-gray-400"></span>
              Motoristas sem Rota ({unlinkedDrivers.length})
            </h3>
          </div>
          <div className="p-4 md:p-5 flex flex-wrap gap-2">
            {unlinkedDrivers.map(d => (
              <span key={d.id} className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-[10px] md:text-xs font-bold text-gray-600 uppercase">
                {d.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {showNewRouteModal && (
        <Modal onClose={() => setShowNewRouteModal(false)} title="Nova Rota">
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">Nome da Rota</label>
              <input
                autoFocus
                type="text"
                value={newRouteName}
                onChange={e => setNewRouteName(e.target.value)}
                placeholder="Ex: Caratinga, MG"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">Grupo</label>
              <select
                value={newRouteGroup}
                onChange={e => setNewRouteGroup(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">Sem grupo</option>
                {groups.map(g => (
                  <option key={g.id} value={g.group_name}>{g.group_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">CEPs</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newRouteCepInput}
                  onChange={e => setNewRouteCepInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCep(newRouteCepInput, setNewRouteCeps, setNewRouteCepInput); }}}
                  placeholder="Digite o CEP e pressione Enter"
                  className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <button
                  onClick={() => handleAddCep(newRouteCepInput, setNewRouteCeps, setNewRouteCepInput)}
                  className="px-4 py-2.5 bg-blue-100 text-blue-700 rounded-xl text-xs font-black hover:bg-blue-200 transition-all"
                >
                  +
                </button>
              </div>
              {newRouteCeps.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {newRouteCeps.map((cep, i) => (
                    <span key={i} className="px-2 py-1 bg-blue-50 border border-blue-100 rounded-lg text-[10px] font-bold text-blue-700 flex items-center gap-1">
                      {cep}
                      <button onClick={() => setNewRouteCeps(prev => prev.filter((_, idx) => idx !== i))} className="text-blue-400 hover:text-red-500 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">Descrição (opcional)</label>
              <textarea
                value={newRouteDescription}
                onChange={e => setNewRouteDescription(e.target.value)}
                placeholder="Descrição da rota..."
                rows={2}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
              />
            </div>
            <button
              onClick={handleSaveNewRoute}
              disabled={savingRoute || !newRouteName.trim()}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg disabled:opacity-50 hover:bg-blue-700 transition-all active:scale-95"
            >
              {savingRoute ? 'Salvando...' : 'Criar Rota'}
            </button>
          </div>
        </Modal>
      )}

      {showLinkModal && selectedRoute && (
        <Modal onClose={() => setShowLinkModal(false)} title={`Motoristas → ${selectedRoute.name}`}>
          <div className="space-y-4">
            <input
              type="text"
              value={linkSearch}
              onChange={e => setLinkSearch(e.target.value)}
              placeholder="Buscar motorista..."
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <div className="max-h-[50vh] overflow-y-auto space-y-1.5 pr-1">
              {drivers
                .filter(d => !d.is_excluded && d.name.toLowerCase().includes(linkSearch.toLowerCase()))
                .map(d => (
                  <label key={d.id} className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all ${selectedDriverIds.has(d.id) ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-100 hover:border-gray-200'}`}>
                    <input
                      type="checkbox"
                      checked={selectedDriverIds.has(d.id)}
                      onChange={() => {
                        setSelectedDriverIds(prev => {
                          const next = new Set(prev);
                          if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                          return next;
                        });
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs font-bold text-gray-700 uppercase">{d.name}</span>
                  </label>
                ))}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-gray-400">{selectedDriverIds.size} selecionados</span>
              <button
                onClick={handleSaveLinks}
                disabled={savingLinks}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg disabled:opacity-50 hover:bg-blue-700 transition-all active:scale-95"
              >
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
              <input
                autoFocus
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">Grupo</label>
              <select
                value={editGroup}
                onChange={e => setEditGroup(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">Sem grupo</option>
                {groups.map(g => (
                  <option key={g.id} value={g.group_name}>{g.group_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">CEPs</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editCepInput}
                  onChange={e => setEditCepInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCep(editCepInput, setEditCeps, setEditCepInput); }}}
                  placeholder="Digite o CEP e pressione Enter"
                  className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <button
                  onClick={() => handleAddCep(editCepInput, setEditCeps, setEditCepInput)}
                  className="px-4 py-2.5 bg-blue-100 text-blue-700 rounded-xl text-xs font-black hover:bg-blue-200 transition-all"
                >
                  +
                </button>
              </div>
              {editCeps.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {editCeps.map((cep, i) => (
                    <span key={i} className="px-2 py-1 bg-blue-50 border border-blue-100 rounded-lg text-[10px] font-bold text-blue-700 flex items-center gap-1">
                      {cep}
                      <button onClick={() => setEditCeps(prev => prev.filter((_, idx) => idx !== i))} className="text-blue-400 hover:text-red-500 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase mb-1 block">Descrição (opcional)</label>
              <textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                rows={2}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
              />
            </div>
            <button
              onClick={handleSaveEdit}
              disabled={savingEdit || !editName.trim()}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg disabled:opacity-50 hover:bg-blue-700 transition-all active:scale-95"
            >
              {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

const Modal: React.FC<{ onClose: () => void; title: string; children: React.ReactNode }> = ({ onClose, title, children }) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
    <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl scale-in-center max-h-[90vh] overflow-y-auto">
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
}> = ({ group, routes, onRouteClick, onEditRoute }) => {
  const color = group?.color || '#94a3b8';
  const groupName = group?.group_name || 'Sem Grupo Definido';

  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: `${color}40` }}>
      <div className="p-4 md:p-5 border-b flex items-center gap-3" style={{ backgroundColor: `${color}10`, borderColor: `${color}30` }}>
        <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: color }}></div>
        <h3 className="text-sm md:text-base font-black uppercase tracking-tight" style={{ color }}>
          {groupName}
        </h3>
        <span className="text-[10px] font-bold text-gray-400 uppercase">{routes.length} rotas</span>
      </div>

      <div className="p-4 md:p-6 space-y-4">
        {routes.length === 0 && (
          <div className="py-6 text-center">
            <p className="text-xs font-bold text-gray-300 uppercase italic">Nenhuma rota neste grupo</p>
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
}> = ({ route, drivers, color, onRouteClick, onEditRoute }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const routeRef = useRef<HTMLDivElement>(null);
  const driverRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);

  useEffect(() => {
    const updateLines = () => {
      if (!containerRef.current || !routeRef.current || drivers.length === 0) {
        setLines([]);
        return;
      }
      const containerRect = containerRef.current.getBoundingClientRect();
      const routeRect = routeRef.current.getBoundingClientRect();

      const newLines = driverRefs.current
        .filter(Boolean)
        .map(driverEl => {
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
          <path
            key={i}
            d={`M ${l.x1} ${l.y1} C ${l.x1 + (l.x2 - l.x1) * 0.5} ${l.y1}, ${l.x1 + (l.x2 - l.x1) * 0.5} ${l.y2}, ${l.x2} ${l.y2}`}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeOpacity="0.35"
          />
        ))}
      </svg>

      <div
        ref={routeRef}
        className="relative z-10 shrink-0 w-48 md:w-56 p-3 md:p-4 rounded-xl border-2 bg-white shadow-sm cursor-pointer hover:shadow-md transition-all group"
        style={{ borderColor: `${color}60` }}
        onClick={() => onRouteClick(route)}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs md:text-sm font-black text-gray-800 uppercase truncate">{route.name}</p>
            {route.ceps && route.ceps.length > 0 && (
              <p className="text-[9px] md:text-[10px] text-gray-400 font-bold mt-1 truncate">
                {route.ceps.join(', ')}
              </p>
            )}
          </div>
          <button
            onClick={e => { e.stopPropagation(); onEditRoute(route); }}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-blue-600 transition-all text-xs"
            title="Editar rota"
          >
            ✏️
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }}></div>
          <span className="text-[8px] md:text-[9px] font-bold text-gray-400 uppercase">{drivers.length} motorista{drivers.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className="relative z-10 flex flex-col gap-1.5 flex-1 pt-1">
        {drivers.length === 0 ? (
          <div className="px-3 py-2 bg-gray-50 border border-dashed border-gray-200 rounded-lg">
            <span className="text-[10px] text-gray-400 font-bold italic">Nenhum motorista vinculado</span>
          </div>
        ) : (
          drivers.map((d, i) => (
            <div
              key={d.id}
              ref={el => { driverRefs.current[i] = el; }}
              className="px-3 py-2 bg-white border rounded-lg shadow-sm hover:shadow transition-all"
              style={{ borderColor: `${color}30` }}
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
