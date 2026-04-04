import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, type CSSProperties } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { inferStepVisualType, type StepVisualType } from "@/lib/stepVisuals";
import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;

mapboxgl.accessToken = "pk.eyJ1IjoicnNvdXNhMzE1IiwiYSI6ImNtbmo2Z3lsNDA4ajMyc3M0ZW40a2R5dG8ifQ.VO0pQrXPDmIQWzKbpB3lUg";

const ROUTE_COLOR = "#E74C5E";
const ROUTE_COLOR_ALT = ["#E74C5E", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6"];

const HOTEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z"/><path d="m9 16 .348-.24c1.465-1.013 3.84-1.013 5.304 0L15 16"/><path d="M8 7h.01"/><path d="M16 7h.01"/><path d="M12 7h.01"/><path d="M12 11h.01"/><path d="M16 11h.01"/><path d="M8 11h.01"/></svg>`;
const PLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/></svg>`;
const FOOD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>`;
const TRANSPORT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/><path d="m12 19-7-7 7-7"/></svg>`;
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;

const VISUAL_CONFIG: Record<StepVisualType, { bg: string; svg: string }> = {
  airport: { bg: "#2563EB", svg: PLANE_SVG },
  hotel: { bg: "#8B5CF6", svg: HOTEL_SVG },
  food: { bg: "#F97316", svg: FOOD_SVG },
  sightseeing: { bg: "#10B981", svg: PIN_SVG },
  border: { bg: "#F59E0B", svg: PIN_SVG },
  transport: { bg: "#0284C7", svg: TRANSPORT_SVG },
  activity: { bg: ROUTE_COLOR, svg: PIN_SVG },
  other: { bg: "#6B7280", svg: PIN_SVG },
};

function getOffsetCoordinates(longitude: number, latitude: number, index: number, total: number): [number, number] {
  if (total <= 1) return [longitude, latitude];
  const radiusMeters = total <= 4 ? 220 : total <= 8 ? 320 : 420;
  const angle = (2 * Math.PI * index) / total;
  const latOffset = (radiusMeters * Math.sin(angle)) / 111320;
  const lngOffset = (radiusMeters * Math.cos(angle)) / (111320 * Math.cos((latitude * Math.PI) / 180) || 1);
  return [longitude + lngOffset, latitude + latOffset];
}

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
  { steps, singleTrip = false, visualTypes = {}, activeStepId, className, style },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, { marker: mapboxgl.Marker; el: HTMLDivElement }>>(new Map());
  const stepsRef = useRef<TripStep[]>(steps);
  stepsRef.current = steps;

  const flyToStep = useCallback((step: TripStep) => {
    const map = mapRef.current;
    if (!map) return;
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
    stepsRef.current.forEach((s) => bounds.extend([s.longitude, s.latitude]));
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 800 });
    }
  }, []);

  const highlightStep = useCallback((stepId: string | null) => {
    markersRef.current.forEach(({ el }, id) => {
      if (id === stepId) {
        el.style.transform = "scale(1.4)";
        el.style.zIndex = "10";
        el.style.boxShadow = "0 0 0 3px rgba(255,255,255,0.9), 0 0 12px rgba(231,76,94,0.6)";
      } else {
        el.style.transform = "scale(1)";
        el.style.zIndex = "1";
        el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
      }
    });
  }, []);

  useImperativeHandle(ref, () => ({ flyToStep, fitAllSteps, highlightStep }), [flyToStep, fitAllSteps, highlightStep]);

  // Highlight active step when activeStepId prop changes
  useEffect(() => {
    if (activeStepId !== undefined) {
      highlightStep(activeStepId);
    }
  }, [activeStepId, highlightStep]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
    markersRef.current.clear();

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

    map.on("load", () => {
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

        const routeCoordinates = tripSteps.map((step) => [step.longitude, step.latitude] as [number, number]);
        routeCoordinates.forEach((coordinate) => bounds.extend(coordinate));

        if (routeCoordinates.length > 1) {
          map.addSource(`route-${tripId}`, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: routeCoordinates },
            },
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

        const clusterCounts = new Map<string, number>();
        const clusterIndexes = new Map<string, number>();

        tripSteps.forEach((step) => {
          const clusterKey = `${step.latitude.toFixed(5)},${step.longitude.toFixed(5)}`;
          clusterCounts.set(clusterKey, (clusterCounts.get(clusterKey) || 0) + 1);
        });

        tripSteps.forEach((step, index) => {
          const visualType = visualTypes[step.id] || inferStepVisualType(step);
          const iconCfg = VISUAL_CONFIG[visualType] || VISUAL_CONFIG.other;
          const clusterKey = `${step.latitude.toFixed(5)},${step.longitude.toFixed(5)}`;
          const clusterIndex = clusterIndexes.get(clusterKey) || 0;
          const clusterSize = clusterCounts.get(clusterKey) || 1;
          clusterIndexes.set(clusterKey, clusterIndex + 1);

          const [displayLongitude, displayLatitude] = getOffsetCoordinates(
            step.longitude, step.latitude, clusterIndex, clusterSize
          );

          const el = document.createElement("div");
          el.style.width = "24px";
          el.style.height = "24px";
          el.style.borderRadius = "6px";
          el.style.backgroundColor = iconCfg.bg;
          el.style.display = "flex";
          el.style.alignItems = "center";
          el.style.justifyContent = "center";
          el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
          el.style.cursor = "pointer";
          el.style.transition = "transform 0.2s ease, box-shadow 0.2s ease";
          el.innerHTML = iconCfg.svg;

          const label = step.location_name || step.country || `Step ${index + 1}`;
          const dateStr = new Date(step.recorded_at).toLocaleDateString("en-US", {
            month: "short", day: "numeric", year: "numeric",
          });

          const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
            .setLngLat([displayLongitude, displayLatitude])
            .setPopup(
              new mapboxgl.Popup({ offset: 12, closeButton: false, className: "ps-popup" }).setHTML(
                `<div style="font-family:system-ui,-apple-system,sans-serif;padding:4px 2px;">
                  <div style="font-weight:600;font-size:14px;color:#1a1a2e;margin-bottom:2px;">${label}</div>
                  <div style="font-size:12px;color:#888;">${dateStr}</div>
                  <div style="font-size:11px;color:#aaa;text-transform:capitalize;margin-top:2px;">${step.event_type.replace("_", " ")}</div>
                </div>`
              )
            )
            .addTo(map);

          markersRef.current.set(step.id, { marker, el });
        });
      });

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: { top: 60, bottom: 60, left: 60, right: 60 },
          maxZoom: singleTrip ? 14 : 12,
          duration: 800,
        });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, [steps, singleTrip, visualTypes]);

  return (
    <div
      ref={containerRef}
      className={className ?? "relative w-full overflow-hidden rounded-2xl shadow-card"}
      style={style ?? { minHeight: singleTrip ? 420 : 340 }}
    />
  );
});
