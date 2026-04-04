
-- Create trip_shares table
CREATE TABLE public.trip_shares (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL,
  email TEXT NOT NULL,
  share_token UUID DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_trip_shares_trip_email ON public.trip_shares(trip_id, email);
CREATE INDEX idx_trip_shares_user ON public.trip_shares(user_id);
CREATE UNIQUE INDEX idx_trip_shares_token ON public.trip_shares(share_token);

ALTER TABLE public.trip_shares ENABLE ROW LEVEL SECURITY;

-- Security definer function to check shared access (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_trip_shared_with(_user_id UUID, _trip_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_shares
    WHERE trip_id = _trip_id
      AND user_id = _user_id
      AND status = 'accepted'
  )
$$;

-- Security definer to check trip ownership
CREATE OR REPLACE FUNCTION public.is_trip_owner(_user_id UUID, _trip_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trips
    WHERE id = _trip_id AND user_id = _user_id
  )
$$;

-- RLS on trip_shares
CREATE POLICY "Trip owners can view shares"
  ON public.trip_shares FOR SELECT
  USING (public.is_trip_owner(auth.uid(), trip_id));

CREATE POLICY "Shared users can view own shares"
  ON public.trip_shares FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Trip owners can create shares"
  ON public.trip_shares FOR INSERT
  WITH CHECK (public.is_trip_owner(auth.uid(), trip_id) AND invited_by = auth.uid());

CREATE POLICY "Trip owners can delete shares"
  ON public.trip_shares FOR DELETE
  USING (public.is_trip_owner(auth.uid(), trip_id));

CREATE POLICY "Users can accept own invites"
  ON public.trip_shares FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Update trips RLS: shared users can view
CREATE POLICY "Shared users can view shared trips"
  ON public.trips FOR SELECT
  USING (public.is_trip_shared_with(auth.uid(), id));

-- Update trip_steps RLS: shared users can view and insert
CREATE POLICY "Shared users can view shared trip steps"
  ON public.trip_steps FOR SELECT
  USING (public.is_trip_shared_with(auth.uid(), trip_id));

CREATE POLICY "Shared users can add steps to shared trips"
  ON public.trip_steps FOR INSERT
  WITH CHECK (public.is_trip_shared_with(auth.uid(), trip_id) AND auth.uid() = user_id);

-- Update step_photos RLS: shared users can view and insert
CREATE POLICY "Shared users can view shared trip photos"
  ON public.step_photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_steps ts
      WHERE ts.id = step_photos.step_id
        AND public.is_trip_shared_with(auth.uid(), ts.trip_id)
    )
  );

CREATE POLICY "Shared users can add photos to shared trips"
  ON public.step_photos FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.trip_steps ts
      WHERE ts.id = step_photos.step_id
        AND public.is_trip_shared_with(auth.uid(), ts.trip_id)
    )
  );
