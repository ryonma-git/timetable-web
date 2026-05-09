import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Router as WouterRouter } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { TimetableProvider } from "./contexts/TimetableContext";
import { GradeColorProvider } from "./contexts/GradeColorContext";
import { GoogleDriveProvider } from "./contexts/GoogleDriveContext";
import Home from "./pages/Home";
import { InstallBanner } from "./components/InstallBanner";
import React from "react";
import { SidebarStyleContext, useSidebarStyleState } from "./hooks/useSidebarStyle";

/** SidebarStyleProviderはコンテキスト共有のためのラッパー */
function SidebarStyleProvider({ children }: { children: React.ReactNode }) {
  const value = useSidebarStyleState();
  return (
    <SidebarStyleContext.Provider value={value}>
      {children}
    </SidebarStyleContext.Provider>
  );
}

// GitHub Pagesデプロイ時は VITE_BASE_URL=/timetable-web/ になるため、Wouterの base も合わせる
const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || '';

function Router() {
  return (
    <WouterRouter base={BASE}>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </WouterRouter>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <GradeColorProvider>
          <TimetableProvider>
            <GoogleDriveProvider>
            <SidebarStyleProvider>
              <TooltipProvider>
                <Toaster richColors position="top-right" />
                <Router />
                <InstallBanner />
              </TooltipProvider>
            </SidebarStyleProvider>
            </GoogleDriveProvider>
          </TimetableProvider>
        </GradeColorProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
