
-- 1. Storage: UPDATE policy + restrict listing on trip-photos
CREATE POLICY "Users can update own photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'trip-photos' AND (auth.uid())::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'trip-photos' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Replace overly-broad SELECT (which allowed listing) with owner-scoped + per-object access via signed URLs
DROP POLICY IF EXISTS "Photos are publicly viewable" ON storage.objects;
CREATE POLICY "Users can view own photos in storage"
ON storage.objects FOR SELECT
USING (bucket_id = 'trip-photos' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- 2. Audit logs: explicit deny for INSERT/UPDATE/DELETE by non-service roles
CREATE POLICY "No client inserts on audit_logs"
ON public.audit_logs AS RESTRICTIVE FOR INSERT
TO authenticated, anon
WITH CHECK (false);

CREATE POLICY "No client updates on audit_logs"
ON public.audit_logs AS RESTRICTIVE FOR UPDATE
TO authenticated, anon
USING (false);

CREATE POLICY "No client deletes on audit_logs"
ON public.audit_logs AS RESTRICTIVE FOR DELETE
TO authenticated, anon
USING (false);

-- 3. Realtime: restrict channel subscriptions
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can receive broadcasts"
ON realtime.messages FOR SELECT
TO authenticated
USING (true);

-- 4. Revoke EXECUTE on internal SECURITY DEFINER trigger/helper functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_log_event() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;
