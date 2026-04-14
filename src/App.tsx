import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";

// Components
import { AppNavigation } from "@/components/AppNavigation";

// Pages
import Dashboard from "@/pages/Dashboard";
import TripDetail from "@/pages/TripDetail";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          {/* Notifications */}
          <Toaster />
          <Sonner position="top-center" />

          <BrowserRouter>
            {/* The Global Side Navigation */}
            <AppNavigation />

            <main className="min-h-screen bg-background">
              <Routes>
                {/* Default route: Dashboard */}
                <Route path="/" element={<Dashboard />} />

                {/* Trip Details */}
                <Route path="/trip/:id" element={<TripDetail />} />

                {/* Fallback: redirect any unknown routes to dashboard */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
