// Home.tsx
// Design: Swiss Grid × Japanese Functional Design
// Main layout: 3-pane (sidebar | grid | inspector)

import { useEffect } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
import { Sidebar } from "@/components/Sidebar";
import { WeekGrid } from "@/components/WeekGrid";
import { Inspector } from "@/components/Inspector";
import { StatsView, HistoryView, AuditView } from "@/components/StatsView";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export default function Home() {
  const { activeTab, isLoaded, currentFile, isDirty } = useTimetable();

  // Update page title
  useEffect(() => {
    const title = currentFile?.meta.title ?? "時間割管理";
    document.title = isDirty ? `● ${title}` : title;
  }, [currentFile, isDirty]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background/95 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-foreground">
              {currentFile?.meta.title ?? "時間割管理"}
            </h1>
            {currentFile?.meta.school && (
              <span className="text-xs text-muted-foreground">{currentFile.meta.school}</span>
            )}
            {currentFile?.meta.year && (
              <span className="text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                {currentFile.meta.year}
              </span>
            )}
            {isDirty && (
              <span className="text-xs bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 border border-amber-200">
                未保存
              </span>
            )}
          </div>
          {isLoaded && activeTab === "grid" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="h-7 gap-1.5 text-xs print:hidden"
            >
              <Printer size={12} />
              印刷
            </Button>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 flex overflow-hidden">
          {activeTab === "grid" && (
            <>
              <WeekGrid />
              <Inspector />
            </>
          )}
          {activeTab === "stats" && <StatsView />}
          {activeTab === "history" && <HistoryView />}
          {activeTab === "audit" && <AuditView />}
        </div>
      </main>
    </div>
  );
}
