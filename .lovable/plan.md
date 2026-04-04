## Video Analysis Pipeline Redesign

### Problem
- Client-side FFmpeg frame extraction crashes mobile browsers (OOM on 4K videos)
- Stripping frames loses audio + temporal context → worse AI results
- Base64 inline data hits Gemini size/MIME limits and wastes tokens

### New Architecture

**Phase 1: Client-side changes**
1. Stop using FFmpeg for frame extraction — remove `createVideoPreviews()` usage for AI analysis
2. Keep FFmpeg WASM **only** for quick metadata extraction (creation_time, GPS) and thumbnail generation
3. During import, upload raw video files directly to `trip-photos` Supabase Storage bucket
4. Pass the storage path (not base64) to the edge function

**Phase 2: Edge Function rewrite (`analyze-video`)**
1. Download video from Supabase Storage using streaming (avoid loading into memory)
2. Upload to Gemini File API (`media.upload`) — get back a `fileUri`
3. Poll until file is `ACTIVE` (Gemini needs processing time)
4. Call `generateContent` with `fileUri` reference (not inline data)
5. Use strict `responseSchema` for structured output
6. Save results to a new `video_analysis_jobs` table (or update `step_photos.exif_data`)

**Phase 3: Async results with Realtime**
1. Edge function returns immediately with a job ID after triggering analysis
2. Use `EdgeRuntime.waitUntil()` to continue processing in background
3. Frontend subscribes to the job row via Supabase Realtime
4. When results arrive, merge into the import preview

### Benefits
- No more mobile OOM crashes
- Gemini gets full audio + video context → dramatically better captions/tags
- No base64 encoding overhead (saves ~33% bandwidth)
- No 5MB truncation — full video analyzed
- `videoMetadata` offsets still work with File API for token savings
