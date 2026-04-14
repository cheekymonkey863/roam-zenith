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
center: [0, 20],
zoom: 1.8,
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
let colorIdx = 0;

      // 1. Draw the lines
byTrip.forEach((tripSteps, tripId) => {
const color = singleTrip ? ROUTE_COLOR : ROUTE_COLOR_ALT[colorIdx % ROUTE_COLOR_ALT.length];
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
paint: { "line-color": color, "line-width": singleTrip ? 6 : 5, "line-opacity": 0.2, "line-blur": 3 },
});

map.addLayer({
id: `route-line-${tripId}`,
type: "line",
source: `route-${tripId}`,
layout: { "line-join": "round", "line-cap": "round" },
paint: { "line-color": color, "line-width": singleTrip ? 3.5 : 2.5, "line-opacity": 1 },
});
}
});

      // 2. Build markers — photo thumbnails + full names on trip page, city labels on dashboard
      const validSteps = steps.filter((s) => s.latitude !== 0 && s.longitude !== 0);
      const stepIds = validSteps.map((s) => s.id);

      // Fetch photos only for trip detail view
      const photoMap = new Map<string, string>();
      if (singleTrip && stepIds.length > 0) {
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
        validSteps.forEach((step) => {
          const el = document.createElement("div");
          el.className = "custom-map-marker group relative cursor-pointer flex flex-col items-center";

          const imgUrl = photoMap.get(step.id);
          const displayName = step.location_name || "Unknown Location";

          el.innerHTML = `
            <div class="bg-card text-foreground text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg border border-border whitespace-nowrap mb-1">
              ${displayName}
            </div>
            <div class="h-10 w-10 rounded-full border-2 border-white shadow-lg overflow-hidden bg-muted flex items-center justify-center">
              ${
                imgUrl
                  ? `<img src="${imgUrl}" class="h-full w-full object-cover" />`
                  : `<div class="w-2.5 h-2.5 rounded-full bg-primary"></div>`
              }
            </div>
          `;

          const marker = new mapboxgl.Marker(el).setLngLat([step.longitude, step.latitude]).addTo(map);
          markersRef.current.push(marker);
        });
      } else {
        // Dashboard: deduplicated city-name labels only
        const citySet = new Map<string, { lng: number; lat: number }>();
        validSteps.forEach((step) => {
          // Extract city: use the first comma-separated segment, or fall back to location_name
          const raw = step.location_name || step.country || "Unknown";
          const parts = raw.split(",").map((p) => p.trim());
          // For "Place, City, Country" take the city (2nd part), otherwise use first part
          const cityName = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
          if (!citySet.has(cityName)) {
            citySet.set(cityName, { lng: step.longitude, lat: step.latitude });
          }
        });

        citySet.forEach((coords, cityName) => {
          const el = document.createElement("div");
          el.className = "custom-map-marker flex flex-col items-center";

          el.innerHTML = `
            <div class="bg-card/90 text-foreground text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg border border-border whitespace-nowrap mb-1">
              ${cityName}
            </div>
            <div class="w-2.5 h-2.5 rounded-full bg-primary shadow-md"></div>
          `;

          const marker = new mapboxgl.Marker(el).setLngLat([coords.lng, coords.lat]).addTo(map);
          markersRef.current.push(marker);
        });
      }

if (!bounds.isEmpty()) {
map.fitBounds(bounds, {
          padding: { top: 80, bottom: 80, left: 80, right: 80 },
maxZoom: singleTrip ? 14 : 12,
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
className={className || "relative z-0 max-h-[40vh] mb-8 w-full overflow-hidden rounded-2xl shadow-card"}
style={style || { minHeight: singleTrip ? 420 : 340 }}
/>
);
});