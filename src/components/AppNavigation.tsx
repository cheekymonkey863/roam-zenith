import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu, X, Plus, ChevronRight, ChevronDown, Image, FileText, Mail, Loader2, MapPin } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { parseTripCountriesInput } from "@/lib/tripManagement";
import { setPendingImport, type PendingStop } from "@/lib/pendingImportStore";
import { processImportedMediaFiles } from "@/lib/mediaImport";
import { getEventType } from "@/lib/eventTypes";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export function AppNavigation() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [groupedTrips, setGroupedTrips] = useState<any>({});
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [showTrips, setShowTrips] = useState(true);
  const [showAddTrip, setShowAddTrip] = useState(false);
  const [tripTitle, setTripTitle] = useState("");
  const [tripStartDate, setTripStartDate] = useState("");
  const [tripEndDate, setTripEndDate] = useState("");
  const [tripCountries, setTripCountries] = useState("");
  const [tripTrackBg, setTripTrackBg] = useState(false);
  const [creating, setCreating] = useState(false);

  // Import preview state
  const [navImportType, setNavImportType] = useState<"photos" | "document" | "inbox" | null>(null);
  const [navImportedStops, setNavImportedStops] = useState<PendingStop[]>([]);
  const [navPendingFiles, setNavPendingFiles] = useState<File[]>([]);
  const [navExtracting, setNavExtracting] = useState(false);

  const navPhotoInputRef = useRef<HTMLInputElement>(null);
  const navDocInputRef = useRef<HTMLInputElement>(null);

  const fetchTrips = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("trips")
      .select("*")
      .eq("user_id", user.id)
      .order("start_date", { ascending: false });
    if (!data) return;

    const grouped: any = {};
    data.forEach((trip) => {
      if (!trip.start_date) return;
      const start = new Date(trip.start_date);
      const end = trip.end_date ? new Date(trip.end_date) : start;
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
      while (cursor <= endMonth) {
        const year = cursor.getFullYear().toString();
        const month = MONTHS[cursor.getMonth()];
        if (!grouped[year]) grouped[year] = {};
        if (!grouped[year][month]) grouped[year][month] = [];
        if (!grouped[year][month].some((t: any) => t.id === trip.id)) {
          grouped[year][month].push(trip);
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
    });
    setGroupedTrips(grouped);
  };

  useEffect(() => { fetchTrips(); }, [user]);

  const years = Object.keys(groupedTrips).sort((a, b) => b.localeCompare(a));

  const generateNavTripTitle = (countries?: string[], sDate?: string, eDate?: string): string => {
    const c = countries ?? parseTripCountriesInput(tripCountries);
    const countryPart = c.length > 0 ? c.join(", ") : "New Trip";
    const sd = sDate ?? tripStartDate;
    const ed = eDate ?? tripEndDate;
    if (sd) {
      const startF = format(new Date(sd + "T00:00:00"), "MMM-yy");
      const endF = ed ? format(new Date(ed + "T00:00:00"), "MMM-yy") : startF;
      return startF === endF ? `${countryPart} | ${startF}` : `${countryPart} | ${startF} - ${endF}`;
    }
    return countryPart;
  };

  const autoFillNavFromStops = (stops: PendingStop[]) => {
    const countries = [...new Set(stops.map((s) => s.country).filter(Boolean))];
    const dates = stops.map((s) => (s.date ? new Date(s.date) : null)).filter(Boolean) as Date[];
    dates.sort((a, b) => a.getTime() - b.getTime());
    if (countries.length > 0) setTripCountries(countries.join(", "));
    if (dates.length > 0) {
      setTripStartDate(format(dates[0], "yyyy-MM-dd"));
      setTripEndDate(format(dates[dates.length - 1], "yyyy-MM-dd"));
    }
    if (!tripTitle.trim()) {
      setTripTitle(generateNavTripTitle(
        countries,
        dates.length > 0 ? format(dates[0], "yyyy-MM-dd") : "",
        dates.length > 0 ? format(dates[dates.length - 1], "yyyy-MM-dd") : ""
      ));
    }
  };

  const handleNavPhotoFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setNavExtracting(true);
    setNavImportType("photos");
    setNavPendingFiles(files);
    try {
      const result = await processImportedMediaFiles(files);
      const stops: PendingStop[] = result.steps.map((s) => ({
        locationName: s.locationName, country: s.country,
        latitude: s.latitude, longitude: s.longitude,
        eventType: s.eventType,
        date: s.earliestDate ? s.earliestDate.toISOString() : null,
        description: s.description, notes: "",
      }));
      setNavImportedStops(stops);
      autoFillNavFromStops(stops);
      toast.success(`Found ${stops.length} stops from ${files.length} files`);
    } catch {
      toast.error("Failed to extract photo metadata");
      setNavImportType(null);
      setNavPendingFiles([]);
    } finally {
      setNavExtracting(false);
    }
  }, [tripTitle]);

  const handleNavDocFiles = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setNavExtracting(true);
    setNavImportType("document");
    setNavPendingFiles([file]);
    try {
      const text = await file.text();
      if (text.length < 20) {
        toast.error("Could not extract enough text");
        setNavExtracting(false);
        setNavImportType(null);
        setNavPendingFiles([]);
        return;
      }
      const { data, error } = await supabase.functions.invoke("parse-itinerary", { body: { text } });
      if (error) throw error;
      const stops: PendingStop[] = (data?.activities || []).map((a: any) => ({
        locationName: a.locationName || a.activityName || "Unknown Location",
        country: [a.city, a.country].filter(Boolean).join(", "),
        latitude: a.latitude ?? null, longitude: a.longitude ?? null,
        eventType: a.eventType || "other", date: a.date || null,
        description: a.description || "", notes: a.notes || "",
      }));
      setNavImportedStops(stops);
      autoFillNavFromStops(stops);
      if (stops.length === 0) toast.error("No stops extracted");
      else toast.success(`Found ${stops.length} stops`);
    } catch {
      toast.error("Failed to parse document");
      setNavImportType(null);
      setNavPendingFiles([]);
    } finally {
      setNavExtracting(false);
    }
  }, [tripTitle]);

  const clearNavImport = () => {
    setNavImportType(null);
    setNavImportedStops([]);
    setNavPendingFiles([]);
  };

  const createNavTrip = async () => {
    if (!user) return;
    const finalTitle = tripTitle.trim() || generateNavTripTitle();
    if (!finalTitle || finalTitle === "New Trip") {
      toast.error("Please enter a trip name or import data first");
      return;
    }
    setCreating(true);
    try {
      const countries = parseTripCountriesInput(tripCountries);
      const { data, error } = await supabase
        .from("trips")
        .insert({
          user_id: user.id, title: finalTitle,
          start_date: tripStartDate || null, end_date: tripEndDate || null,
          is_active: tripTrackBg, countries,
        } as any)
        .select().single();
      if (error) throw error;

      if (navImportType && navPendingFiles.length > 0) {
        setPendingImport({
          type: navImportType, files: navPendingFiles, stops: navImportedStops,
          countries, startDate: tripStartDate || null, endDate: tripEndDate || null,
        });
      }

      toast.success("Trip created!");
      setShowAddTrip(false);
      setTripTitle(""); setTripStartDate(""); setTripEndDate("");
      setTripCountries(""); setTripTrackBg(false);
      clearNavImport();
      setIsOpen(false);
      fetchTrips();
      navigate(navImportType ? `/trip/${data.id}?import=${navImportType}` : `/trip/${data.id}`);
    } catch {
      toast.error("Failed to create trip");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-6 left-6 z-40 flex h-11 w-11 items-center justify-center rounded-xl bg-card border border-border shadow-md hover:bg-secondary transition-colors"
      >
        <Menu className="h-5 w-5" />
      </button>
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
      )}
      <div
        className={`fixed top-0 left-0 bottom-0 z-50 w-56 bg-card border-r border-border transition-transform duration-300 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex flex-col items-center p-4 border-b border-border relative">
          <button onClick={() => setIsOpen(false)} className="absolute top-3 right-3 p-2 hover:bg-secondary rounded-lg">
            <X className="h-5 w-5" />
          </button>
          <Link to="/" onClick={() => setIsOpen(false)}>
            <img src="/logo.png" alt="TravelTRKR" className="h-[81px] w-auto" />
          </Link>
        </div>
        <div className="p-4 overflow-y-auto h-[calc(100vh-100px)]">
          {/* Add a Trip */}
          <button
            onClick={() => setShowAddTrip(!showAddTrip)}
            className="flex w-full items-center gap-3 rounded-xl bg-primary/10 p-3 font-display text-sm font-semibold mb-2 hover:bg-primary/20 transition-colors"
            style={{ color: "#1e3a5f" }}
          >
            <Plus className="h-4 w-4" /> Add a Trip
            {showAddTrip ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
          </button>
          {showAddTrip && (
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-background p-3">
              {/* Import buttons */}
              <div className="grid grid-cols-3 gap-2">
                <button type="button" disabled={navExtracting || creating}
                  onClick={() => navPhotoInputRef.current?.click()}
                  className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-xs hover:bg-secondary/40 transition-colors disabled:opacity-50">
                  <Image className="h-4 w-4 text-primary" /> Photos
                </button>
                <button type="button" disabled={navExtracting || creating}
                  onClick={() => navDocInputRef.current?.click()}
                  className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-xs hover:bg-secondary/40 transition-colors disabled:opacity-50">
                  <FileText className="h-4 w-4 text-primary" /> Document
                </button>
                <button type="button" disabled={navExtracting || creating}
                  onClick={() => {
                    if (!user) return;
                    const inboxTitle = tripTitle.trim() || "New Trip";
                    setCreating(true);
                    supabase.from("trips").insert({
                      user_id: user.id, title: inboxTitle,
                      start_date: tripStartDate || null, end_date: tripEndDate || null,
                      is_active: tripTrackBg, countries: parseTripCountriesInput(tripCountries),
                    } as any).select().single().then(({ data, error }) => {
                      setCreating(false);
                      if (error || !data) { toast.error("Failed to create trip"); return; }
                      toast.success("Trip created!");
                      setShowAddTrip(false); setIsOpen(false); fetchTrips();
                      navigate(`/trip/${data.id}?import=inbox`);
                    });
                  }}
                  className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-xs hover:bg-secondary/40 transition-colors disabled:opacity-50">
                  <Mail className="h-4 w-4 text-primary" /> Inbox
                </button>
              </div>
              <input ref={navPhotoInputRef} type="file" accept="image/*,video/*,.heic,.heif" multiple className="hidden"
                onChange={(e) => { const f = Array.from(e.target.files || []); if (f.length > 0) handleNavPhotoFiles(f); e.target.value = ""; }} />
              <input ref={navDocInputRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden"
                onChange={(e) => { const f = Array.from(e.target.files || []); if (f.length > 0) handleNavDocFiles(f); e.target.value = ""; }} />

              {/* Extracting indicator */}
              {navExtracting && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/20 p-2">
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Extracting...</span>
                </div>
              )}

              {/* Stop preview */}
              {navImportedStops.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Stops ({navImportedStops.length})</span>
                    <button type="button" onClick={clearNavImport} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                  </div>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-card">
                    {navImportedStops.map((stop, i) => {
                      const evtType = getEventType(stop.eventType);
                      const Icon = evtType?.icon || MapPin;
                      return (
                        <div key={i} className="flex items-center gap-2 px-2 py-1.5 border-b border-border last:border-0">
                          <Icon className="h-3 w-3 text-primary shrink-0" />
                          <span className="text-[11px] truncate">{stop.locationName}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <input type="text" value={tripTitle} onChange={(e) => setTripTitle(e.target.value)}
                className="rounded-lg border border-border bg-card p-2 text-xs"
                placeholder={navImportedStops.length > 0 ? "Auto-generated" : "Trip Name"} />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={tripStartDate} onChange={(e) => setTripStartDate(e.target.value)} className="rounded-lg border border-border bg-card p-2 text-xs" />
                <input type="date" value={tripEndDate} onChange={(e) => setTripEndDate(e.target.value)} className="rounded-lg border border-border bg-card p-2 text-xs" />
              </div>
              <input type="text" value={tripCountries} onChange={(e) => setTripCountries(e.target.value)}
                className="rounded-lg border border-border bg-card p-2 text-xs" placeholder="Countries (e.g. France, Italy)" />
              <div className="flex items-center justify-between">
                <span className="text-xs">Track in background</span>
                <Switch checked={tripTrackBg} onCheckedChange={setTripTrackBg} />
              </div>
              <button
                disabled={creating || navExtracting || (!tripTitle.trim() && navImportedStops.length === 0)}
                onClick={createNavTrip}
                className="rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50"
              >
                {creating ? "Creating..." : "Add Trip"}
              </button>
            </div>
          )}

          {/* Trips TRKD */}
          <button
            onClick={() => setShowTrips(!showTrips)}
            className="flex w-full items-center gap-3 rounded-xl bg-primary/10 p-3 font-display text-sm font-semibold mb-2 hover:bg-primary/20 transition-colors"
            style={{ color: "#1e3a5f" }}
          >
            Trips TRKD
            {years.length > 0 && (showTrips ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />)}
          </button>
          {showTrips && years.map((year) => (
            <div key={year} className="mb-2">
              <button
                onClick={() => setExpandedYears((prev) => {
                  const n = new Set(prev);
                  n.has(year) ? n.delete(year) : n.add(year);
                  return n;
                })}
                className="flex w-full items-center justify-between p-2 text-sm font-bold hover:bg-secondary rounded-lg transition-colors"
              >
                {year}{" "}
                {expandedYears.has(year) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {expandedYears.has(year) &&
                Object.keys(groupedTrips[year]).map((month) => (
                  <div key={month} className="ml-4">
                    <button
                      onClick={() => setExpandedMonths((prev) => {
                        const n = new Set(prev);
                        const k = `${year}-${month}`;
                        n.has(k) ? n.delete(k) : n.add(k);
                        return n;
                      })}
                      className="flex w-full items-center justify-between p-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {month}{" "}
                      {expandedMonths.has(`${year}-${month}`) ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {expandedMonths.has(`${year}-${month}`) &&
                      groupedTrips[year][month].map((trip: any) => (
                        <Link
                          key={trip.id}
                          to={`/trip/${trip.id}`}
                          onClick={() => setIsOpen(false)}
                          className="block p-1 pl-4 text-xs font-medium text-muted-foreground hover:text-primary transition-colors truncate"
                        >
                          {trip.title}
                        </Link>
                      ))}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
