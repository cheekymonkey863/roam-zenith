
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own trips" ON public.trips FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own trips" ON public.trips FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own trips" ON public.trips FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own trips" ON public.trips FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER update_trips_updated_at BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.trip_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  location_name TEXT,
  country TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'manual',
  is_confirmed BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.trip_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own steps" ON public.trip_steps FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own steps" ON public.trip_steps FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own steps" ON public.trip_steps FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own steps" ON public.trip_steps FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_trip_steps_trip_id ON public.trip_steps(trip_id);
CREATE INDEX idx_trip_steps_recorded_at ON public.trip_steps(recorded_at);

CREATE TABLE public.step_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id UUID REFERENCES public.trip_steps(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  taken_at TIMESTAMPTZ,
  exif_data JSONB,
  is_suggested BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.step_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own photos" ON public.step_photos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own photos" ON public.step_photos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own photos" ON public.step_photos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own photos" ON public.step_photos FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.location_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.location_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own points" ON public.location_points FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own points" ON public.location_points FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_location_points_trip ON public.location_points(trip_id, recorded_at);

INSERT INTO storage.buckets (id, name, public) VALUES ('trip-photos', 'trip-photos', true);
CREATE POLICY "Users can upload own photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'trip-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Photos are publicly viewable" ON storage.objects FOR SELECT USING (bucket_id = 'trip-photos');
CREATE POLICY "Users can delete own photos" ON storage.objects FOR DELETE USING (bucket_id = 'trip-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
