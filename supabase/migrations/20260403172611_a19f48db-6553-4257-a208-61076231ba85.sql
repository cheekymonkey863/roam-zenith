
-- Create event type enum
CREATE TYPE public.step_event_type AS ENUM (
  'arrival',
  'departure', 
  'accommodation',
  'transport',
  'activity',
  'food',
  'sightseeing',
  'border_crossing',
  'other'
);

-- Add event_type column to trip_steps
ALTER TABLE public.trip_steps 
ADD COLUMN event_type text NOT NULL DEFAULT 'other';
