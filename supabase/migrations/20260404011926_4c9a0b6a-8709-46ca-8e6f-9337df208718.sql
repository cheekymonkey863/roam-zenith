-- Add new transport event types to the enum
ALTER TYPE public.step_event_type ADD VALUE IF NOT EXISTS 'flight';
ALTER TYPE public.step_event_type ADD VALUE IF NOT EXISTS 'train';
ALTER TYPE public.step_event_type ADD VALUE IF NOT EXISTS 'bus';
ALTER TYPE public.step_event_type ADD VALUE IF NOT EXISTS 'ferry';
ALTER TYPE public.step_event_type ADD VALUE IF NOT EXISTS 'car';
ALTER TYPE public.step_event_type ADD VALUE IF NOT EXISTS 'on_foot';
ALTER TYPE public.step_event_type ADD VALUE IF NOT EXISTS 'cycling';