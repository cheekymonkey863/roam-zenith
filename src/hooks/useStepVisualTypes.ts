import { useEffect, useMemo, useState } from "react";
import { ensureGoogleMapsLoaded, getGoogle } from "@/hooks/useGooglePlacesSearch";
import { inferStepVisualType, type StepVisualType } from "@/lib/stepVisuals";
import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;

const placeTypeCache = new Map<string, string[]>();

function getLookupKey(step: TripStep) {
  return `${step.location_name || ""}|${step.latitude.toFixed(4)}|${step.longitude.toFixed(4)}`;
}

async function fetchGooglePlaceTypes(step: TripStep): Promise<string[]> {
  const query = step.location_name?.trim() || step.description?.trim() || step.notes?.trim();
  if (!query) return [];

  const cacheKey = getLookupKey(step);
  const cached = placeTypeCache.get(cacheKey);
  if (cached) return cached;

  await ensureGoogleMapsLoaded();
  const google = getGoogle();
  if (!google?.maps?.places) {
    placeTypeCache.set(cacheKey, []);
    return [];
  }

  const host = document.createElement("div");
  const service = new google.maps.places.PlacesService(host);

  const types = await new Promise<string[]>((resolve) => {
    service.textSearch(
      {
        query,
        location: new google.maps.LatLng(step.latitude, step.longitude),
        radius: 50000,
      },
      (results: Array<{ types?: string[] }> | null, status: string) => {
        if (status !== "OK" || !results?.length) {
          resolve([]);
          return;
        }
        resolve(Array.isArray(results[0]?.types) ? results[0].types : []);
      }
    );
  });

  placeTypeCache.set(cacheKey, types);
  return types;
}

export function useStepVisualTypes(steps: TripStep[]) {
  const baseTypes = useMemo(
    () => Object.fromEntries(steps.map((step) => [step.id, inferStepVisualType(step)])),
    [steps]
  ) as Record<string, StepVisualType>;

  const [visualTypes, setVisualTypes] = useState<Record<string, StepVisualType>>(baseTypes);

  useEffect(() => {
    setVisualTypes(baseTypes);
  }, [baseTypes]);

  useEffect(() => {
    let cancelled = false;

    const enrichVisualTypes = async () => {
      const uniqueSteps = Array.from(new Map(steps.map((step) => [getLookupKey(step), step])).values());
      const googleTypesByLookup = new Map<string, string[]>();

      for (const step of uniqueSteps) {
        const lookupKey = getLookupKey(step);
        const googleTypes = await fetchGooglePlaceTypes(step);
        googleTypesByLookup.set(lookupKey, googleTypes);
      }

      if (cancelled) return;

      const nextTypes = Object.fromEntries(
        steps.map((step) => {
          const googleTypes = googleTypesByLookup.get(getLookupKey(step)) || [];
          return [step.id, inferStepVisualType(step, googleTypes)];
        })
      ) as Record<string, StepVisualType>;

      setVisualTypes(nextTypes);
    };

    void enrichVisualTypes();

    return () => {
      cancelled = true;
    };
  }, [steps]);

  return visualTypes;
}
