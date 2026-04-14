import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

export function WorldMap({ steps, singleTrip = false }: { steps: any[]; singleTrip?: boolean }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  const validSteps = steps.filter(
    (step) => step.latitude && step.longitude && Math.abs(step.latitude) > 0.1 && Math.abs(step.longitude) > 0.1,
  );

  useEffect(() => {
    if (!mapContainer.current) return;
    mapboxgl.accessToken = "pk.eyJ1IjoibG92YWJsZSIsImEiOiJjbHRreXJreXQwM3B3MmlwZndma3Z4eXN6In0.XN3R3_Yh7m6v6n6z6z6z6z"; // Replace with your key if needed

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      projection: "globe" as any,
      center: [0, 20],
      zoom: 1.5,
    });

    map.current.on("style.load", () => {
      if (!map.current || validSteps.length === 0) return;
      const bounds = new mapboxgl.LngLatBounds();

      validSteps.forEach((step) => {
        bounds.extend([step.longitude, step.latitude]);
        const el = document.createElement("div");
        el.className = "h-3 w-3 rounded-full bg-red-500 border-2 border-white shadow-lg";
        new mapboxgl.Marker(el).setLngLat([step.longitude, step.latitude]).addTo(map.current!);
      });

      map.current.fitBounds(bounds, { padding: 50, maxZoom: singleTrip ? 7 : 3 });
    });

    return () => map.current?.remove();
  }, [steps]);

  return <div ref={mapContainer} className="h-full w-full" />;
}
