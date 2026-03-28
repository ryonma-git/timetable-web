// Design: Swiss Grid × Japanese Functional Design
// Main layout: 3-pane (sidebar | grid | inspector) with mobile hamburger menu

import { useEffect, useState, useCallback } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
import { Sidebar } from "@/components/Sidebar";
import { WeekGrid } from "@/components/WeekGrid";
import { Inspector } from "@/components/Inspector";
import { StatsView, HistoryView, AuditView } from "@/components/StatsView";
import { Button } from "@/components/ui/button";
import { Printer, Download, Save, Menu, FileImage, FileText, FileSpreadsheet, FileInput } from "lucide-react";
import { SemesterTabs } from "@/components/SemesterTabs";
import { PrintPreviewDialog } from "@/components/PrintPreviewDialog";
import { AutoRestoreDialog } from "@/components/AutoRestoreDialog";
import { ExportDialog } from "@/components/ExportDialog";
import { PatchImportDialog } from "@/components/PatchImportDialog";
import { PeriodTimesDialog } from "@/components/PeriodTimesDialog";
import { HolidaySettingsDialog } from "@/components/HolidaySettingsDialog";
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
    activeTab, isLoaded, currentFile, isDirty, lastFileSavedAt,
    saveFile, exportCSV, exportEffective, exportOverride,
  } = useTimetable();

  // 未保存時間計測（最後のファイル保存からの経過時間）
  const [unsavedMinutes, setUnsavedMinutes] = useState(0);
  const [showSaveReminder, setShowSaveReminder] = useState(false);
  const [reminderDismissed, setReminderDismissed] = useState(false);

  // 経過時間を毎分更新
  useEffect(() => {
    if (!isLoaded) return;
    const tick = () => {
      if (!isDirty) {
        setShowSaveReminder(false);
        setReminderDismissed(false);
        setUnsavedMinutes(0);
        return;
      }
      // 最後のファイル保存からの経過分数
      const ref = lastFileSavedAt ?? new Date(0);
      const mins = Math.floor((Date.now() - ref.getTime()) / 60000);
      setUnsavedMinutes(mins);
      // 30分以上未保存ならリマインダー表示
      if (mins >= 30 && !reminderDismissed) {
        setShowSaveReminder(true);
      }
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [isLoaded, isDirty, lastFileSavedAt, reminderDismissed]);

  // ページ離脱時の警告（beforeunload）
  const handleBeforeUnload = useCallback((e: BeforeUnloadEvent) => {
    if (!isDirty) return;
    e.preventDefault();
    e.returnValue = "未保存の変更があります。ページを閉じると変更内容は失われます。";
  }, [isDirty]);

  useEffect(() => {
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [handleBeforeUnload]);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showPatchImport, setShowPatchImport] = useState(false);
  const [showPeriodTimes, setShowPeriodTimes] = useState(false);
  const [showHolidaySettings, setShowHolidaySettings] = useState(false);

  // Update page title
  useEffect(() => {
    const title = currentFile?.meta.title ?? "時間割管理";
    document.title = isDirty ? `● ${title}` : title;
  }, [currentFile, isDirty]);

  // 保存後にリマインダーを非表示
  useEffect(() => {
    if (!isDirty) {
      setShowSaveReminder(false);
      setReminderDismissed(false);
    }
  }, [isDirty]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AutoRestoreDialog />

      {/* ファイル未保存リマインダー（30分以上未保存時） */}
      {showSaveReminder && isLoaded && (
        <div className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between gap-2 px-4 py-2.5 bg-amber-500 text-white text-sm shadow-lg">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span className="font-medium">
              {unsavedMinutes >= 60
                ? `${Math.floor(unsavedMinutes / 60)}時間${unsavedMinutes % 60 > 0 ? `${unsavedMinutes % 60}分` : ""}`
                : `${unsavedMinutes}分`
              }以上ファイル保存されていません。ブラウザを閉じるとデータが失われる可能性があります。
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => { saveFile(); }}
              className="px-3 py-1 bg-white text-amber-700 rounded text-xs font-bold hover:bg-amber-50 transition-colors"
            >
              今すぐ保存
            </button>
            <button
              onClick={() => { setShowSaveReminder(false); setReminderDismissed(true); }}
              className="px-2 py-1 text-white/80 hover:text-white text-xs transition-colors"
            >
              後で
            </button>
          </div>
        </div>
      )}
      <PrintPreviewDialog open={showPrintPreview} onClose={() => setShowPrintPreview(false)} />
      <ExportDialog open={showExportDialog} onClose={() => setShowExportDialog(false)} />
      <PatchImportDialog open={showPatchImport} onClose={() => setShowPatchImport(false)} />
      <PeriodTimesDialog open={showPeriodTimes} onOpenChange={setShowPeriodTimes} />
      <HolidaySettingsDialog open={showHolidaySettings} onOpenChange={setShowHolidaySettings} />
      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar: desktop always visible, mobile slide-in */}
      <div className={`
        fixed inset-y-0 left-0 z-50 lg:static lg:z-auto
        transition-transform duration-300 ease-in-out
        ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        <Sidebar onClose={() => setMobileSidebarOpen(false)} />
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-background/95 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {/* Hamburger button (mobile only) */}
            <button
              className="lg:hidden p-1.5 rounded hover:bg-muted transition-colors shrink-0"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu size={18} />
            </button>

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
              <span
                className={`text-xs rounded px-1.5 py-0.5 border shrink-0 ${
                  unsavedMinutes >= 30
                    ? "bg-red-100 text-red-700 border-red-300 font-bold"
                    : unsavedMinutes >= 10
                    ? "bg-orange-100 text-orange-700 border-orange-200"
                    : "bg-amber-100 text-amber-700 border-amber-200"
                }`}
              >
                {unsavedMinutes >= 1 ? `未保存 ${unsavedMinutes >= 60 ? `${Math.floor(unsavedMinutes/60)}h` : `${unsavedMinutes}m`}` : "未保存"}
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
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel className="text-xs">データエクスポート</DropdownMenuLabel>
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
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setShowExportDialog(true)} className="text-xs gap-2">
                      <FileSpreadsheet size={12} className="text-green-600" />
                      Excelエクスポート…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Print button */}
              {activeTab === "grid" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPatchImport(true)}
                    className="h-7 gap-1.5 text-xs print:hidden"
                    title="パッチインポート"
                  >
                    <FileInput size={12} />
                    <span className="hidden sm:inline">インポート</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowExportDialog(true)}
                    className="h-7 gap-1.5 text-xs print:hidden"
                    title="Excelエクスポート"
                  >
                    <FileSpreadsheet size={12} />
                    <span className="hidden sm:inline">書き出し</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPrintPreview(true)}
                    className="h-7 gap-1.5 text-xs print:hidden"
                  >
                    <Printer size={12} />
                    <span className="hidden sm:inline">印刷</span>
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Semester tabs */}
        {isLoaded && <SemesterTabs />}

        {/* Content area */}
        <div className="flex-1 flex overflow-hidden relative">
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
