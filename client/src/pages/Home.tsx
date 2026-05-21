// Design: Swiss Grid × Japanese Functional Design
// Main layout: 3-pane (sidebar | grid | inspector) with mobile hamburger menu

import { useEffect, useState, useCallback } from "react";
import { useTimetable } from "@/contexts/TimetableContext";
import { useGoogleDrive } from "@/contexts/GoogleDriveContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Sidebar } from "@/components/Sidebar";
import { WeekGrid } from "@/components/WeekGrid";
import { Inspector } from "@/components/Inspector";
import { StatsView, HistoryView, AuditView } from "@/components/StatsView";
import { TeachingPlanView } from "@/components/TeachingPlanView";
import { Button } from "@/components/ui/button";
import { Printer, Save, Menu, FileSpreadsheet, FileInput, MoreHorizontal, CalendarDays, Database } from "lucide-react";
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
import {
  Drawer,
  DrawerContent,
} from "@/components/ui/drawer";
import { useSidebarStyle } from "@/hooks/useSidebarStyle";

export default function Home() {
  const {
    activeTab, isLoaded, currentFile, isDirty, lastFileSavedAt,
    saveFile, exportCSV, exportEffective, exportOverride,
  } = useTimetable();

  const { syncStatus, lastSyncedAt } = useGoogleDrive();
  const { t, language } = useLanguage();

  // 未保存時間計測（最後のファイル保存 or Drive同期からの経過時間）
  const [unsavedMinutes, setUnsavedMinutes] = useState(0);
  const [reminderDismissed, setReminderDismissed] = useState(false);

  // Drive同期後も「保存済み」と判断するための最終保存日時
  // ファイル保存 or Drive同期のいずれか新しい方を使う
  const lastSavedAt = (() => {
    if (!lastFileSavedAt && !lastSyncedAt) return null;
    if (!lastFileSavedAt) return lastSyncedAt;
    if (!lastSyncedAt) return lastFileSavedAt;
    return lastFileSavedAt > lastSyncedAt ? lastFileSavedAt : lastSyncedAt;
  })();

  // isDirty だが Drive同期完了直後は「保存済み」扱い
  const isEffectivelyDirty = isDirty && syncStatus !== "synced";

  // 経過時間を毎分更新
  useEffect(() => {
    if (!isLoaded) return;
    const tick = () => {
      if (!isEffectivelyDirty) {
        setReminderDismissed(false);
        setUnsavedMinutes(0);
        return;
      }
      if (!lastSavedAt) {
        setUnsavedMinutes(-1);
        return;
      }
      const mins = Math.floor((Date.now() - lastSavedAt.getTime()) / 60000);
      setUnsavedMinutes(mins);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [isLoaded, isEffectivelyDirty, lastSavedAt]);

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
  const { sidebarStyle } = useSidebarStyle();
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showExportGCal, setShowExportGCal] = useState(false);
  const [showPatchImport, setShowPatchImport] = useState(false);
  const [showPeriodTimes, setShowPeriodTimes] = useState(false);
  const [showHolidaySettings, setShowHolidaySettings] = useState(false);

  // Update page title
  useEffect(() => {
    const title = currentFile?.meta.title ?? t("home.titleFallback");
    document.title = isEffectivelyDirty ? `● ${title}` : title;
  }, [currentFile, isEffectivelyDirty, t]);

  // 保存後にリマインダーを非表示
  useEffect(() => {
    if (!isEffectivelyDirty) {
      setReminderDismissed(false);
    }
  }, [isEffectivelyDirty]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AutoRestoreDialog />

      <PrintPreviewDialog open={showPrintPreview} onClose={() => setShowPrintPreview(false)} />
      {/* エクスポートダイアログ：通常 or GCalタブ直接開き */}
      <ExportDialog
        open={showExportDialog || showExportGCal}
        onClose={() => { setShowExportDialog(false); setShowExportGCal(false); }}
        initialTab={showExportGCal ? "ics" : undefined}
        exportCSV={exportCSV}
        exportEffective={exportEffective}
        exportOverride={exportOverride}
      />
      <PatchImportDialog open={showPatchImport} onClose={() => setShowPatchImport(false)} />
      <PeriodTimesDialog open={showPeriodTimes} onOpenChange={setShowPeriodTimes} />
      <HolidaySettingsDialog open={showHolidaySettings} onOpenChange={setShowHolidaySettings} />
      {/* Desktop sidebar: always visible */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar: bottom sheet (Drawer) or slide-left overlay */}
      {sidebarStyle === "bottom_sheet" ? (
        <Drawer
          open={mobileSidebarOpen}
          onOpenChange={setMobileSidebarOpen}
          direction="bottom"
        >
          <DrawerContent className="lg:hidden max-h-[85vh] bg-sidebar text-sidebar-foreground border-sidebar-border flex flex-col">
            <div className="overflow-y-auto overscroll-contain flex-1">
              <Sidebar onClose={() => setMobileSidebarOpen(false)} isBottomSheet />
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <>
          {mobileSidebarOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
              onClick={() => setMobileSidebarOpen(false)}
            />
          )}
          <div className={`
            fixed inset-y-0 left-0 z-50 lg:hidden
            transition-transform duration-300 ease-in-out
            ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}
          `}>
            <Sidebar onClose={() => setMobileSidebarOpen(false)} />
          </div>
        </>
      )}

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
              {currentFile?.meta.title ?? t("home.titleFallback")}
            </h1>
            {currentFile?.meta.school && (
              <span className="text-xs text-muted-foreground hidden sm:inline truncate">
                {currentFile.meta.school}
              </span>
            )}
            {currentFile?.meta.year && (
              <span className="text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5 shrink-0">
                {(() => {
                  const raw = currentFile.meta.year;
                  if (language === "ja") return raw;
                  const m = raw.match(/(\d{4})/);
                  return m ? `AY ${m[1]}` : raw;
                })()}
              </span>
            )}
            {/* 未保存バッジ：Drive同期完了後は非表示 */}
            {isEffectivelyDirty && (
              <button
                onClick={saveFile}
                title={t("home.saveLocalTitle")}
                className={`flex items-center gap-1 text-xs rounded px-1.5 py-0.5 border shrink-0 transition-colors hover:opacity-80 ${
                  unsavedMinutes >= 30
                    ? "bg-red-50 text-red-600 border-red-200 font-medium"
                    : unsavedMinutes >= 10
                    ? "bg-orange-50 text-orange-600 border-orange-200"
                    : "bg-amber-50 text-amber-600 border-amber-200"
                }`}
              >
                <Save size={10} className="shrink-0" />
                <span>{unsavedMinutes === -1 ? t("common.unsaved") : unsavedMinutes >= 60 ? `${Math.floor(unsavedMinutes / 60)}h ${t("common.unsaved")}` : unsavedMinutes >= 1 ? `${unsavedMinutes}m ${t("common.unsaved")}` : t("common.unsaved")}</span>
              </button>
            )}
          </div>
          {isLoaded && (
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Save button: モバイルのみ表示 */}
              {isEffectivelyDirty && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={saveFile}
                  className="h-7 gap-1.5 text-xs sm:hidden"
                >
                  <Save size={12} />
                  {t("common.save")}
                </Button>
              )}
              {/* Desktop: individual buttons / Mobile: collapsed into "..." menu */}
              {activeTab === "grid" && (
                <>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPatchImport(true)}
                    className="h-7 gap-1.5 text-xs print:hidden hidden sm:flex"
                    title={t("home.importTitle")}
                  >
                    <FileInput size={12} />
                    <span>{t("home.import")}</span>
                  </Button>
                  {/* エクスポート（メインボタン） */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowExportDialog(true)}
                    className="h-7 gap-1.5 text-xs print:hidden hidden sm:flex"
                    title={t("home.exportTitle")}
                  >
                    <FileSpreadsheet size={12} />
                    <span>{t("home.export")}</span>
                  </Button>
                  {/* Googleカレンダー連携ボタン */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowExportGCal(true)}
                    className="h-7 gap-1.5 text-xs print:hidden hidden sm:flex text-blue-600 border-blue-300 hover:bg-blue-50"
                    title={t("home.googleLinkTitle")}
                  >
                    <CalendarDays size={12} />
                    <span>{t("home.googleLink")}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPrintPreview(true)}
                    className="h-7 gap-1.5 text-xs print:hidden hidden sm:flex"
                  >
                    <Printer size={12} />
                    <span>{t("home.print")}</span>
                  </Button>
                  {/* モバイルのみ表示する「…」メニュー */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0 print:hidden sm:hidden"
                        title={t("home.moreActions")}
                      >
                        <MoreHorizontal size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuLabel className="text-xs">{t("home.exportMenu")}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShowExportDialog(true)} className="text-xs gap-2">
                        <FileSpreadsheet size={12} className="text-green-600" />
                        {t("home.exportMenuItem")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowExportGCal(true)} className="text-xs gap-2">
                        <CalendarDays size={12} className="text-blue-500" />
                        {t("home.googleCalendarMenuItem")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={exportCSV} className="text-xs gap-2">
                        <Database size={12} />
                        {t("home.rawCsv")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShowPatchImport(true)} className="text-xs gap-2">
                        <FileInput size={12} />
                        {t("home.patchImport")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShowPrintPreview(true)} className="text-xs gap-2">
                        <Printer size={12} />
                        {t("home.printPreview")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
          {activeTab === "teachingPlan" && <TeachingPlanView />}
        </div>
      </main>
    </div>
  );
}
