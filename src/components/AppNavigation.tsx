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

function getTripMonths(startDateStr: string, endDateStr: string) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const months = [];

  let current = new Date(start.getFullYear(), start.getMonth(), 1);
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
      .channel("public:trips-nav")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trips", filter: `user_id=eq.${user.id}` },
        fetchTrips,
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
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-6 left-6 z-40 flex h-11 w-11 items-center justify-center rounded-xl bg-card border border-border shadow-md hover:bg-secondary transition-colors"
      >
        <Menu className="h-5 w-5 text-foreground" />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div
        className={`fixed top-0 left-0 bottom-0 z-50 w-80 bg-card border-r border-border shadow-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        } flex flex-col overflow-hidden`}
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <Link to="/" onClick={() => setIsOpen(false)} className="flex items-center">
            <img src="/logo.png" alt="TravelTRKR" className="h-10 w-auto object-contain" />
          </Link>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          <button
            onClick={handleAddTrip}
            className="flex items-center gap-3 w-full rounded-xl px-4 py-3 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors mb-2"
          >
            <Plus className="h-4 w-4" />
            Add a Trip
          </button>

          <div className="flex flex-col">
            <button
              onClick={() => setExpandedTrkd(!expandedTrkd)}
              className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-sm font-semibold text-foreground hover:bg-secondary transition-colors"
            >
              <div className="flex items-center gap-2">
                <Plane className="h-4 w-4 text-muted-foreground" />
                TRKD Trips
              </div>
              {expandedTrkd ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {expandedTrkd && (
              <div className="flex flex-col mt-1 pl-4 border-l border-border/50 ml-5">
                {years.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-2 italic">No trips found.</p>
                ) : (
                  years.map((year) => {
                    const isYearExpanded = expandedYears.has(year);
                    const months = Object.keys(groupedTrips[year]).sort(
                      (a, b) => MONTHS.indexOf(a) - MONTHS.indexOf(b),
                    );

                    return (
                      <div key={year} className="flex flex-col">
                        <button
                          onClick={() => toggleYear(year)}
                          className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-sm font-medium text-foreground/90 hover:bg-secondary transition-colors"
                        >
                          {year}
                          {isYearExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </button>

                        {isYearExpanded && (
                          <div className="flex flex-col mt-0.5 pl-4 border-l border-border/50 ml-3">
                            {months.map((month) => {
                              const yearMonthKey = `${year}-${month}`;
                              const isMonthExpanded = expandedMonths.has(yearMonthKey);
                              const tripsInMonth = groupedTrips[year][month];

                              return (
                                <div key={month} className="flex flex-col">
                                  <button
                                    onClick={() => toggleMonth(yearMonthKey)}
                                    className="flex items-center justify-between w-full rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                                  >
                                    {month}
                                    {isMonthExpanded ? (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    )}
                                  </button>

                                  {isMonthExpanded && (
                                    <div className="flex flex-col mt-0.5 pl-4 border-l border-border/50 ml-3 pb-1 gap-0.5">
                                      {tripsInMonth.map((trip) => (
                                        <Link
                                          key={trip.id}
                                          to={`/trip/${trip.id}`}
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
