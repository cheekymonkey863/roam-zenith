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

      // FIX: Ensure ALL valid stops get a marker, even if they have no photos
      const validSteps = steps.filter((s) => s.latitude !== 0 && s.longitude !== 0);
      const stepIds = validSteps.map((s) => s.id);

      const photoMap = new Map<string, string[]>();

      if (stepIds.length > 0) {
        const { data: photos } = await supabase
          .from("step_photos")
          .select("step_id, storage_path")
          .in("step_id", stepIds);

        if (photos) {
          for (const photo of photos) {
            const { data: urlData } = supabase.storage.from("trip-photos").getPublicUrl(photo.storage_path);
            const list = photoMap.get(photo.step_id) || [];
            if (list.length < 4) {
              // keep up to 4 images for the grid
              list.push(urlData.publicUrl);
            }
            photoMap.set(photo.step_id, list);
          }
        }
      }

      validSteps.forEach((step) => {
        const el = document.createElement("div");
        el.className = "custom-map-marker group relative cursor-pointer flex flex-col items-center";

        const urls = photoMap.get(step.id) || [];
        const displayName = step.location_name || "Unknown Location";

        let innerImageHtml = "";

        // Render logic for 0, 1, or 2-4 images (Grid)
        if (urls.length === 0) {
          innerImageHtml = `<div class="h-4 w-4 rounded-full border-2 border-white shadow-lg bg-primary"></div>`;
        } else if (urls.length === 1) {
          innerImageHtml = `<img src="${urls[0]}" class="h-10 w-10 rounded-full object-cover border-2 border-white shadow-lg" />`;
        } else {
          const gridCells = urls.map((u) => `<img src="${u}" class="h-full w-full object-cover" />`).join("");
          innerImageHtml = `
                <div class="h-12 w-12 rounded-full border-2 border-white shadow-lg overflow-hidden grid grid-cols-2 grid-rows-2 bg-muted">
                  ${gridCells}
                </div>
             `;
        }

        el.innerHTML = `
            <div class="bg-card text-foreground text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg border border-border whitespace-nowrap mb-1 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none">
              ${displayName}
            </div>
            ${innerImageHtml}
          `;

        const marker = new mapboxgl.Marker(el).setLngLat([step.longitude, step.latitude]).addTo(map);

        markersRef.current.push(marker);
      });

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
