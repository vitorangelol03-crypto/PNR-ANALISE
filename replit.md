# IHS Tickets Dashboard

## Overview
A professional corporate dashboard for analyzing IHS tickets from CSV and Excel files. Features real-time filtering, driver rankings, route management workflow, AI-powered logistics analysis, and interactive data visualization.

## Architecture
- **Frontend**: React 19 + TypeScript, built with Vite
- **Styling**: Tailwind CSS (via CDN)
- **Charts**: Recharts
- **Routing**: React Router v6
- **File Parsing**: PapaParse (CSV), xlsx (Excel)
- **Backend/DB**: Supabase (PostgreSQL)
- **AI**: Google Gemini 2.5 Flash via @google/generative-ai SDK
- **Markdown**: react-markdown for AI response rendering
- **Language**: Portuguese (pt-BR)

## Project Structure
```
/
├── App.tsx                  # Router wrapper with Header + page routes + AIAssistant
├── index.tsx                # React entry point
├── index.html               # HTML shell with importmap and Tailwind CDN
├── supabase.ts              # Supabase client configuration (anon key only)
├── types.ts                 # TypeScript type definitions
├── utils.ts                 # Utility functions
├── vite.config.ts           # Vite configuration
├── package.json             # Dependencies
├── components/
│   ├── Header.tsx           # Navigation header (Dashboard + Banco de Rotas)
│   └── AIAssistant.tsx      # AI assistant floating panel (Gemini integration)
├── services/
│   └── gemini.ts            # Gemini API service, Supabase context builder, search history
└── pages/
    ├── Dashboard.tsx        # Main dashboard page (tickets, rankings, insights)
    └── BancoDeRotas.tsx     # Route management page (workflow visual, CRUD)
```

## Pages
- **Dashboard** (`/`): Main analytics page with ticket import, driver rankings, route stats, and admin tools
- **Banco de Rotas** (`/banco-de-rotas`): Visual workflow page showing route groups with SVG connector lines between routes and drivers. Supports creating/editing routes, linking drivers, and filtering by group.

## AI Assistant
- Floating violet button (bottom-right) opens a side panel on any page
- Two tabs: Chat (query + response) and Histórico (search history)
- Queries Supabase for full context (tickets, drivers, routes, links, mappings) and sends to Gemini 2.5 Flash
- Responses rendered as Markdown with styled tables, headings, lists
- Autocomplete suggestions from search_history as user types
- "Salvar Relatório" saves query+response to ai_reports table
- Recent searches (last 20) and frequent searches (top 5) shown
- "Limpar Histórico" clears all search_history records

## Supabase Tables
- `tickets` — imported ticket data
- `drivers` — 45 permanent drivers (source of truth)
- `routes` — 16 route definitions with CEPs and group assignment
- `driver_route_links` — 40 driver↔route associations
- `route_groups` — 4 groups (Rota A/B/C/D) with colors
- `route_mapping` — SPXTN↔CEP mappings from file import
- `city_cache` — geocoded city info from BrasilAPI
- `dashboard_meta` — key/value metadata (reference_date)
- `search_history` — AI search logs (query, results_count, source, created_at)
- `ai_reports` — AI generated reports (query, response, created_at)

## Environment Variables
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anonymous key
- `GEMINI_API_KEY` — Google Gemini API key (required for AI assistant)

## Development
- **Dev server**: `npm run dev` — runs on port 5000 (0.0.0.0)
- **Build**: `npm run build` — outputs to `dist/`

## Deployment
- Target: Static site
- Build command: `npm run build`
- Public directory: `dist`

## Key Configuration
- Vite dev server: port 5000, host 0.0.0.0, allowedHosts: true (for Replit proxy)
- Supabase URL: hardcoded fallback in supabase.ts (uses anon key, no service role key exposed)
- GEMINI_API_KEY passed to frontend via vite.config.ts define
- Admin password: `684171` (sessionStorage key: `ihs_admin`)
