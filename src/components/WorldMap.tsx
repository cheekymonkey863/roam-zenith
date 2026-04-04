import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, type CSSProperties } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { inferStepVisualType, type StepVisualType } from "@/lib/stepVisuals";
import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;

mapboxgl.accessToken = "pk.eyJ1IjoicnNvdXNhMzE1IiwiYSI6ImNtbmo2Z3lsNDA4ajMyc3M0ZW40a2R5dG8ifQ.VO0pQrXPDmIQWzKbpB3lUg";

const ROUTE_COLOR = "#E74C5E";
const ROUTE_COLOR_ALT = ["#E74C5E", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6"];

// Transport SVGs at 20px for animated markers
const TRANSPORT_SVGS: Record<string, string> = {
  flight: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/></svg>`,
  train: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M8 3.1V7a4 4 0 0 0 8 0V3.1M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/></svg>`,
  bus: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none"><rect x="4" y="4" width="16" height="12" rx="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M4 10h16"/></svg>`,
  ferry: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M12 2v3"/></svg>`,
  car: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>`,
};

const TRANSPORT_TYPES = new Set(["flight", "train", "bus", "ferry", "car", "transport"]);

// Determine the transport mode for a segment between two steps
function getSegmentTransport(
  fromStep: TripStep,
  toStep: TripStep,
  visualTypes: Record<string, StepVisualType>
): StepVisualType | null {
  // Check destination step first (e.g. arriving at airport = flight segment)
  const toType = visualTypes[toStep.id] || inferStepVisualType(toStep);
  if (TRANSPORT_TYPES.has(toType)) return toType;

  // Check source step
  const fromType = visualTypes[fromStep.id] || inferStepVisualType(fromStep);
  if (TRANSPORT_TYPES.has(fromType)) return fromType;

  return null;
}

// Interpolate a point along a great-circle-ish path
function interpolatePosition(
  from: [number, number],
  to: [number, number],
  t: number
): [number, number] {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
  ];
}

// Calculate bearing between two points in degrees
function getBearing(from: [number, number], to: [number, number]): number {
  const dLng = ((to[0] - from[0]) * Math.PI) / 180;
  const lat1 = (from[1] * Math.PI) / 180;
  const lat2 = (to[1] * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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

interface AnimatedSegment {
  from: [number, number];
  to: [number, number];
  marker: mapboxgl.Marker;
  el: HTMLDivElement;
  bearing: number;
}

export const WorldMap = forwardRef<WorldMapHandle, WorldMapProps>(function WorldMap(
  { steps, singleTrip = false, visualTypes = {}, activeStepId, className, style },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const animFrameRef = useRef<number>(0);
  const segmentsRef = useRef<AnimatedSegment[]>([]);
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

  const highlightStep = useCallback((_stepId: string | null) => {
    // No static markers to highlight anymore
  }, []);

  useImperativeHandle(ref, () => ({ flyToStep, fitAllSteps, highlightStep }), [flyToStep, fitAllSteps, highlightStep]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
    cancelAnimationFrame(animFrameRef.current);
    segmentsRef.current = [];

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
      const animatedSegments: AnimatedSegment[] = [];

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

        // Create animated transport markers for each segment
        for (let i = 0; i < tripSteps.length - 1; i++) {
          const fromStep = tripSteps[i];
          const toStep = tripSteps[i + 1];
          const transportType = getSegmentTransport(fromStep, toStep, visualTypes);

          if (!transportType) continue;

          // Normalize to a known SVG key
          const svgKey = transportType === "transport" ? "car" : transportType;
          const svg = TRANSPORT_SVGS[svgKey];
          if (!svg) continue;

          const from: [number, number] = [fromStep.longitude, fromStep.latitude];
          const to: [number, number] = [toStep.longitude, toStep.latitude];
          const bearing = getBearing(from, to);

          const el = document.createElement("div");
          el.style.width = "32px";
          el.style.height = "32px";
          el.style.display = "flex";
          el.style.alignItems = "center";
          el.style.justifyContent = "center";
          el.style.filter = "drop-shadow(0 2px 4px rgba(0,0,0,0.5))";
          el.style.transition = "none";
          el.style.transform = `rotate(${bearing - 90}deg)`;
          el.innerHTML = svg;

          const marker = new mapboxgl.Marker({ element: el, anchor: "center", rotationAlignment: "map" })
            .setLngLat(from)
            .addTo(map);

          animatedSegments.push({ from, to, marker, el, bearing });
        }
      });

      segmentsRef.current = animatedSegments;

      // Animation loop - each segment icon moves from start to end continuously
      const CYCLE_DURATION = 6000; // ms for one full trip
      const startTime = performance.now();

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = (elapsed % CYCLE_DURATION) / CYCLE_DURATION;
        // Smooth ease in-out
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        for (const seg of segmentsRef.current) {
          const pos = interpolatePosition(seg.from, seg.to, eased);
          seg.marker.setLngLat(pos);
        }

        animFrameRef.current = requestAnimationFrame(animate);
      };

      if (animatedSegments.length > 0) {
        animFrameRef.current = requestAnimationFrame(animate);
      }

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: { top: 60, bottom: 60, left: 60, right: 60 },
          maxZoom: singleTrip ? 14 : 12,
          duration: 800,
        });
      }
    });

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      segmentsRef.current = [];
      map.remove();
      mapRef.current = null;
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
