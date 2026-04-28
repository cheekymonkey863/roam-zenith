-- Admins table (separate from profiles to avoid privilege escalation)
CREATE TABLE public.admins (
  user_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins WHERE user_id = _user_id)
$$;

CREATE POLICY "Admins can view admins" ON public.admins FOR SELECT USING (public.is_admin(auth.uid()));

-- Debug logs table
CREATE TABLE public.debug_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID,
  level TEXT NOT NULL DEFAULT 'error',
  message TEXT NOT NULL,
  stack TEXT,
  source TEXT,
  line_no INTEGER,
  col_no INTEGER,
  route TEXT,
  user_agent TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.debug_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_debug_logs_created_at ON public.debug_logs (created_at DESC);
CREATE INDEX idx_debug_logs_level ON public.debug_logs (level);

-- Anyone authenticated (or anon) can insert their own log; admins can insert too
CREATE POLICY "Anyone can insert debug logs"
  ON public.debug_logs FOR INSERT
  WITH CHECK (actor_user_id IS NULL OR actor_user_id = auth.uid());

-- Only admins can view
CREATE POLICY "Admins can view debug logs"
  ON public.debug_logs FOR SELECT
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete debug logs"
  ON public.debug_logs FOR DELETE
  USING (public.is_admin(auth.uid()));

-- Seed first admin: the only existing user becomes admin (single-owner project)
INSERT INTO public.admins (user_id)
SELECT id FROM auth.users
ORDER BY created_at ASC
LIMIT 1
ON CONFLICT DO NOTHING;