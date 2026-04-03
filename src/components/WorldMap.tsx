import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;

mapboxgl.accessToken = "pk.eyJ1IjoicnNvdXNhMzE1IiwiYSI6ImNtbmo2Z3lsNDA4ajMyc3M0ZW40a2R5dG8ifQ.VO0pQrXPDmIQWzKbpB3lUg";

const COLORS = [
  "#4A90D9",
  "#3DAA8F",
  "#D95B7A",
  "#D4A843",
  "#9B6DC9",
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
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [0, 20],
      zoom: 1.5,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");

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
        const color = COLORS[colorIdx % COLORS.length];
        colorIdx++;

        const coordinates = tripSteps.map((s) => [s.longitude, s.latitude] as [number, number]);
        coordinates.forEach((c) => bounds.extend(c));

        // Route line
        map.addSource(`route-${tripId}`, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates },
          },
        });
        map.addLayer({
          id: `route-line-${tripId}`,
          type: "line",
          source: `route-${tripId}`,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": color,
            "line-width": singleTrip ? 4 : 3,
            "line-opacity": 0.85,
            ...(singleTrip ? {} : { "line-dasharray": [2, 1.5] }),
          },
        });

        // Step markers
        tripSteps.forEach((step, i) => {
          const isEndpoint = i === 0 || i === tripSteps.length - 1;
          const el = document.createElement("div");
          el.style.width = isEndpoint ? "14px" : "10px";
          el.style.height = isEndpoint ? "14px" : "10px";
          el.style.borderRadius = "50%";
          el.style.backgroundColor = color;
          el.style.border = "2px solid white";
          el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
          el.style.cursor = "pointer";

          const label = step.location_name || step.country || `Step ${i + 1}`;
          new mapboxgl.Marker({ element: el })
            .setLngLat([step.longitude, step.latitude])
            .setPopup(
              new mapboxgl.Popup({ offset: 12, closeButton: false }).setHTML(
                `<div style="font-family:inherit;font-size:13px;padding:2px 0;">
                  <strong>${label}</strong><br/>
                  <span style="color:#888;">${new Date(step.recorded_at).toLocaleDateString()}</span>
                </div>`
              )
            )
            .addTo(map);
        });
      });

      // Fit bounds
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 50, maxZoom: 12, duration: 1000 });
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
      style={{ minHeight: singleTrip ? 400 : 320 }}
    />
  );
}
