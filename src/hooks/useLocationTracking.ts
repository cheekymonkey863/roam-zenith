import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface LocationState {
  isTracking: boolean;
  lastPosition: { lat: number; lng: number } | null;
  error: string | null;
}

export function useLocationTracking(activeTripId: string | null) {
  const { user } = useAuth();
  const [state, setState] = useState<LocationState>({
    isTracking: false,
    lastPosition: null,
    error: null,
  });
  const watchIdRef = useRef<number | null>(null);
  const lastSavedRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  const MIN_DISTANCE_M = 500; // Only save if moved > 500m
  const MIN_TIME_MS = 60000; // Only save once per minute

  const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const savePoint = useCallback(
    async (lat: number, lng: number, accuracy: number | null) => {
      if (!user || !activeTripId) return;

      const now = Date.now();
      if (lastSavedRef.current) {
        const dist = haversineDistance(lastSavedRef.current.lat, lastSavedRef.current.lng, lat, lng);
        const elapsed = now - lastSavedRef.current.time;
        if (dist < MIN_DISTANCE_M && elapsed < MIN_TIME_MS) return;
      }

      lastSavedRef.current = { lat, lng, time: now };

      await supabase.from("location_points").insert({
        user_id: user.id,
        trip_id: activeTripId,
        latitude: lat,
        longitude: lng,
        accuracy,
      });
    },
    [user, activeTripId]
  );

  const startTracking = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState((s) => ({ ...s, error: "Geolocation not supported" }));
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setState((s) => ({
          ...s,
          isTracking: true,
          lastPosition: { lat: latitude, lng: longitude },
          error: null,
        }));
        savePoint(latitude, longitude, accuracy);
      },
      (err) => {
        setState((s) => ({ ...s, error: err.message }));
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
    );

    watchIdRef.current = id;
    setState((s) => ({ ...s, isTracking: true }));
  }, [savePoint]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setState((s) => ({ ...s, isTracking: false }));
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return { ...state, startTracking, stopTracking };
}
