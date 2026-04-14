import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

export interface WorldMapHandle {
  flyToStep: (step: { latitude: number; longitude: number }) => void;
  highlightStep: (stepId: string) => void;
}

interface WorldMapProps {
  steps: any[];
  singleTrip?: boolean;
  visualTypes?: Record<string, string>;
  activeStepId?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

export const WorldMap = forwardRef<WorldMapHandle, WorldMapProps>(
  ({ steps, singleTrip = false, visualTypes, activeStepId, className, style }, ref) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

    // Filter out invalid coordinates (0,0 or null)
    const validSteps = steps.filter(
      (step) => step.latitude && step.longitude && Math.abs(step.latitude) > 0.1 && Math.abs(step.longitude) > 0.1,
    );

    useImperativeHandle(ref, () => ({
      flyToStep: (step) => {
        if (map.current && step.latitude && step.longitude) {
          map.current.flyTo({
            center: [Number(step.longitude), Number(step.latitude)],
            zoom: 12,
            duration: 1200,
          });
        }
      },
      highlightStep: (stepId) => {
        markersRef.current.forEach((marker, id) => {
          const el = marker.getElement();
          if (id === stepId) {
            el.classList.add("ring-2", "ring-white", "scale-125");
          } else {
            el.classList.remove("ring-2", "ring-white", "scale-125");
          }
        });
      },
    }));

    useEffect(() => {
      if (!mapContainer.current) return;

      mapboxgl.accessToken = "pk.eyJ1IjoibG92YWJsZSIsImEiOiJjbHRreXJreXQwM3B3MmlwZndma3Z4eXN6In0.XN3R3_Yh7m6v6n6z6z6z6z";

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        projection: "globe" as any,
        center: [0, 20],
        zoom: 1.5,
        attributionControl: false,
        pitchWithRotate: false,
        dragRotate: false,
      });

      map.current.on("style.load", () => {
        if (!map.current) return;

        map.current.setFog({
          color: "rgb(186, 210, 245)",
          "high-color": "rgb(36, 92, 223)",
          "horizon-blend": 0.02,
          "space-color": "rgb(11, 11, 25)",
          "star-intensity": 0.6,
        });

        if (validSteps.length === 0) return;

        const bounds = new mapboxgl.LngLatBounds();

        markersRef.current.clear();
        validSteps.forEach((step) => {
          const coords: [number, number] = [Number(step.longitude), Number(step.latitude)];
          bounds.extend(coords);

          const el = document.createElement("div");
          el.className = "h-3 w-3 rounded-full bg-red-500 border-2 border-white shadow-lg shadow-red-500/50 transition-transform";

          const marker = new mapboxgl.Marker(el)
            .setLngLat(coords)
            .setPopup(
              new mapboxgl.Popup({ offset: 25 }).setHTML(`<p class="text-xs font-bold p-1">${step.location_name || ""}</p>`),
            )
            .addTo(map.current!);

          if (step.id) {
            markersRef.current.set(step.id, marker);
          }
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
              "line-color": "#E74C5E",
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
        markersRef.current.clear();
        if (map.current) {
          map.current.remove();
        }
      };
    }, [steps, singleTrip]);

    return (
      <div className={className || "relative h-full w-full"} style={style}>
        <div ref={mapContainer} className="h-full w-full" />
      </div>
    );
  }
);

WorldMap.displayName = "WorldMap";
