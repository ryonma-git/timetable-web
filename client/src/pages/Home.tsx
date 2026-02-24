// Home.tsx
// Design: Swiss Grid × Japanese Functional Design
// Main layout: 3-pane (sidebar + content + inspector)

import { useEffect } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
import { Sidebar } from "@/components/Sidebar";
import { WeekGrid } from "@/components/WeekGrid";
import { Inspector } from "@/components/Inspector";
import { StatsView, HistoryView, AuditView } from "@/components/StatsView";

export default function Home() {
  const { activeTab, undo, redo, canUndo, canRedo } = useTimetable();

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.includes("Mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        if (canRedo) redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, canUndo, canRedo]);

  const showInspector = activeTab === "grid";

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      {/* Left Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-10 border-b border-border flex items-center px-4 shrink-0 bg-card">
          <div className="flex items-center gap-1">
            {[
              { id: "grid" as const, label: "週間時間割" },
              { id: "stats" as const, label: "クラス別集計" },
              { id: "history" as const, label: "変更履歴" },
              { id: "audit" as const, label: "適用ログ" },
            ].map(tab => (
              <TabButton
                key={tab.id}
                id={tab.id}
                label={tab.label}
                active={activeTab === tab.id}
              />
            ))}
          </div>
        </header>

        {/* Content area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Main panel */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {activeTab === "grid" && <WeekGrid />}
            {activeTab === "stats" && <StatsView />}
            {activeTab === "history" && <HistoryView />}
            {activeTab === "audit" && <AuditView />}
          </div>

          {/* Right Inspector (grid tab only) */}
          {showInspector && <Inspector />}
        </div>
      </main>
    </div>
  );
}

function TabButton({
  id, label, active,
}: {
  id: string; label: string; active: boolean;
}) {
  const { setActiveTab } = useTimetable();
  return (
    <button
      onClick={() => setActiveTab(id as any)}
      className={`px-3 py-1 text-xs rounded transition-colors ${
        active
          ? "bg-primary text-primary-foreground font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}
