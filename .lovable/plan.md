
## Async Staging Inbox Architecture

### 1. Database: Create `pending_media_imports` table
- **Fields**: `id`, `trip_id`, `user_id`, `storage_path`, `mime_type`, `file_name`, `exif_metadata` (JSONB — GPS, takenAt, camera info), `ai_processing_status` (pending/processing/complete/failed), `ai_result` (JSONB — caption, essence, suggested venue/city, tags), `group_key` (nullable — assigned during grouping), `created_at`, `updated_at`
- **RLS**: Users can CRUD their own rows
- Drop the old `pending_imports` table (it stored serialized React state — no longer needed)

### 2. Upload Flow (PhotoImport.tsx)
- When files are dropped, immediately:
  1. Extract EXIF metadata (GPS, date, camera) — this is fast, client-side
  2. Upload raw file to Supabase Storage via TUS (`trip-photos/{userId}/{tripId}/staging/{uuid}.{ext}`)
  3. Insert a row into `pending_media_imports` with the EXIF metadata and `ai_processing_status = 'pending'`
- Once all uploads complete → show the Staging Inbox UI
- **No files held in React state** — everything is in the DB + Storage

### 3. Staging Inbox UI
- Query `pending_media_imports` for the current trip
- Display files grouped by location (using `group_key` or client-side grouping from EXIF GPS)
- Show AI processing status per file (spinner for pending, results when complete)
- Subscribe to realtime updates so AI results appear live
- Allow: select/deselect, move between groups, delete, edit location names
- "Import Selected" button creates `trip_steps` + `step_photos` from the staged files

### 4. Background AI Processing
- Existing `video_analysis_jobs` + `process-video-queue` handles videos
- Photo grouping + location inference runs when user opens the staging view (or can be triggered server-side)
- AI results written back to `pending_media_imports.ai_result`

### 5. Cleanup
- After successful import, delete the `pending_media_imports` rows (or mark as imported)
- Remove the old `pending_imports` table
