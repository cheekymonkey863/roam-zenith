
CREATE TABLE public.pending_imports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id uuid NOT NULL,
  user_id uuid NOT NULL,
  import_state jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.pending_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pending imports"
  ON public.pending_imports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own pending imports"
  ON public.pending_imports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pending imports"
  ON public.pending_imports FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own pending imports"
  ON public.pending_imports FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_pending_imports_updated_at
  BEFORE UPDATE ON public.pending_imports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_pending_imports_trip ON public.pending_imports (trip_id, status);
