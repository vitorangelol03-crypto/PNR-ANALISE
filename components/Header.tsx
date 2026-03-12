import React from 'react';
import { NavLink } from 'react-router-dom';

const Header: React.FC = () => {
  const linkBase = "px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider transition-all duration-200";
  const activeClass = "bg-white text-[#1e3a8a] shadow-md";
  const inactiveClass = "text-white/70 hover:text-white hover:bg-white/10";

  return (
    <nav className="header-gradient sticky top-0 z-50 shadow-lg">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl md:text-2xl">🚀</span>
          <span className="text-white font-black text-sm md:text-lg tracking-tight uppercase">IHS Dashboard</span>
        </div>
        <div className="flex items-center gap-2">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `${linkBase} ${isActive ? activeClass : inactiveClass}`}
          >
            📊 Dashboard
          </NavLink>
          <NavLink
            to="/banco-de-rotas"
            className={({ isActive }) => `${linkBase} ${isActive ? activeClass : inactiveClass}`}
          >
            🗺️ Banco de Rotas
          </NavLink>
        </div>
      </div>
    </nav>
  );
};

export default Header;
