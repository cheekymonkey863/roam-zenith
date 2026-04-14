import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, type CSSProperties } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { StepVisualType } from "@/lib/stepVisuals";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

type TripStep = Tables<"trip_steps">;

mapboxgl.accessToken = "pk.eyJ1IjoicnNvdXNhMzE1IiwiYSI6ImNtbmo2Z3lsNDA4ajMyc3M0ZW40a2R5dG8ifQ.VO0pQrXPDmIQWzKbpB3lUg";

const ROUTE_COLOR = "#E74C5E";
const ROUTE_COLOR_ALT = ["#E74C5E", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6"];

export interface WorldMapHandle {
flyToStep: (step: TripStep) => void;
fitAllSteps: () => void;
highlightStep: (stepId: string | null) => void;
}

interface WorldMapProps {
steps: TripStep[];
singleTrip?: boolean;
visualTypes?: Record<string, StepVisualType>;
activeStepId?: string | null;
className?: string;
style?: CSSProperties;
}

export const WorldMap = forwardRef<WorldMapHandle, WorldMapProps>(function WorldMap(
{ steps, singleTrip = false, className, style },
ref,
) {
const containerRef = useRef<HTMLDivElement>(null);
const mapRef = useRef<mapboxgl.Map | null>(null);
const stepsRef = useRef<TripStep[]>(steps);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
stepsRef.current = steps;

const flyToStep = useCallback((step: TripStep) => {
const map = mapRef.current;
if (!map || (step.latitude === 0 && step.longitude === 0)) return;
map.flyTo({
center: [step.longitude, step.latitude],
zoom: Math.max(map.getZoom(), 10),
duration: 1200,
essential: true,
});
}, []);

const fitAllSteps = useCallback(() => {
const map = mapRef.current;
if (!map || stepsRef.current.length === 0) return;
const bounds = new mapboxgl.LngLatBounds();
stepsRef.current.forEach((s) => {
if (s.latitude !== 0 && s.longitude !== 0) {
bounds.extend([s.longitude, s.latitude]);
}
});
if (!bounds.isEmpty()) {
map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 800 });
}
}, []);

const highlightStep = useCallback((_stepId: string | null) => {}, []);

useImperativeHandle(ref, () => ({ flyToStep, fitAllSteps, highlightStep }), [flyToStep, fitAllSteps, highlightStep]);

useEffect(() => {
if (!containerRef.current) return;

if (mapRef.current) {
mapRef.current.remove();
mapRef.current = null;
}

    // Clear old markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

const map = new mapboxgl.Map({
container: containerRef.current,
style: "mapbox://styles/mapbox/satellite-streets-v12",
center: [20, 20],
zoom: 1.5,
minZoom: 1.5,
projection: "mercator",
attributionControl: false,
pitchWithRotate: false,
dragRotate: false,
touchPitch: false,
});

map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
mapRef.current = map;

const resizeObserver = new ResizeObserver(() => {
map.resize();
});
resizeObserver.observe(containerRef.current);

    map.on("load", async () => {
if (steps.length === 0) return;

const byTrip = new Map<string, TripStep[]>();
steps.forEach((step) => {
const tripSteps = byTrip.get(step.trip_id) || [];
tripSteps.push(step);
byTrip.set(step.trip_id, tripSteps);
});

const bounds = new mapboxgl.LngLatBounds();

      // 1. Draw route lines (trip detail only, not dashboard)
      if (singleTrip) {
        let colorIdx = 0;
        byTrip.forEach((tripSteps, tripId) => {
          const color = ROUTE_COLOR;
          colorIdx += 1;

          const routeCoordinates = tripSteps
            .filter((step) => step.latitude !== 0 && step.longitude !== 0)
            .map((step) => [step.longitude, step.latitude] as [number, number]);

          routeCoordinates.forEach((coordinate) => bounds.extend(coordinate));

          if (routeCoordinates.length > 1) {
            map.addSource(`route-${tripId}`, {
              type: "geojson",
              data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routeCoordinates } },
            });

            map.addLayer({
              id: `route-glow-${tripId}`,
              type: "line",
              source: `route-${tripId}`,
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": color, "line-width": 6, "line-opacity": 0.2, "line-blur": 3 },
            });

            map.addLayer({
              id: `route-line-${tripId}`,
              type: "line",
              source: `route-${tripId}`,
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": color, "line-width": 3.5, "line-opacity": 1 },
            });
          }
        });
      } else {
        // Dashboard: just extend bounds, no lines
        validSteps.forEach((s) => bounds.extend([s.longitude, s.latitude]));
      }

      // 2. Build markers — photo thumbnails + full names on trip page, city labels on dashboard
      const validSteps = steps.filter((s) => s.latitude !== 0 && s.longitude !== 0);
      const stepIds = validSteps.map((s) => s.id);

      // Fetch photos for markers
      const photoMap = new Map<string, string>();
      if (stepIds.length > 0) {
        const { data: photos } = await supabase
          .from("step_photos")
          .select("step_id, storage_path")
          .in("step_id", stepIds);

        if (photos) {
          for (const photo of photos) {
            if (!photoMap.has(photo.step_id)) {
              const { data: urlData } = supabase.storage.from("trip-photos").getPublicUrl(photo.storage_path);
              photoMap.set(photo.step_id, urlData.publicUrl);
            }
          }
        }
      }

      if (singleTrip) {
        // Trip detail: photo thumbnail bubbles with always-visible place names
        // For flights: show plane icon + only the origin airport name
        // For accommodations: show hotel icon + only the check-in entry (deduplicated by location)
        const FLIGHT_TYPES = new Set(["flight"]);
        const ACCOMMODATION_TYPES = new Set(["hotel", "apartment_flat", "private_home", "villa", "safari", "glamping", "camping", "resort", "ski_lodge", "accommodation"]);
        const PLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.4-.1.9.3 1.1L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.2.4.7.5 1.1.3l.5-.3c.4-.2.6-.6.5-1.1z"/></svg>`;
        const HOTEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z"/><path d="m9 16 .348-.24c1.465-1.013 3.84-1.013 5.304 0L15 16"/><path d="M8 7h.01"/><path d="M16 7h.01"/><path d="M12 7h.01"/><path d="M12 11h.01"/><path d="M16 11h.01"/><path d="M8 11h.01"/></svg>`;

        // Deduplicate accommodations: only show the first (check-in) entry per location
        const seenAccommodationLocations = new Set<string>();
        const filteredSteps = validSteps.filter((step) => {
          if (ACCOMMODATION_TYPES.has(step.event_type)) {
            const locKey = `${step.latitude.toFixed(4)},${step.longitude.toFixed(4)}`;
            if (seenAccommodationLocations.has(locKey)) return false;
            seenAccommodationLocations.add(locKey);
          }
          return true;
        });

        filteredSteps.forEach((step) => {
          const el = document.createElement("div");
          el.className = "custom-map-marker group relative cursor-pointer flex flex-col items-center";

          const isFlight = FLIGHT_TYPES.has(step.event_type);
          const isAccommodation = ACCOMMODATION_TYPES.has(step.event_type);
          const imgUrl = photoMap.get(step.id);

          // For flights: show the airport at THIS location (before →), not the full route
          let displayName = step.location_name || "Unknown Location";
          if (isFlight && displayName.includes("→")) {
            displayName = displayName.split("→")[0].trim();
          }

          let bubble: string;
          if (isFlight) {
            bubble = `<div class="h-10 w-10 rounded-full border-2 border-white shadow-lg overflow-hidden flex items-center justify-center" style="background:#3b82f6">${PLANE_SVG}</div>`;
          } else if (isAccommodation) {
            bubble = `<div class="h-10 w-10 rounded-full border-2 border-white shadow-lg overflow-hidden flex items-center justify-center" style="background:#8b5cf6">${HOTEL_SVG}</div>`;
          } else {
            bubble = `<div class="h-10 w-10 rounded-full border-2 border-white shadow-lg overflow-hidden bg-muted flex items-center justify-center">
                ${imgUrl ? `<img src="${imgUrl}" class="h-full w-full object-cover" />` : `<div class="w-2.5 h-2.5 rounded-full bg-primary"></div>`}
              </div>`;
          }

          el.innerHTML = `
            <div class="bg-card text-foreground text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg border border-border whitespace-nowrap mb-1">
              ${displayName}
            </div>
            ${bubble}
          `;

          const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" }).setLngLat([step.longitude, step.latitude]).addTo(map);
          markersRef.current.push(marker);
        });
      } else {
        // Dashboard: show only accommodation & activity steps, deduplicated by city, with photo thumbnails
        const DASHBOARD_ACCOMMODATION = new Set(["hotel", "apartment_flat", "private_home", "villa", "safari", "glamping", "camping", "resort", "ski_lodge", "accommodation"]);
        const DASHBOARD_ACTIVITY = new Set(["activity", "sightseeing", "tour", "dining", "food", "meeting", "concert", "theatre", "live_show", "wellness", "sport", "other"]);
        const DASHBOARD_TYPES = new Set([...DASHBOARD_ACCOMMODATION, ...DASHBOARD_ACTIVITY]);

        const relevantSteps = validSteps.filter((s) => DASHBOARD_TYPES.has(s.event_type));

        const citySet = new Map<string, { lng: number; lat: number; stepId: string }>();
        relevantSteps.forEach((step) => {
          // Use the country field as the city source, or extract from location_name
          // location_name is often "Place Name, City, Country" — we want just the city
          let cityName = "Unknown";
          if (step.country) {
            // country field often has just the country; try location_name for city
            const raw = step.location_name || "";
            const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
            if (parts.length >= 3) {
              // "Place, City, Country" → take City
              cityName = parts[parts.length - 2];
            } else if (parts.length === 2) {
              // "City, Country" → take City
              cityName = parts[0];
            } else {
              // Single name — likely the city itself or a place name; use country as fallback
              cityName = step.country || parts[0] || "Unknown";
            }
          } else {
            const raw = step.location_name || "Unknown";
            const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
            cityName = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
          }
          if (!citySet.has(cityName)) {
            citySet.set(cityName, { lng: step.longitude, lat: step.latitude, stepId: step.id });
          }
        });

        citySet.forEach((coords, cityName) => {
          const el = document.createElement("div");
          el.className = "custom-map-marker flex flex-col items-center";
          const imgUrl = photoMap.get(coords.stepId);

          el.innerHTML = `
            <div class="bg-card/90 text-foreground text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg border border-border whitespace-nowrap mb-1">
              ${cityName}
            </div>
            <div class="h-10 w-10 rounded-full border-2 border-white shadow-lg overflow-hidden bg-muted flex items-center justify-center">
              ${imgUrl ? `<img src="${imgUrl}" class="h-full w-full object-cover" />` : `<div class="w-2.5 h-2.5 rounded-full bg-primary"></div>`}
            </div>
          `;

          const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" }).setLngLat([coords.lng, coords.lat]).addTo(map);
          markersRef.current.push(marker);
        });
      }

if (!bounds.isEmpty()) {
map.fitBounds(bounds, {
          padding: { top: 200, bottom: 200, left: 200, right: 200 },
maxZoom: singleTrip ? 6 : 7,
duration: 800,
});
}
});

return () => {
resizeObserver.disconnect();
      markersRef.current.forEach((marker) => marker.remove());
map.remove();
mapRef.current = null;
};
}, [steps, singleTrip]);

return (
<div
ref={containerRef}
className={className || `relative z-0 mb-8 w-full overflow-hidden rounded-2xl shadow-card${singleTrip ? "" : " max-w-4xl mx-auto"}`}
style={style || { height: singleTrip ? 900 : 750 }}
/>
);
});