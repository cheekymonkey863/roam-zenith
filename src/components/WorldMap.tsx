import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;

mapboxgl.accessToken = "pk.eyJ1IjoicnNvdXNhMzE1IiwiYSI6ImNtbmo2Z3lsNDA4ajMyc3M0ZW40a2R5dG8ifQ.VO0pQrXPDmIQWzKbpB3lUg";

const ROUTE_COLOR = "#E74C5E";
const ROUTE_COLOR_ALT = [
  "#E74C5E",
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#8B5CF6",
];

export function WorldMap({ steps, singleTrip = false }: { steps: TripStep[]; singleTrip?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

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

      // Group by trip
      const byTrip = new Map<string, TripStep[]>();
      steps.forEach((s) => {
        const arr = byTrip.get(s.trip_id) || [];
        arr.push(s);
        byTrip.set(s.trip_id, arr);
      });

      const bounds = new mapboxgl.LngLatBounds();
      let colorIdx = 0;

      byTrip.forEach((tripSteps, tripId) => {
        const color = singleTrip ? ROUTE_COLOR : ROUTE_COLOR_ALT[colorIdx % ROUTE_COLOR_ALT.length];
        colorIdx++;

        const coordinates = tripSteps.map((s) => [s.longitude, s.latitude] as [number, number]);
        coordinates.forEach((c) => bounds.extend(c));

        // Solid route line — Polar Steps style
        if (coordinates.length > 1) {
          map.addSource(`route-${tripId}`, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates },
            },
          });

          // Outer glow/shadow
          map.addLayer({
            id: `route-glow-${tripId}`,
            type: "line",
            source: `route-${tripId}`,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": color,
              "line-width": singleTrip ? 6 : 5,
              "line-opacity": 0.2,
              "line-blur": 3,
            },
          });

          // Main route line
          map.addLayer({
            id: `route-line-${tripId}`,
            type: "line",
            source: `route-${tripId}`,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": color,
              "line-width": singleTrip ? 3.5 : 2.5,
              "line-opacity": 1,
            },
          });
        }

        // SVG icon strings
        const HOTEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z"/><path d="m9 16 .348-.24c1.465-1.013 3.84-1.013 5.304 0L15 16"/><path d="M8 7h.01"/><path d="M16 7h.01"/><path d="M12 7h.01"/><path d="M12 11h.01"/><path d="M16 11h.01"/><path d="M8 11h.01"/></svg>`;
        const PLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/></svg>`;
        const FOOD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>`;
        const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;

        const ICON_CONFIG: Record<string, { bg: string; svg: string }> = {
          transport: { bg: "#3B82F6", svg: PLANE_SVG },
          arrival: { bg: "#3B82F6", svg: PLANE_SVG },
          departure: { bg: "#3B82F6", svg: PLANE_SVG },
          accommodation: { bg: "#8B5CF6", svg: HOTEL_SVG },
          food: { bg: "#F97316", svg: FOOD_SVG },
          sightseeing: { bg: "#10B981", svg: PIN_SVG },
          activity: { bg: "#E74C5E", svg: PIN_SVG },
          border_crossing: { bg: "#F59E0B", svg: PIN_SVG },
          other: { bg: "#6B7280", svg: PIN_SVG },
        };

        // Determine effective type using name + description context
        function getEffectiveType(step: TripStep): string {
          const text = `${step.location_name || ""} ${step.description || ""} ${step.notes || ""}`;
          const isHotelContext = /hotel|resort|lodge|hostel|airbnb|check.?in|check.?out|inn\b|suites|marriott|hilton|hyatt|radisson|pullman|fairmont|sheraton|collection|vignette|sanctuary|palace|palacio/i.test(text);

          if (step.event_type === "accommodation") return "accommodation";
          if (step.event_type === "transport") return "transport";
          if (step.event_type === "arrival" || step.event_type === "departure") {
            return isHotelContext ? "accommodation" : "transport";
          }
          return step.event_type;
        }

        // Step markers — every step gets a colored icon
        tripSteps.forEach((step, i) => {
          const effectiveType = getEffectiveType(step);
          const iconCfg = ICON_CONFIG[effectiveType] || ICON_CONFIG["other"];

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
          el.style.transition = "transform 0.15s ease";
          el.innerHTML = iconCfg.svg;

          el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.3)"; });
          el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)"; });

          const label = step.location_name || step.country || `Step ${i + 1}`;
          const dateStr = new Date(step.recorded_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          const typeLabel = step.event_type.replace("_", " ");

          new mapboxgl.Marker({ element: el, anchor: "center" })
            .setLngLat([step.longitude, step.latitude])
            .setPopup(
              new mapboxgl.Popup({
                offset: 12,
                closeButton: false,
                className: "ps-popup",
              }).setHTML(
                `<div style="font-family:system-ui,-apple-system,sans-serif;padding:4px 2px;">
                  <div style="font-weight:600;font-size:14px;color:#1a1a2e;margin-bottom:2px;">${label}</div>
                  <div style="font-size:12px;color:#888;">${dateStr}</div>
                  <div style="font-size:11px;color:#aaa;text-transform:capitalize;margin-top:2px;">${typeLabel}</div>
                </div>`
              )
            )
            .addTo(map);
        });
      });

      // Fit bounds with padding
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
    };
  }, [steps, singleTrip]);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-2xl shadow-card"
      style={{ minHeight: singleTrip ? 420 : 340 }}
    />
  );
}
