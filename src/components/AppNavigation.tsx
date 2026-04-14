import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu, X, Plus, ChevronRight, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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
      const d = new Date(trip.start_date);
      const year = d.getFullYear().toString();
      const month = MONTHS[d.getMonth()];
      if (!grouped[year]) grouped[year] = {};
      if (!grouped[year][month]) grouped[year][month] = [];
      grouped[year][month].push(trip);
    });
    setGroupedTrips(grouped);
  };

  useEffect(() => {
    fetchTrips();
  }, [user]);

  const years = Object.keys(groupedTrips).sort((a, b) => b.localeCompare(a));

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
            <img src="/logo.png" alt="TravelTRKR" className="h-[54px] w-auto" />
          </Link>
        </div>
        <div className="p-4 overflow-y-auto h-[calc(100vh-100px)]">
          <button
            onClick={() => {
              navigate("/");
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-xl bg-primary/10 p-3 text-sm font-medium text-primary mb-4 hover:bg-primary/20 transition-colors"
          >
            <Plus className="h-4 w-4" /> Add a Trip
          </button>
          {years.map((year) => (
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
