import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopNav } from "@/components/TopNav";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ProfileProvider } from "@/contexts/ProfileContext";
import { GlobalFilterProvider } from "@/contexts/GlobalFilterContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "@/pages/Home";
import NotFound from "@/pages/NotFound";
import ProjectDetail from "@/pages/ProjectDetail";
import RisksManagement from "@/pages/RisksManagement";
import WeeklyCheckin from "@/pages/WeeklyCheckin";
import VisualControl from "@/pages/VisualControl";
import SpreadsheetUploadPage from "@/pages/SpreadsheetUploadPage";
import { Route, Switch } from "wouter";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/projeto" component={ProjectDetail} />
      <Route path="/projeto/:id" component={ProjectDetail} />
      <Route path="/controle-visual/:id" component={VisualControl} />
      <Route path="/controle-visual" component={VisualControl} />
      <Route path="/apontamento-semanal" component={WeeklyCheckin} />
      <Route path="/riscos-problemas" component={RisksManagement} />
      <Route path="/atualizar-planilha" component={SpreadsheetUploadPage} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <ProfileProvider>
          <GlobalFilterProvider>
            <TooltipProvider>
              <Toaster />
              <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
                <TopNav />
                <main className="flex-1 max-w-[1720px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-5">
                  <Router />
                </main>
                <footer className="border-t border-slate-200 bg-white py-4 mt-8">
                  <div className="max-w-[1720px] mx-auto px-4 text-center text-xs text-slate-500">
                    CS Compusoftware • Sistema Integrado de Gestão Gerencial de Projetos (PMBOK 8ª Edição) • 2026
                  </div>
                </footer>
              </div>
            </TooltipProvider>
          </GlobalFilterProvider>
        </ProfileProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
