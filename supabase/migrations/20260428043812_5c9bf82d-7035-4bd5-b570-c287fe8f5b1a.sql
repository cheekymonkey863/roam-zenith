-- Audit log table
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID,
  actor_user_id UUID,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_trip_id ON public.audit_logs(trip_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor ON public.audit_logs(actor_user_id, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Trip owners can view audit logs for their trips
CREATE POLICY "Trip owners can view audit logs"
ON public.audit_logs FOR SELECT
USING (trip_id IS NOT NULL AND public.is_trip_owner(auth.uid(), trip_id));

-- Collaborators can view audit logs for shared trips
CREATE POLICY "Collaborators can view audit logs"
ON public.audit_logs FOR SELECT
USING (trip_id IS NOT NULL AND public.is_trip_shared_with(auth.uid(), trip_id));

-- Inserts only via security definer triggers (no direct insert policy)

-- Helper to summarize a row
CREATE OR REPLACE FUNCTION public.audit_log_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_id UUID;
  v_action TEXT;
  v_changes JSONB := '{}'::jsonb;
  v_summary TEXT;
  v_entity_id UUID;
  v_actor UUID := auth.uid();
  k TEXT;
  old_jsonb JSONB;
  new_jsonb JSONB;
  diff JSONB := '{}'::jsonb;
BEGIN
  -- Determine action
  IF TG_OP = 'INSERT' THEN v_action := 'create';
  ELSIF TG_OP = 'UPDATE' THEN v_action := 'update';
  ELSIF TG_OP = 'DELETE' THEN v_action := 'delete';
  END IF;

  -- Resolve trip_id and entity_id per table
  IF TG_TABLE_NAME = 'trips' THEN
    v_trip_id := COALESCE((NEW).id, (OLD).id);
    v_entity_id := v_trip_id;
    IF TG_OP = 'INSERT' THEN
      v_summary := 'Trip created: ' || COALESCE(NEW.title, 'Untitled');
    ELSIF TG_OP = 'DELETE' THEN
      v_summary := 'Trip deleted: ' || COALESCE(OLD.title, 'Untitled');
    ELSE
      v_summary := 'Trip updated';
    END IF;

  ELSIF TG_TABLE_NAME = 'trip_steps' THEN
    v_trip_id := COALESCE((NEW).trip_id, (OLD).trip_id);
    v_entity_id := COALESCE((NEW).id, (OLD).id);
    IF TG_OP = 'INSERT' THEN
      v_summary := 'Step added: ' || COALESCE(NEW.location_name, 'Unknown location');
    ELSIF TG_OP = 'DELETE' THEN
      v_summary := 'Step removed: ' || COALESCE(OLD.location_name, 'Unknown location');
    ELSE
      v_summary := 'Step updated: ' || COALESCE(NEW.location_name, 'Unknown location');
    END IF;

  ELSIF TG_TABLE_NAME = 'step_photos' THEN
    -- Look up trip_id via the step
    SELECT ts.trip_id INTO v_trip_id
    FROM public.trip_steps ts
    WHERE ts.id = COALESCE((NEW).step_id, (OLD).step_id);
    v_entity_id := COALESCE((NEW).id, (OLD).id);
    IF TG_OP = 'INSERT' THEN
      v_summary := 'Photo added: ' || COALESCE(NEW.file_name, 'media');
    ELSIF TG_OP = 'DELETE' THEN
      v_summary := 'Photo removed: ' || COALESCE(OLD.file_name, 'media');
    ELSE
      v_summary := 'Photo updated';
    END IF;

  ELSIF TG_TABLE_NAME = 'trip_shares' THEN
    v_trip_id := COALESCE((NEW).trip_id, (OLD).trip_id);
    v_entity_id := COALESCE((NEW).id, (OLD).id);
    IF TG_OP = 'INSERT' THEN
      v_summary := 'Trip shared with ' || COALESCE(NEW.email, 'user');
    ELSIF TG_OP = 'DELETE' THEN
      v_summary := 'Share revoked for ' || COALESCE(OLD.email, 'user');
    ELSE
      v_summary := 'Share updated (' || COALESCE(NEW.status, '') || ')';
    END IF;
  END IF;

  -- Build a compact diff for UPDATEs
  IF TG_OP = 'UPDATE' THEN
    old_jsonb := to_jsonb(OLD);
    new_jsonb := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(new_jsonb) LOOP
      -- Skip noisy/auto fields
      IF k IN ('updated_at','created_at') THEN CONTINUE; END IF;
      IF (old_jsonb->k) IS DISTINCT FROM (new_jsonb->k) THEN
        diff := diff || jsonb_build_object(k, jsonb_build_object('old', old_jsonb->k, 'new', new_jsonb->k));
      END IF;
    END LOOP;
    -- Skip writing audit if nothing meaningful changed
    IF diff = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
    v_changes := diff;
  ELSIF TG_OP = 'INSERT' THEN
    v_changes := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_changes := to_jsonb(OLD);
  END IF;

  INSERT INTO public.audit_logs (trip_id, actor_user_id, entity_type, entity_id, action, changes, summary)
  VALUES (v_trip_id, v_actor, TG_TABLE_NAME, v_entity_id, v_action, v_changes, v_summary);

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- Attach triggers
CREATE TRIGGER trips_audit
AFTER INSERT OR UPDATE OR DELETE ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.audit_log_event();

CREATE TRIGGER trip_steps_audit
AFTER INSERT OR UPDATE OR DELETE ON public.trip_steps
FOR EACH ROW EXECUTE FUNCTION public.audit_log_event();

CREATE TRIGGER step_photos_audit
AFTER INSERT OR UPDATE OR DELETE ON public.step_photos
FOR EACH ROW EXECUTE FUNCTION public.audit_log_event();

CREATE TRIGGER trip_shares_audit
AFTER INSERT OR UPDATE OR DELETE ON public.trip_shares
FOR EACH ROW EXECUTE FUNCTION public.audit_log_event();