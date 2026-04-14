import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { AppNavigation } from "@/components/AppNavigation";
import Dashboard from "@/pages/Dashboard";
import TripDetail from "@/pages/TripDetail";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner position="top-center" />
        <BrowserRouter>
          <AppNavigation />
          <main className="min-h-screen bg-background">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/trip/:id" element={<TripDetail />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
