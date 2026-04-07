import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { TimetableProvider } from "./contexts/TimetableContext";
import { GradeColorProvider } from "./contexts/GradeColorContext";
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

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <GradeColorProvider>
          <TimetableProvider>
            <SidebarStyleProvider>
              <TooltipProvider>
                <Toaster richColors position="top-right" />
                <Router />
                <InstallBanner />
              </TooltipProvider>
            </SidebarStyleProvider>
          </TimetableProvider>
        </GradeColorProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
