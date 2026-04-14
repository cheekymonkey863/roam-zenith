/**
 * Module-level store to pass files and extracted metadata
 * from the "Add a Trip" form to the TripDetail page.
 * This avoids serialization issues with File objects through navigation state.
 */

export interface PendingStop {
  locationName: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  eventType: string;
  date: string | null;
  description: string;
  notes: string;
}

export interface PendingImport {
  type: "photos" | "document" | "inbox";
  files: File[];
  stops: PendingStop[];
  countries: string[];
  startDate: string | null;
  endDate: string | null;
}

let _pending: PendingImport | null = null;

export function setPendingImport(data: PendingImport) {
  _pending = data;
}

export function consumePendingImport(): PendingImport | null {
  const data = _pending;
  _pending = null;
  return data;
}

export function hasPendingImport(): boolean {
  return _pending !== null;
}
