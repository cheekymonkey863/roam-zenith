import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;

const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

const COLORS = [
  "hsl(210, 60%, 55%)",
  "hsl(165, 45%, 48%)",
  "hsl(340, 65%, 55%)",
  "hsl(45, 80%, 50%)",
  "hsl(280, 50%, 55%)",
];

export function WorldMap({ steps, singleTrip = false }: { steps: TripStep[]; singleTrip?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true,
    }).setView([20, 0], 2);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.attribution({ position: "bottomleft" }).addTo(map);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 18 }).addTo(map);

    mapRef.current = map;

    if (steps.length === 0) return;

    // Group by trip
    const byTrip = new Map<string, TripStep[]>();
    steps.forEach((s) => {
      const arr = byTrip.get(s.trip_id) || [];
      arr.push(s);
      byTrip.set(s.trip_id, arr);
    });

    const allLatLngs: L.LatLng[] = [];
    let colorIdx = 0;

    byTrip.forEach((tripSteps) => {
      const color = COLORS[colorIdx % COLORS.length];
      colorIdx++;

      const latlngs = tripSteps.map((s) => L.latLng(s.latitude, s.longitude));
      allLatLngs.push(...latlngs);

      // Route line
      L.polyline(latlngs, {
        color,
        weight: 3,
        opacity: 0.8,
        dashArray: singleTrip ? undefined : "8,6",
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);

      // Step markers
      tripSteps.forEach((step, i) => {
        const isEndpoint = i === 0 || i === tripSteps.length - 1;
        const marker = L.circleMarker([step.latitude, step.longitude], {
          radius: isEndpoint ? 7 : 5,
          fillColor: color,
          color: "white",
          weight: 2,
          fillOpacity: 0.9,
        }).addTo(map);

        const label = step.location_name || step.country || `Step ${i + 1}`;
        marker.bindPopup(
          `<div style="font-family:inherit;font-size:13px;">
            <strong>${label}</strong><br/>
            <span style="color:#888;">${new Date(step.recorded_at).toLocaleDateString()}</span>
          </div>`
        );
      });
    });

    // Fit bounds
    if (allLatLngs.length > 1) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40], maxZoom: 12 });
    } else if (allLatLngs.length === 1) {
      map.setView(allLatLngs[0], 10);
    }

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
