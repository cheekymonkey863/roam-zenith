import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";

// Components
import { AppNavigation } from "@/components/AppNavigation";

// Pages
import Dashboard from "@/pages/Dashboard";
import TripDetail from "@/pages/TripDetail";
// import Auth from "@/pages/Auth"; // Uncomment this if you have an Auth page!

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        {/* Global Notification Providers */}
        <Toaster />
        <Sonner position="top-center" />

        <BrowserRouter>
          {/* Your new Global Navigation Menu */}
          <AppNavigation />

          {/* Main Page Routing */}
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/trip/:id" element={<TripDetail />} />

            {/* If you have an Auth or Login route, add it below: */}
            {/* <Route path="/auth" element={<Auth />} /> */}
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
