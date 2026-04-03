/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef, useCallback } from "react";

const GOOGLE_MAPS_API_KEY = "AIzaSyCHXGKSMbpkEN5Amr0VRDF44cLcOg_JUD8";

declare global {
  interface Window {
    google: any;
  }
}

export interface PlaceResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    country?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
  };
}

let scriptLoaded = false;
let scriptLoading = false;
const loadCallbacks: (() => void)[] = [];

function ensureGoogleMapsLoaded(): Promise<void> {
  if (scriptLoaded && window.google?.maps?.places) return Promise.resolve();
  return new Promise((resolve) => {
    if (scriptLoading) {
      loadCallbacks.push(resolve);
      return;
    }
    scriptLoading = true;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.onload = () => {
      scriptLoaded = true;
      scriptLoading = false;
      resolve();
      loadCallbacks.forEach((cb) => cb());
      loadCallbacks.length = 0;
    };
    script.onerror = () => {
      scriptLoading = false;
      resolve(); // fail silently, search will just not work
    };
    document.head.appendChild(script);
  });
}

export function useGooglePlacesSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const serviceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const dummyDiv = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureGoogleMapsLoaded().then(() => {
      if (window.google?.maps?.places) {
        serviceRef.current = new google.maps.places.AutocompleteService();
        if (!dummyDiv.current) {
          dummyDiv.current = document.createElement("div");
        }
        placesServiceRef.current = new google.maps.places.PlacesService(dummyDiv.current);
      }
    });
  }, []);

  useEffect(() => {
    if (query.length < 3) {
      setResults([]);
      setShowResults(false);
      return;
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      if (!serviceRef.current || !placesServiceRef.current) {
        // Fallback to Nominatim if Google not loaded
        setSearching(true);
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`,
            { headers: { "Accept-Language": "en" } }
          );
          const data = await res.json();
          setResults(data.map((item: any) => ({
            display_name: item.display_name,
            lat: item.lat,
            lon: item.lon,
            address: item.address,
          })));
          setShowResults(true);
        } catch {
          setResults([]);
        }
        setSearching(false);
        return;
      }

      setSearching(true);
      serviceRef.current.getPlacePredictions(
        { input: query },
        (predictions, status) => {
          if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
            setResults([]);
            setSearching(false);
            setShowResults(true);
            return;
          }

          let completed = 0;
          const mapped: PlaceResult[] = [];

          predictions.slice(0, 5).forEach((prediction, i) => {
            placesServiceRef.current!.getDetails(
              { placeId: prediction.place_id, fields: ["geometry", "address_components", "formatted_address"] },
              (place, detailStatus) => {
                if (detailStatus === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
                  const countryComp = place.address_components?.find((c) => c.types.includes("country"));
                  const cityComp = place.address_components?.find((c) => c.types.includes("locality"));
                  const townComp = place.address_components?.find((c) => c.types.includes("administrative_area_level_2"));
                  const stateComp = place.address_components?.find((c) => c.types.includes("administrative_area_level_1"));

                  mapped[i] = {
                    display_name: place.formatted_address || prediction.description,
                    lat: String(place.geometry.location.lat()),
                    lon: String(place.geometry.location.lng()),
                    address: {
                      country: countryComp?.long_name,
                      city: cityComp?.long_name,
                      town: townComp?.long_name,
                      state: stateComp?.long_name,
                    },
                  };
                }
                completed++;
                if (completed === Math.min(predictions.length, 5)) {
                  setResults(mapped.filter(Boolean));
                  setShowResults(true);
                  setSearching(false);
                }
              }
            );
          });
        }
      );
    }, 300);

    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (resultsRef.current && !resultsRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectPlace = useCallback((place: PlaceResult) => {
    setSelectedPlace(place);
    setQuery(place.display_name);
    setShowResults(false);
  }, []);

  const reset = useCallback(() => {
    setQuery("");
    setResults([]);
    setSelectedPlace(null);
    setShowResults(false);
  }, []);

  return {
    query, setQuery,
    results, searching, showResults, setShowResults,
    selectedPlace, setSelectedPlace,
    resultsRef, selectPlace, reset,
  };
}
