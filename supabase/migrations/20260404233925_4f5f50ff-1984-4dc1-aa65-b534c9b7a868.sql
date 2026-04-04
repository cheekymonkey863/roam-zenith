
CREATE TABLE public.video_analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caption_id text NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.video_analysis_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own jobs"
  ON public.video_analysis_jobs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage jobs"
  ON public.video_analysis_jobs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can insert own jobs"
  ON public.video_analysis_jobs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.video_analysis_jobs;
