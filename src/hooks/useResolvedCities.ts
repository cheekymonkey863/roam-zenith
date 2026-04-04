import { useEffect, useMemo, useState } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { ensureGoogleMapsLoaded, getGoogle } from "@/hooks/useGooglePlacesSearch";

type TripStep = Tables<"trip_steps">;

const CITY_COMPONENT_PRIORITY = [
  "locality",
  "postal_town",
  "administrative_area_level_2",
  "administrative_area_level_3",
] as const;

const cityResolutionCache = new Map<string, Promise<string | null>>();

function normalizeCityKey(value: string) {
  return value.trim().toLowerCase();
}

function isValidCoordinate(latitude: number | null | undefined, longitude: number | null | undefined) {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    !(latitude === 0 && longitude === 0)
  );
}

function buildCoordinateKey(step: Pick<TripStep, "latitude" | "longitude">) {
  return `${step.latitude.toFixed(5)}:${step.longitude.toFixed(5)}`;
}

function getLocationNameFallback(step: Pick<TripStep, "location_name">) {
  return typeof step.location_name === "string" && step.location_name.trim().length > 0
    ? step.location_name.trim()
    : null;
}

function extractCityName(results: any[] | null) {
  if (!results?.length) return null;

  for (const type of CITY_COMPONENT_PRIORITY) {
    for (const result of results) {
      const components: any[] = result.address_components || [];
      const match = components.find((component: any) => component.types?.includes(type));
      if (typeof match?.long_name === "string" && match.long_name.trim().length > 0) {
        return match.long_name.trim();
      }
    }
  }

  return null;
}

const GEOCODE_TIMEOUT_MS = 6000;

async function resolveCityName(step: TripStep): Promise<string | null> {
  if (!isValidCoordinate(step.latitude, step.longitude)) {
    return getLocationNameFallback(step);
  }

  const cacheKey = buildCoordinateKey(step);
  const cached = cityResolutionCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    try {
      await ensureGoogleMapsLoaded();
      const g = getGoogle();
      if (!g?.maps) return getLocationNameFallback(step);

      const geocoder = new g.maps.Geocoder();
      const location = new g.maps.LatLng(step.latitude, step.longitude);
      const results = await new Promise<any[] | null>((resolve, reject) => {
        const timer = window.setTimeout(() => resolve(null), GEOCODE_TIMEOUT_MS);
        geocoder.geocode({ location }, (matches: any[], status: string) => {
          window.clearTimeout(timer);
          if (status === "OK" && matches?.length > 0) {
            resolve(matches);
          } else {
            resolve(null);
          }
        });
      });

      return extractCityName(results) ?? getLocationNameFallback(step);
    } catch {
      return getLocationNameFallback(step);
    }
  })();

  cityResolutionCache.set(cacheKey, promise);
  return promise;
}

export function useResolvedCities(steps: TripStep[]) {
  const [cities, setCities] = useState<string[]>([]);
  const [isResolvingCities, setIsResolvingCities] = useState(false);

  const stepsToResolve = useMemo(() => {
    const uniqueSteps = new Map<string, TripStep>();

    for (const step of steps) {
      const key = isValidCoordinate(step.latitude, step.longitude)
        ? buildCoordinateKey(step)
        : `fallback:${step.country ?? ""}:${step.location_name ?? ""}`;

      if (!uniqueSteps.has(key)) {
        uniqueSteps.set(key, step);
      }
    }

    return Array.from(uniqueSteps.values());
  }, [steps]);

  useEffect(() => {
    let cancelled = false;

    if (stepsToResolve.length === 0) {
      setCities([]);
      setIsResolvingCities(false);
      return;
    }

    setIsResolvingCities(true);

    void Promise.all(stepsToResolve.map(resolveCityName))
      .then((resolvedCities) => {
        if (cancelled) return;

        const uniqueCities = new Map<string, string>();
        for (const city of resolvedCities) {
          if (!city) continue;
          const normalized = normalizeCityKey(city);
          if (!uniqueCities.has(normalized)) {
            uniqueCities.set(normalized, city);
          }
        }

        setCities(Array.from(uniqueCities.values()));
      })
      .finally(() => {
        if (!cancelled) {
          setIsResolvingCities(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [stepsToResolve]);

  return {
    cities,
    cityCount: cities.length,
    isResolvingCities,
  };
}