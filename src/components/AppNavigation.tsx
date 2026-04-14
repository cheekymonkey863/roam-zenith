import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu, X, Plus, ChevronRight, ChevronDown, Plane } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type Trip = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
};

type GroupedTrips = Record<string, Record<string, Trip[]>>;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function getTripMonths(startDateStr: string, endDateStr: string) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const months: { year: string; month: string }[] = [];

  const current = new Date(start.getFullYear(), start.getMonth(), 1);
  const endLimit = new Date(end.getFullYear(), end.getMonth(), 1);

  while (current <= endLimit) {
    months.push({
      year: current.getFullYear().toString(),
      month: MONTHS[current.getMonth()],
    });
    current.setMonth(current.getMonth() + 1);
  }
  return months;
}

export function AppNavigation() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [groupedTrips, setGroupedTrips] = useState<GroupedTrips>({});

  const [expandedTrkd, setExpandedTrkd] = useState(true);
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;

    const fetchTrips = async () => {
      const { data, error } = await supabase
        .from("trips")
        .select("id, title, start_date, end_date")
        .eq("user_id", user.id)
        .order("start_date", { ascending: false });

      if (error || !data) return;
      setTrips(data);

      const grouped: GroupedTrips = {};

      data.forEach((trip) => {
        if (!trip.start_date || !trip.end_date) return;

        const spannedMonths = getTripMonths(trip.start_date, trip.end_date);

        spannedMonths.forEach(({ year, month }) => {
          if (!grouped[year]) grouped[year] = {};
          if (!grouped[year][month]) grouped[year][month] = [];

          if (!grouped[year][month].find((t) => t.id === trip.id)) {
            grouped[year][month].push(trip);
          }
        });
      });

      setGroupedTrips(grouped);

      const years = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
      if (years.length > 0) {
        setExpandedYears(new Set([years[0]]));
      }
    };

    fetchTrips();

    const channel = supabase
      .channel("public:trips")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trips", filter: `user_id=eq.${user.id}` },
        fetchTrips
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const toggleYear = (year: string) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  const toggleMonth = (yearMonthKey: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(yearMonthKey)) next.delete(yearMonthKey);
      else next.add(yearMonthKey);
      return next;
    });
  };

  const handleAddTrip = () => {
    setIsOpen(false);
    navigate("/");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const years = Object.keys(groupedTrips).sort((a, b) => b.localeCompare(a));

  return (
    <>
      {/* Upper Left Fixed Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-6 left-6 z-40 flex h-11 w-11 items-center justify-center rounded-xl bg-card border border-border shadow-md hover:bg-secondary transition-colors"
        aria-label="Open Navigation"
      >
        <Menu className="h-5 w-5 text-foreground" />
      </button>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sliding Sidebar */}
      <div
        className={`fixed top-0 left-0 z-50 flex h-full w-72 flex-col bg-card border-r border-border shadow-xl transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <Link to="/" onClick={() => setIsOpen(false)} className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Plane className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display text-lg font-semibold text-foreground">TravelTRKD</span>
          </Link>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Menu Content */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {/* Add a Trip */}
          <button
            onClick={handleAddTrip}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add a Trip
          </button>

          {/* TRKD Trips Root Accordion */}
          <div className="mt-2">
            <button
              onClick={() => setExpandedTrkd(!expandedTrkd)}
              className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-sm font-semibold text-foreground hover:bg-secondary transition-colors"
            >
              <span className="flex items-center gap-2">
                <Plane className="h-4 w-4" />
                TRKD Trips
              </span>
              {expandedTrkd ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            {/* Nested Years */}
            {expandedTrkd && (
              <div className="ml-2 mt-1 space-y-0.5">
                {years.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No trips found.</p>
                ) : (
                  years.map((year) => {
                    const isYearExpanded = expandedYears.has(year);
                    const months = Object.keys(groupedTrips[year]).sort(
                      (a, b) => MONTHS.indexOf(a) - MONTHS.indexOf(b)
                    );

                    return (
                      <div key={year}>
                        <button
                          onClick={() => toggleYear(year)}
                          className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-sm font-medium text-foreground/90 hover:bg-secondary transition-colors"
                        >
                          {year}
                          {isYearExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>

                        {/* Nested Months */}
                        {isYearExpanded && (
                          <div className="ml-3 mt-0.5 space-y-0.5">
                            {months.map((month) => {
                              const yearMonthKey = `${year}-${month}`;
                              const isMonthExpanded = expandedMonths.has(yearMonthKey);
                              const tripsInMonth = groupedTrips[year][month];

                              return (
                                <div key={yearMonthKey}>
                                  <button
                                    onClick={() => toggleMonth(yearMonthKey)}
                                    className="flex items-center justify-between w-full rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                                  >
                                    {month}
                                    {isMonthExpanded ? (
                                      <ChevronDown className="h-3 w-3" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3" />
                                    )}
                                  </button>

                                  {/* Nested Trip Links */}
                                  {isMonthExpanded && (
                                    <div className="ml-3 mt-0.5 space-y-0.5">
                                      {tripsInMonth.map((trip) => (
                                        <Link
                                          key={trip.id}
                                          to={`/trips/${trip.id}`}
                                          onClick={() => setIsOpen(false)}
                                          className="block truncate rounded-lg px-3 py-1.5 text-xs font-medium text-foreground/80 hover:bg-primary/10 hover:text-primary transition-colors"
                                          title={trip.title}
                                        >
                                          {trip.title}
                                        </Link>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
