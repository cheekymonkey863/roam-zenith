import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;

interface WorldMapProps {
  steps: TripStep[];
  singleTrip?: boolean;
}

export function WorldMap({ steps, singleTrip = false }: WorldMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  // Filter out steps that don't have valid coordinates
  const validSteps = steps.filter(
    (step) => step.latitude !== null && step.longitude !== null && step.latitude !== 0 && step.longitude !== 0,
  );

  useEffect(() => {
    if (!mapContainer.current) return;

    // Initialize Mapbox
    mapboxgl.accessToken = "YOUR_MAPBOX_ACCESS_TOKEN"; // Ensure this is set in your env

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11", // Using dark theme to match your UI
      center: [0, 20],
      zoom: 1.5,
      projection: "globe" as any,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "bottom-right");

    map.current.on("style.load", () => {
      if (!map.current) return;
      map.current.setFog({}); // Add the atmosphere effect

      if (validSteps.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();

        validSteps.forEach((step) => {
          const lng = step.longitude as number;
          const lat = step.latitude as number;

          bounds.extend([lng, lat]);

          // Create Marker
          const el = document.createElement("div");
          el.className = "h-3 w-3 rounded-full bg-primary border-2 border-white shadow-lg";

          new mapboxgl.Marker(el)
            .setLngLat([lng, lat])
            .setPopup(
              new mapboxgl.Popup({ offset: 25 }).setHTML(`<p className="font-bold text-sm">${step.location_name}</p>`),
            )
            .addTo(map.current!);
        });

        // Add lines between points if it's a single trip
        if (singleTrip && validSteps.length > 1) {
          const coordinates = validSteps.map((s) => [s.longitude, s.latitude]);
          map.current.addSource("route", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: coordinates as any,
              },
            },
          });

          map.current.addLayer({
            id: "route",
            type: "line",
            source: "route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": "#ef4444", // Your primary red
              "line-width": 2,
              "line-dasharray": [2, 1],
            },
          });
        }

        // Fit map to show all pins
        map.current.fitBounds(bounds, {
          padding: 50,
          maxZoom: singleTrip ? 8 : 3,
          duration: 2000,
        });
      }
    });

    return () => map.current?.remove();
  }, [steps, singleTrip]);

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainer} className="h-full w-full" />
    </div>
  );
}
