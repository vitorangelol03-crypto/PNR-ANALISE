import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  queryGeminiStream,
  saveToSearchHistory,
  saveAIReport,
  getRecentSearches,
  getFrequentSearches,
  clearSearchHistory,
  getAutocompleteSuggestions,
} from '../services/gemini';

interface SearchHistoryItem {
  id: number;
  query: string;
  results_count: number;
  source: string;
  created_at: string;
}

interface FrequentSearch {
  query: string;
  count: number;
}

const AIAssistant: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [currentQuery, setCurrentQuery] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [savedReport, setSavedReport] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [recentSearches, setRecentSearches] = useState<SearchHistoryItem[]>([]);
  const [frequentSearches, setFrequentSearches] = useState<FrequentSearch[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'history'>('chat');
  const [clearingHistory, setClearingHistory] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const responseAccumulator = useRef('');

  const loadHistory = useCallback(async () => {
    const [recent, frequent] = await Promise.all([
      getRecentSearches(),
      getFrequentSearches(),
    ]);
    setRecentSearches(recent);
    setFrequentSearches(frequent);
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen, loadHistory]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (streaming && responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [response, streaming]);

  const handleInputChange = async (value: string) => {
    setQuery(value);
    if (value.trim().length >= 2) {
      const results = await getAutocompleteSuggestions(value);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const executeQuery = async (q: string) => {
    if (!q.trim()) return;
    setQuery(q);
    setStreaming(true);
    setError('');
    setResponse('');
    setSavedReport(false);
    setCurrentQuery(q);
    setShowSuggestions(false);
    setActiveTab('chat');
    responseAccumulator.current = '';

    try {
      await queryGeminiStream(
        q,
        (chunk) => {
          responseAccumulator.current += chunk;
          setResponse(responseAccumulator.current);
        },
        async () => {
          setStreaming(false);
          const tableMatches = responseAccumulator.current.match(/\|.*\|/g);
          const resultsCount = tableMatches ? tableMatches.length : 1;
          await saveToSearchHistory(q, resultsCount);
          await loadHistory();
        },
        (errMsg) => {
          setStreaming(false);
          setError(errMsg);
        }
      );
    } catch (err: any) {
      setError(err.message || 'Erro ao consultar o assistente IA.');
      setStreaming(false);
    }
  };

  const handleSaveReport = async () => {
    if (!response || !currentQuery) return;
    setSavingReport(true);
    const ok = await saveAIReport(currentQuery, response);
    setSavingReport(false);
    setSavedReport(ok);
  };

  const handleClearHistory = async () => {
    setClearingHistory(true);
    await clearSearchHistory();
    setRecentSearches([]);
    setFrequentSearches([]);
    setClearingHistory(false);
  };

  const handleSelectSuggestion = (s: string) => {
    setShowSuggestions(false);
    executeQuery(s);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeQuery(query);
  };

  const isLoading = streaming && !response;
  const hasResponse = response.length > 0;

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-[200] w-14 h-14 bg-gradient-to-br from-violet-600 to-indigo-700 text-white rounded-full shadow-xl shadow-violet-300/50 flex items-center justify-center hover:scale-110 transition-all duration-200 active:scale-95"
        title="Assistente IA"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[250] flex justify-end">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setIsOpen(false)} />

          <div className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 h-full">
            <div className="bg-gradient-to-r from-violet-600 to-indigo-700 p-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-white font-black text-sm uppercase tracking-wider">Assistente IA</h2>
                  <p className="text-violet-200 text-[10px] font-medium">Gemini 2.0 Flash · Análise Logística</p>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                ✕
              </button>
            </div>

            <div className="flex border-b bg-gray-50 shrink-0">
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'chat' ? 'text-violet-700 border-b-2 border-violet-600 bg-white' : 'text-gray-400 hover:text-gray-600'}`}
              >
                💬 Chat
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'history' ? 'text-violet-700 border-b-2 border-violet-600 bg-white' : 'text-gray-400 hover:text-gray-600'}`}
              >
                📋 Histórico
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {activeTab === 'chat' && (
                <div className="p-4 space-y-4">
                  <form onSubmit={handleSubmit} className="relative">
                    <div className="relative" ref={suggestionsRef}>
                      <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => handleInputChange(e.target.value)}
                        onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                        placeholder="Pergunte sobre motoristas, rotas, tickets..."
                        className="w-full pl-4 pr-24 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all"
                        disabled={streaming}
                      />
                      <button
                        type="submit"
                        disabled={streaming || !query.trim()}
                        className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-wider hover:shadow-lg hover:shadow-violet-300/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {streaming ? '...' : 'Analisar'}
                      </button>

                      {showSuggestions && suggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden">
                          {suggestions.map((s, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => handleSelectSuggestion(s)}
                              className="w-full text-left px-4 py-2.5 text-xs font-medium text-gray-700 hover:bg-violet-50 hover:text-violet-700 transition-colors border-b border-gray-50 last:border-0 flex items-center gap-2"
                            >
                              <span className="text-gray-300">🔍</span>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </form>

                  {!streaming && !hasResponse && !error && (
                    <div className="space-y-3">
                      <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-2xl p-4 border border-violet-100">
                        <p className="text-[10px] font-black text-violet-600 uppercase tracking-wider mb-3">Sugestões de análise</p>
                        <div className="space-y-2">
                          {[
                            'Quais são os 5 motoristas com mais reversões?',
                            'Análise geral de desempenho dos motoristas',
                            'Quais CEPs têm mais problemas de entrega?',
                            'Resumo financeiro de tickets faturados vs revertidos',
                            'Quais rotas precisam de mais atenção?',
                          ].map((suggestion, i) => (
                            <button
                              key={i}
                              onClick={() => executeQuery(suggestion)}
                              className="w-full text-left px-3 py-2 bg-white/80 rounded-xl text-xs font-medium text-gray-600 hover:bg-white hover:text-violet-700 hover:shadow-sm transition-all border border-transparent hover:border-violet-200"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>

                      {frequentSearches.length > 0 && (
                        <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                          <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-3">🔥 Buscas frequentes</p>
                          <div className="space-y-1.5">
                            {frequentSearches.map((f, i) => (
                              <button
                                key={i}
                                onClick={() => executeQuery(f.query)}
                                className="w-full text-left px-3 py-2 bg-white rounded-xl text-xs font-medium text-gray-600 hover:text-violet-700 hover:shadow-sm transition-all flex items-center justify-between border border-transparent hover:border-violet-200"
                              >
                                <span className="truncate flex-1">{f.query}</span>
                                <span className="text-[9px] font-black text-gray-300 ml-2 shrink-0">{f.count}x</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {isLoading && (
                    <div className="flex items-center gap-3 py-4">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                      <p className="text-xs font-bold text-gray-400">Preparando análise...</p>
                    </div>
                  )}

                  {error && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                      <p className="text-xs font-bold text-red-600">⚠️ {error}</p>
                    </div>
                  )}

                  {hasResponse && (
                    <div className="space-y-3">
                      <div ref={responseRef} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm max-h-[60vh] overflow-y-auto">
                        <div className="prose prose-sm max-w-none text-gray-700 overflow-x-auto ai-response">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              table: ({ children }) => (
                                <div className="overflow-x-auto my-3 rounded-xl border border-gray-200">
                                  <table className="min-w-full text-xs">{children}</table>
                                </div>
                              ),
                              thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
                              th: ({ children }) => <th className="px-3 py-2 text-left text-[10px] font-black uppercase text-gray-500 border-b">{children}</th>,
                              td: ({ children }) => <td className="px-3 py-2 text-xs text-gray-700 border-b border-gray-50">{children}</td>,
                              h1: ({ children }) => <h1 className="text-base font-black text-gray-800 mt-4 mb-2">{children}</h1>,
                              h2: ({ children }) => <h2 className="text-sm font-black text-gray-700 mt-3 mb-2">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-xs font-black text-gray-600 mt-2 mb-1">{children}</h3>,
                              p: ({ children }) => <p className="text-xs leading-relaxed mb-2">{children}</p>,
                              li: ({ children }) => <li className="text-xs leading-relaxed ml-4">{children}</li>,
                              strong: ({ children }) => <strong className="font-black text-gray-900">{children}</strong>,
                            }}
                          >
                            {response}
                          </ReactMarkdown>
                          {streaming && (
                            <span className="inline-block w-1.5 h-4 bg-violet-500 animate-pulse ml-0.5 rounded-sm align-middle" />
                          )}
                        </div>
                      </div>

                      {!streaming && (
                        <div className="flex gap-2">
                          <button
                            onClick={handleSaveReport}
                            disabled={savingReport || savedReport}
                            className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                              savedReport
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100'
                            } disabled:opacity-60`}
                          >
                            {savedReport ? '✅ Relatório Salvo' : savingReport ? 'Salvando...' : '💾 Salvar Relatório'}
                          </button>
                          <button
                            onClick={() => {
                              setResponse('');
                              setCurrentQuery('');
                              setQuery('');
                              setError('');
                              setSavedReport(false);
                              responseAccumulator.current = '';
                              inputRef.current?.focus();
                            }}
                            className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition-all"
                          >
                            Nova Busca
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'history' && (
                <div className="p-4 space-y-4">
                  {frequentSearches.length > 0 && (
                    <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-4 border border-amber-100">
                      <p className="text-[10px] font-black text-amber-700 uppercase tracking-wider mb-3">🔥 Top 5 mais frequentes</p>
                      <div className="space-y-1.5">
                        {frequentSearches.map((f, i) => (
                          <button
                            key={i}
                            onClick={() => executeQuery(f.query)}
                            className="w-full text-left px-3 py-2.5 bg-white/80 rounded-xl text-xs font-medium text-gray-700 hover:bg-white hover:text-violet-700 hover:shadow-sm transition-all flex items-center justify-between"
                          >
                            <span className="truncate flex-1">{f.query}</span>
                            <span className="text-[10px] font-black text-amber-500 bg-amber-100 px-2 py-0.5 rounded-full ml-2 shrink-0">{f.count}x</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">📋 Últimas 20 buscas</p>
                      {recentSearches.length > 0 && (
                        <button
                          onClick={handleClearHistory}
                          disabled={clearingHistory}
                          className="px-3 py-1.5 text-[9px] font-black uppercase text-red-500 bg-red-50 rounded-lg border border-red-100 hover:bg-red-100 transition-all disabled:opacity-50"
                        >
                          {clearingHistory ? 'Limpando...' : '🗑️ Limpar Histórico'}
                        </button>
                      )}
                    </div>

                    {recentSearches.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-gray-300 text-3xl mb-2">📭</p>
                        <p className="text-xs font-bold text-gray-400">Nenhuma busca realizada ainda</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {recentSearches.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => executeQuery(s.query)}
                            className="w-full text-left px-3 py-2.5 bg-gray-50 rounded-xl text-xs font-medium text-gray-700 hover:bg-violet-50 hover:text-violet-700 transition-all flex items-center gap-3 border border-transparent hover:border-violet-200"
                          >
                            <span className="text-gray-300 shrink-0">🔍</span>
                            <div className="flex-1 min-w-0">
                              <p className="truncate">{s.query}</p>
                              <p className="text-[9px] text-gray-400 mt-0.5">
                                {new Date(s.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                {s.results_count > 0 && ` · ${s.results_count} resultados`}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AIAssistant;
