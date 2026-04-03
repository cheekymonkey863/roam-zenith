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

        // Step markers — white circles with colored border, Polar Steps style
        tripSteps.forEach((step, i) => {
          const isEndpoint = i === 0 || i === tripSteps.length - 1;

          const el = document.createElement("div");
          const size = isEndpoint ? 16 : 10;
          el.style.width = `${size}px`;
          el.style.height = `${size}px`;
          el.style.borderRadius = "50%";
          el.style.backgroundColor = "#FFFFFF";
          el.style.border = `${isEndpoint ? 3 : 2}px solid ${color}`;
          el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.2)";
          el.style.cursor = "pointer";
          el.style.transition = "transform 0.15s ease";
          el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.3)"; });
          el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)"; });

          const label = step.location_name || step.country || `Step ${i + 1}`;
          const dateStr = new Date(step.recorded_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });

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
