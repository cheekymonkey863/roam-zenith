ALTER TABLE public.trip_steps ADD COLUMN IF NOT EXISTS sort_order integer;

-- Backfill existing rows: order by recorded_at within each trip
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY trip_id ORDER BY recorded_at) AS rn
  FROM public.trip_steps
)
UPDATE public.trip_steps SET sort_order = ranked.rn
FROM ranked WHERE public.trip_steps.id = ranked.id;

-- Set a default for new rows
ALTER TABLE public.trip_steps ALTER COLUMN sort_order SET DEFAULT 0;