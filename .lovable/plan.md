## Async Video Analysis Architecture (Implemented)

### Architecture
Users upload media → files go to storage → `video_analysis_jobs` rows created with status `pending` → pg_cron triggers `process-video-queue` every minute → worker picks up pending jobs, processes via Gemini File API with rate limiting → results written back to `video_analysis_jobs` and `step_photos.exif_data` → frontend subscribes via Realtime and auto-refreshes.

### Components
1. **`src/lib/videoAnalysisQueue.ts`** — Helper to insert pending jobs into `video_analysis_jobs`
2. **`supabase/functions/process-video-queue/index.ts`** — Cron-triggered worker that processes up to 5 jobs per invocation with 4s delay between jobs
3. **`supabase/functions/analyze-video/index.ts`** — Legacy sync function (still available for direct calls)
4. **`src/pages/TripDetail.tsx`** — Realtime subscription shows banner with pending job count
5. **`src/lib/mediaImport.ts`** — No longer blocks on video analysis; returns immediately with fallback captions
6. **`src/components/PhotoImport.tsx`** & **`DashboardTripForm.tsx`** — Queue video jobs after upload

### Database
- `video_analysis_jobs` table expanded with: `trip_id`, `storage_path`, `mime_type`, `file_name`, `taken_at`, `latitude`, `longitude`, `location_name`, `country`, `itinerary_context`
- Default status changed to `pending`
- Index on `status = 'pending'` for efficient queue polling
- Realtime enabled on the table
- pg_cron scheduled to invoke `process-video-queue` every minute

### Benefits
- No more mobile browser OOM or timeout crashes
- Users can close the app after upload completes
- Rate limits respected (4s between jobs, 5 per batch)
- Gemini gets full video+audio context via File API
- Results auto-enrich `step_photos.exif_data` with AI metadata
