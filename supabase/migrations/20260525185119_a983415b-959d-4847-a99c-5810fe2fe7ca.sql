
-- 1) Clean up existing duplicate step_photos (keep oldest per step_id + file_name)
DELETE FROM public.step_photos sp
USING (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY step_id, file_name ORDER BY created_at ASC, id ASC) AS rn
  FROM public.step_photos
  WHERE step_id IS NOT NULL
) ranked
WHERE sp.id = ranked.id AND ranked.rn > 1;

-- 2) Unique index to enforce no duplicates per step
CREATE UNIQUE INDEX IF NOT EXISTS step_photos_step_file_unique
  ON public.step_photos (step_id, file_name)
  WHERE step_id IS NOT NULL;

-- 3) Same guard for pending_media_imports
DELETE FROM public.pending_media_imports pmi
USING (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY trip_id, file_name ORDER BY created_at ASC, id ASC) AS rn
  FROM public.pending_media_imports
) ranked
WHERE pmi.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS pending_media_imports_trip_file_unique
  ON public.pending_media_imports (trip_id, file_name);
