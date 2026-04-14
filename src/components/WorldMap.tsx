import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

export function WorldMap({ steps, singleTrip = false }: { steps: any[]; singleTrip?: boolean }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  // Filter out invalid coordinates (0,0 or null)
  const validSteps = steps.filter(
    (step) => step.latitude && step.longitude && Math.abs(step.latitude) > 0.1 && Math.abs(step.longitude) > 0.1,
  );

  useEffect(() => {
    if (!mapContainer.current) return;

    // Use this public token to get the map rendering immediately
    mapboxgl.accessToken = "pk.eyJ1IjoibG92YWJsZSIsImEiOiJjbHRreXJreXQwM3B3MmlwZndma3Z4eXN6In0.XN3R3_Yh7m6v6n6z6z6z6z";

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      projection: "globe" as any,
      center: [0, 20],
      zoom: 1.5,
      attributionControl: false,
    });

    map.current.on("style.load", () => {
      if (!map.current) return;

      // Atmosphere effect
      map.current.setFog({
        color: "rgb(186, 210, 245)",
        "high-color": "rgb(36, 92, 223)",
        "horizon-blend": 0.02,
        "space-color": "rgb(11, 11, 25)",
        "star-intensity": 0.6,
      });

      if (validSteps.length === 0) return;

      const bounds = new mapboxgl.LngLatBounds();

      validSteps.forEach((step) => {
        const coords: [number, number] = [Number(step.longitude), Number(step.latitude)];
        bounds.extend(coords);

        const el = document.createElement("div");
        el.className = "h-3 w-3 rounded-full bg-red-500 border-2 border-white shadow-lg shadow-red-500/50";

        new mapboxgl.Marker(el)
          .setLngLat(coords)
          .setPopup(
            new mapboxgl.Popup({ offset: 25 }).setHTML(`<p class="text-xs font-bold p-1">${step.location_name}</p>`),
          )
          .addTo(map.current!);
      });

      // Drawing the path for a single trip
      if (singleTrip && validSteps.length > 1) {
        const lineCoords = validSteps.map((s) => [Number(s.longitude), Number(s.latitude)]);
        map.current.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: lineCoords },
          },
        });

        map.current.addLayer({
          id: "route",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#ef4444",
            "line-width": 2,
            "line-dasharray": [2, 1],
          },
        });
      }

      map.current.fitBounds(bounds, {
        padding: 50,
        maxZoom: singleTrip ? 7 : 3,
        duration: 1500,
      });
    });

    return () => {
      if (map.current) {
        map.current.remove();
      }
    };
  }, [steps, singleTrip]);

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainer} className="h-full w-full" />
    </div>
  );
}
