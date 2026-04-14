import { Link, useLocation } from "react-router-dom";
import { Globe, Map, BarChart3, Plus } from "lucide-react";

const navItems = [
  { label: "Dashboard", path: "/", icon: Globe },
  { label: "My Trips", path: "/trips", icon: Map },
  { label: "Statistics", path: "/stats", icon: BarChart3 },
];

export function Navbar() {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          <span className="font-display text-xl font-semibold tracking-tight text-foreground">Wanderlust</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Link
          to="/trips/new"
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Trip</span>
        </Link>
      </div>
    </header>
  );
}
