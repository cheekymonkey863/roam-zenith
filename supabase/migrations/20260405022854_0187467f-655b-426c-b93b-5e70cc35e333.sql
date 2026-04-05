
-- Drop the old pending_imports table (stored serialized React state)
DROP TABLE IF EXISTS public.pending_imports;

-- Create the new per-file staging table
CREATE TABLE public.pending_media_imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID NOT NULL,
  user_id UUID NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  file_name TEXT NOT NULL,
  exif_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_processing_status TEXT NOT NULL DEFAULT 'pending',
  ai_result JSONB,
  group_key TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_pending_media_imports_trip ON public.pending_media_imports(trip_id);
CREATE INDEX idx_pending_media_imports_user ON public.pending_media_imports(user_id);
CREATE INDEX idx_pending_media_imports_status ON public.pending_media_imports(ai_processing_status);

-- Enable RLS
ALTER TABLE public.pending_media_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own staged files"
  ON public.pending_media_imports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own staged files"
  ON public.pending_media_imports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own staged files"
  ON public.pending_media_imports FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own staged files"
  ON public.pending_media_imports FOR DELETE
  USING (auth.uid() = user_id);

-- Timestamp trigger
CREATE TRIGGER update_pending_media_imports_updated_at
  BEFORE UPDATE ON public.pending_media_imports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_media_imports;
