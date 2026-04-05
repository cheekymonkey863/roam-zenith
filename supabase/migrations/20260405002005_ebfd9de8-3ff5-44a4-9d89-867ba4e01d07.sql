
-- Add columns to video_analysis_jobs for fully async processing
ALTER TABLE public.video_analysis_jobs
  ADD COLUMN IF NOT EXISTS trip_id uuid,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS mime_type text DEFAULT 'video/mp4',
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS taken_at timestamptz,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS location_name text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS itinerary_context jsonb DEFAULT '[]'::jsonb;

-- Allow 'pending' as a default status for queued jobs
ALTER TABLE public.video_analysis_jobs ALTER COLUMN status SET DEFAULT 'pending';

-- Index for the queue worker to efficiently pick up pending jobs
CREATE INDEX IF NOT EXISTS idx_video_analysis_jobs_status ON public.video_analysis_jobs (status) WHERE status = 'pending';
