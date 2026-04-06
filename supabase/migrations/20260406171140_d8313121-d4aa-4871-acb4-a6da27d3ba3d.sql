CREATE POLICY "Users can update own jobs"
ON public.video_analysis_jobs
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);