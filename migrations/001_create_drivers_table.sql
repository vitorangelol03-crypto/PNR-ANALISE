-- =====================================================
-- TABELA: drivers
-- Vincula motoristas às suas rotas fixas permanentemente
-- =====================================================

CREATE TABLE IF NOT EXISTS public.drivers (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  fixed_route     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  is_excluded     BOOLEAN NOT NULL DEFAULT false,
  station         TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_drivers_name        ON public.drivers (name);
CREATE INDEX IF NOT EXISTS idx_drivers_fixed_route ON public.drivers (fixed_route);
CREATE INDEX IF NOT EXISTS idx_drivers_is_active   ON public.drivers (is_active);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_drivers_updated_at ON public.drivers;
CREATE TRIGGER update_drivers_updated_at
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

-- Políticas: qualquer um pode ler, service_role pode tudo
CREATE POLICY IF NOT EXISTS "Public read access" ON public.drivers
  FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "Service role full access" ON public.drivers
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =====================================================
-- MIGRAÇÃO: Popular drivers a partir de driver_overrides
-- =====================================================

INSERT INTO public.drivers (name, fixed_route, is_excluded, station)
SELECT
  driver_name AS name,
  CASE WHEN is_excluded THEN NULL ELSE overridden_route END AS fixed_route,
  is_excluded,
  'XPT_MG_Caratinga' AS station
FROM public.driver_overrides
WHERE driver_name IS NOT NULL
ON CONFLICT (name) DO UPDATE SET
  fixed_route  = EXCLUDED.fixed_route,
  is_excluded  = EXCLUDED.is_excluded,
  updated_at   = NOW();

