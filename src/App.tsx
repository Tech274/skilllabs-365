import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import VirtualMachines from "./pages/VirtualMachines.tsx";
import Sessions from "./pages/Sessions.tsx";
import Regions from "./pages/Regions.tsx";
import CostAnalytics from "./pages/CostAnalytics.tsx";
import Health from "./pages/Health.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/vms" element={<VirtualMachines />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/regions" element={<Regions />} />
          <Route path="/costs" element={<CostAnalytics />} />
          <Route path="/health" element={<Health />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
