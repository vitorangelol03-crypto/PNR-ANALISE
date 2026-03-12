# IHS Tickets Dashboard

## Overview
A professional corporate dashboard for analyzing IHS tickets from CSV and Excel files. Features real-time filtering, driver rankings, and interactive data visualization.

## Architecture
- **Frontend**: React 19 + TypeScript, built with Vite
- **Styling**: Tailwind CSS (via CDN)
- **Charts**: Recharts
- **File Parsing**: PapaParse (CSV), xlsx (Excel)
- **Backend/DB**: Supabase (PostgreSQL)
- **Language**: Portuguese (pt-BR)

## Project Structure
```
/
├── App.tsx         # Main application component (single-file app)
├── index.tsx       # React entry point
├── index.html      # HTML shell with importmap and Tailwind CDN
├── supabase.ts     # Supabase client configuration
├── types.ts        # TypeScript type definitions
├── utils.ts        # Utility functions
├── vite.config.ts  # Vite configuration
└── package.json    # Dependencies
```

## Development
- **Dev server**: `npm run dev` — runs on port 5000 (0.0.0.0)
- **Build**: `npm run build` — outputs to `dist/`

## Deployment
- Target: Static site
- Build command: `npm run build`
- Public directory: `dist`

## Key Configuration
- Vite dev server: port 5000, host 0.0.0.0, allowedHosts: true (for Replit proxy)
- Supabase URL: hardcoded in supabase.ts (uses anon key)
- GEMINI_API_KEY env var supported but not required for core functionality
