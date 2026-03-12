import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import BancoDeRotas from './pages/BancoDeRotas';
import AIAssistant from './components/AIAssistant';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#f8fafc]">
        <Header />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/banco-de-rotas" element={<BancoDeRotas />} />
        </Routes>
        <AIAssistant />
      </div>
    </BrowserRouter>
  );
};

export default App;
