import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu, X, Plus, ChevronRight, ChevronDown, Image, FileText, Mail } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { parseTripCountriesInput } from "@/lib/tripManagement";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
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
      // Walk each month from start to end
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
      while (cursor <= endMonth) {
        const year = cursor.getFullYear().toString();
        const month = MONTHS[cursor.getMonth()];
        if (!grouped[year]) grouped[year] = {};
        if (!grouped[year][month]) grouped[year][month] = [];
        // Avoid duplicates
        if (!grouped[year][month].some((t: any) => t.id === trip.id)) {
          grouped[year][month].push(trip);
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
    });
    setGroupedTrips(grouped);
  };

  useEffect(() => {
    fetchTrips();
  }, [user]);

  const years = Object.keys(groupedTrips).sort((a, b) => b.localeCompare(a));

  const generateNavTripTitle = (): string => {
    const countries = parseTripCountriesInput(tripCountries);
    const countryPart = countries.length > 0 ? countries.join(", ") : "New Trip";
    if (tripStartDate) {
      const startFormatted = format(new Date(tripStartDate + "T00:00:00"), "MMM-yy");
      const endFormatted = tripEndDate ? format(new Date(tripEndDate + "T00:00:00"), "MMM-yy") : startFormatted;
      return startFormatted === endFormatted
        ? `${countryPart} | ${startFormatted}`
        : `${countryPart} | ${startFormatted} - ${endFormatted}`;
    }
    return countryPart;
  };

  const createAndImport = async (importType: "photos" | "document" | "inbox" | null) => {
    if (!user) return;
    const forImport = importType !== null;
    const finalTitle = tripTitle.trim() || (forImport ? generateNavTripTitle() : "");
    if (!finalTitle) {
      toast.error("Please enter a trip name");
      return;
    }
    setCreating(true);
    try {
      const countries = parseTripCountriesInput(tripCountries);
      const { data, error } = await supabase
        .from("trips")
        .insert({
          user_id: user.id,
          title: finalTitle,
          start_date: tripStartDate || null,
          end_date: tripEndDate || null,
          is_active: tripTrackBg,
          countries,
        } as any)
        .select()
        .single();
      if (error) throw error;
      toast.success("Trip created!");
      setShowAddTrip(false);
      setTripTitle("");
      setTripStartDate("");
      setTripEndDate("");
      setTripCountries("");
      setTripTrackBg(false);
      setIsOpen(false);
      fetchTrips();
      navigate(importType ? `/trip/${data.id}?import=${importType}` : `/trip/${data.id}`);
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
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={creating || !tripTitle.trim()}
                  onClick={() => createAndImport("photos")}
                  className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-xs hover:bg-secondary/40 transition-colors disabled:opacity-50"
                >
                  <Image className="h-4 w-4 text-primary" />
                  Photos
                </button>
                <button
                  type="button"
                  disabled={creating || !tripTitle.trim()}
                  onClick={() => createAndImport("document")}
                  className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-xs hover:bg-secondary/40 transition-colors disabled:opacity-50"
                >
                  <FileText className="h-4 w-4 text-primary" />
                  Document
                </button>
                <button
                  type="button"
                  disabled={creating || !tripTitle.trim()}
                  onClick={() => createAndImport("inbox")}
                  className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-xs hover:bg-secondary/40 transition-colors disabled:opacity-50"
                >
                  <Mail className="h-4 w-4 text-primary" />
                  Inbox
                </button>
              </div>
              <input
                type="text"
                value={tripTitle}
                onChange={(e) => setTripTitle(e.target.value)}
                className="rounded-lg border border-border bg-card p-2 text-xs"
                placeholder="Trip Name *"
              />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={tripStartDate} onChange={(e) => setTripStartDate(e.target.value)} className="rounded-lg border border-border bg-card p-2 text-xs" />
                <input type="date" value={tripEndDate} onChange={(e) => setTripEndDate(e.target.value)} className="rounded-lg border border-border bg-card p-2 text-xs" />
              </div>
              <input
                type="text"
                value={tripCountries}
                onChange={(e) => setTripCountries(e.target.value)}
                className="rounded-lg border border-border bg-card p-2 text-xs"
                placeholder="Countries (e.g. France, Italy)"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs">Track in background</span>
                <Switch checked={tripTrackBg} onCheckedChange={setTripTrackBg} />
              </div>
              <button
                disabled={creating || !tripTitle.trim()}
                onClick={() => createAndImport(null)}
                className="rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50"
              >
                {creating ? "Creating..." : "Add Trip"}
              </button>
            </div>
          )}
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
                onClick={() =>
                  setExpandedYears((prev) => {
                    const n = new Set(prev);
                    n.has(year) ? n.delete(year) : n.add(year);
                    return n;
                  })
                }
                className="flex w-full items-center justify-between p-2 text-sm font-bold hover:bg-secondary rounded-lg transition-colors"
              >
                {year}{" "}
                {expandedYears.has(year) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {expandedYears.has(year) &&
                Object.keys(groupedTrips[year]).map((month) => (
                  <div key={month} className="ml-4">
                    <button
                      onClick={() =>
                        setExpandedMonths((prev) => {
                          const n = new Set(prev);
                          const k = `${year}-${month}`;
                          n.has(k) ? n.delete(k) : n.add(k);
                          return n;
                        })
                      }
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
