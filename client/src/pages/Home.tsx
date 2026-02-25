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
import { Printer, Download, Save } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Home() {
  const {
    activeTab, isLoaded, currentFile, isDirty,
    saveFile, exportCSV, exportEffective, exportOverride,
  } = useTimetable();

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
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm font-bold text-foreground truncate">
              {currentFile?.meta.title ?? "時間割管理"}
            </h1>
            {currentFile?.meta.school && (
              <span className="text-xs text-muted-foreground hidden sm:inline truncate">
                {currentFile.meta.school}
              </span>
            )}
            {currentFile?.meta.year && (
              <span className="text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5 shrink-0">
                {currentFile.meta.year}
              </span>
            )}
            {isDirty && (
              <span className="text-xs bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 border border-amber-200 shrink-0">
                未保存
              </span>
            )}
          </div>

          {isLoaded && (
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Save button */}
              {isDirty && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={saveFile}
                  className="h-7 gap-1.5 text-xs"
                >
                  <Save size={12} />
                  <span className="hidden sm:inline">保存</span>
                </Button>
              )}

              {/* Export dropdown */}
              {activeTab === "grid" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs print:hidden"
                    >
                      <Download size={12} />
                      <span className="hidden sm:inline">エクスポート</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuLabel className="text-xs">エクスポート形式</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={exportCSV} className="text-xs gap-2">
                      <span className="font-mono text-muted-foreground">.csv</span>
                      CSV形式でダウンロード
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={exportEffective} className="text-xs gap-2">
                      <span className="font-mono text-muted-foreground">.json</span>
                      確定データ（JSON）
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={exportOverride} className="text-xs gap-2">
                      <span className="font-mono text-muted-foreground">.json</span>
                      変更履歴（JSON）
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Print button */}
              {activeTab === "grid" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrint}
                  className="h-7 gap-1.5 text-xs print:hidden"
                >
                  <Printer size={12} />
                  <span className="hidden sm:inline">印刷</span>
                </Button>
              )}
            </div>
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
