// Sidebar.tsx
// Design: Swiss Grid × Japanese Functional Design
// Left sidebar: new/open/save, navigation, undo/redo, export, color settings
// Phase 4: 教科管理ダイアログ・モードバッジを追加
// Phase 5: Google Drive連携 UI を追加

import { useRef, useState, useEffect } from "react";
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cloud,
  CloudOff,
  CloudUpload,
  Download,
  FileJson,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FileImage,
  FolderOpen,
  History,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Settings,
  TableProperties,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useTimetable, type ActiveTab } from "@/contexts/TimetableContext";
import { useGoogleDrive } from "@/contexts/GoogleDriveContext";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ColorSettingsDialog } from "@/components/ColorSettingsDialog";
import { NewFileWizard } from "@/components/NewFileWizard";
import { SettingsDialog } from "@/components/SettingsDialog";
import { HolidaySettingsDialog } from "@/components/HolidaySettingsDialog";
import { ExportDialog } from "@/components/ExportDialog";
import { SubjectSettingsDialog } from "@/components/SubjectSettingsDialog";
import { SamplePickerDialog } from "@/components/SamplePickerDialog";
import { DriveBackupDialog } from "@/components/DriveBackupDialog";
import { TIMETABLE_FILE_EXT } from "@/lib/timetableFile";
import { useSidebarStyle, type SidebarStyle } from "@/hooks/useSidebarStyle";
import { Smartphone } from "lucide-react";

export function Sidebar({ onClose, isBottomSheet }: { onClose?: () => void; isBottomSheet?: boolean } = {}) {
  const {
    isLoaded, isDirty, loadedFileName, currentFile,
    loadFromNativeFile, loadFromZip,
    saveFile,
    loadTimetableFile,
    activeTab, setActiveTab,
    currentWeekMonday, navigateWeek, goToToday, goToDate,
    canUndo, canRedo, undo, redo,
    undoStack,
    exportEffective, exportOverride, exportCSV,
    pendingOps,
    semester,
    mode,
    allOps,
  } = useTimetable();

  const {
    isLoggedIn,
    isRestoringLogin,
    syncStatus,
    lastSyncedAt,
    syncError,
    backupStatus,
    lastBackupAt,
    backupError,
    login,
    logout,
    syncToDrive,
    backupToMyDrive,
    loadFromDrive,
  } = useGoogleDrive();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [driveLoading, setDriveLoading] = useState(false);
  const { sidebarStyle, setSidebarStyle } = useSidebarStyle();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHolidaySettings, setShowHolidaySettings] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerValue, setDatePickerValue] = useState("");
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showSubjectSettings, setShowSubjectSettings] = useState(false);
  const [showSamplePicker, setShowSamplePicker] = useState(false);
  const [showDriveBackup, setShowDriveBackup] = useState(false);

  // Keyboard shortcut: Ctrl/Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (isLoaded) saveFile();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (canUndo) undo();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) {
        e.preventDefault();
        if (canRedo) redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isLoaded, saveFile, canUndo, undo, canRedo, redo]);

  // 自動同期: isDirty が false になった（ローカル保存完了）タイミングで Drive に自動アップロード
  const prevIsDirtyRef = useRef(isDirty);
  useEffect(() => {
    const wasJustSaved = prevIsDirtyRef.current === true && isDirty === false;
    prevIsDirtyRef.current = isDirty;
    if (wasJustSaved && isLoggedIn && isLoaded && currentFile) {
      syncToDrive(currentFile, allOps).catch(() => {
        // エラーはsyncStatusに反映されるのでここでは何もしない
      });
    }
  }, [isDirty, isLoggedIn, isLoaded, currentFile, allOps, syncToDrive]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      if (file.name.endsWith(TIMETABLE_FILE_EXT)) {
        const result = await loadFromNativeFile(file);
        toast.success(`読み込み完了: ${file.name}`);
        result.warnings.forEach((w: string) => toast.warning(w));
      } else if (file.name.endsWith(".zip")) {
        const result = await loadFromZip(file);
        toast.success(`ZIPから読み込み完了: ${result.loadedFiles.length}ファイル`);
        result.warnings.forEach((w: string) => toast.warning(w));
      } else {
        toast.error("対応ファイル: .timetable または .zip");
      }
    } catch (err) {
      toast.error(`読み込みエラー: ${String(err)}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleLoadSample = () => {
    setShowSamplePicker(true);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setLoading(true);
    try {
      if (file.name.endsWith(TIMETABLE_FILE_EXT)) {
        const result = await loadFromNativeFile(file);
        toast.success(`読み込み完了: ${file.name}`);
        result.warnings.forEach((w: string) => toast.warning(w));
      } else if (file.name.endsWith(".zip")) {
        const result = await loadFromZip(file);
        toast.success(`ZIPから読み込み完了: ${result.loadedFiles.length}ファイル`);
        result.warnings.forEach((w: string) => toast.warning(w));
      } else {
        toast.error("対応ファイル: .timetable または .zip");
      }
    } catch (err) {
      toast.error(`読み込みエラー: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    saveFile();
    toast.success("保存しました");
  };

  const handleDriveSave = async () => {
    if (!currentFile) return;
    setDriveLoading(true);
    try {
      await syncToDrive(currentFile, allOps);
      toast.success("Google Driveに保存しました");
    } catch {
      toast.error("Drive保存に失敗しました");
    } finally {
      setDriveLoading(false);
    }
  };

  const handleDriveBackup = async () => {
    if (!currentFile) return;
    setDriveLoading(true);
    try {
      const result = await backupToMyDrive(currentFile, allOps);
      if (result) {
        toast.success(
          <div>
            <div className="font-medium">マイドライブ / {result.folderName} に保存しました</div>
            <div className="text-xs opacity-70 mt-0.5">{result.fileName}</div>
          </div>
        );
      } else {
        toast.error("バックアップに失敗しました");
      }
    } catch {
      toast.error("バックアップに失敗しました");
    } finally {
      setDriveLoading(false);
    }
  };

  const handleDriveLoad = async () => {
    setDriveLoading(true);
    try {
      const result = await loadFromDrive();
      if (!result) {
        toast.info("Google Driveにデータがありませんでした");
        return;
      }
      await loadTimetableFile(result.file);
      toast.success("Google Driveから読み込みました");
      result.warnings.forEach((w: string) => toast.warning(w));
    } catch {
      toast.error("Drive読み込みに失敗しました");
    } finally {
      setDriveLoading(false);
    }
  };

  // Week label
  const weekEnd = new Date(currentWeekMonday);
  weekEnd.setDate(weekEnd.getDate() + 4);
  const weekLabel = `${currentWeekMonday.getMonth() + 1}/${currentWeekMonday.getDate()} 〜 ${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`;

  const navItems: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: "grid", label: "週間時間割", icon: <CalendarDays size={16} /> },
    { id: "stats", label: "クラス別集計", icon: <TableProperties size={16} /> },
    { id: "history", label: "変更履歴", icon: <History size={16} /> },
    { id: "audit", label: "適用ログ", icon: <Clock size={16} /> },
  ];

  // 最終同期日時のフォーマット
  const formatSyncTime = (date: Date | null) => {
    if (!date) return null;
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return "たった今";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分前`;
    return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <aside
      className={isBottomSheet
        ? "w-full flex flex-col bg-sidebar text-sidebar-foreground overflow-hidden"
        : "w-[280px] lg:w-[220px] shrink-0 flex flex-col h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border overflow-hidden"
      }
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* Logo */}
      <div className="px-4 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-sidebar-primary flex items-center justify-center shrink-0">
            <CalendarDays size={14} className="text-sidebar-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-tight text-sidebar-foreground">時間割管理</p>
            <p className="text-[10px] text-sidebar-foreground/50 leading-tight">Timetable Manager</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="lg:hidden p-1 rounded hover:bg-sidebar-accent transition-colors shrink-0"
            >
              <X size={16} className="text-sidebar-foreground/60" />
            </button>
          )}
        </div>
      </div>

      {/* File Operations */}
      <div className="px-3 py-3 border-b border-sidebar-border space-y-1.5">
        <input
          ref={fileInputRef}
          type="file"
          accept={`${TIMETABLE_FILE_EXT},.zip`}
          className="hidden"
          onChange={handleFileChange}
        />

        {/* New */}
        <button
          onClick={() => setShowNewDialog(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md
                     bg-sidebar-primary/90 hover:bg-sidebar-primary text-sidebar-primary-foreground
                     text-xs font-medium transition-colors duration-150"
        >
          <FilePlus size={13} />
          新規作成
        </button>

        {/* Open */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md
                     bg-sidebar-accent hover:bg-sidebar-accent/80 text-sidebar-foreground
                     text-xs font-medium transition-colors duration-150 border border-sidebar-border"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
          {loading ? "読み込み中..." : "ファイルを開く"}
        </button>

        {/* Save */}
        {isLoaded && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleSave}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors duration-150
                  ${isDirty
                    ? "bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40"
                    : "bg-sidebar-accent hover:bg-sidebar-accent/80 text-sidebar-foreground/60 border border-sidebar-border"
                  }`}
              >
                <Save size={13} />
                <span>{isDirty ? "保存（未保存あり）" : "保存済み"}</span>
                {isDirty && (
                  <span className="ml-auto w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p className="text-xs">Ctrl+S / ⌘S</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* File info + mode badge */}
        {loadedFileName && (
          <div className="px-1">
            <p className="text-[10px] text-sidebar-foreground/40 truncate" title={loadedFileName}>
              {currentFile?.meta.title ?? loadedFileName}
            </p>
            {mode && mode !== 'single_subject' && (
              <span className={`inline-flex items-center gap-1 text-[9px] font-medium rounded px-1.5 py-0.5 mt-0.5 ${
                mode === 'homeroom'
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-blue-500/20 text-blue-400'
              }`}>
                <BookOpen size={9} />
                {mode === 'homeroom' && `担任: ${semester?.homeroomClass ?? '未設定'}`}
                {mode === 'multi_subject' && '複数教科'}
              </span>
            )}
          </div>
        )}

        {/* Sample data */}
        <button
          onClick={handleLoadSample}
          disabled={loading}
          className="w-full text-[10px] text-sidebar-primary/70 hover:text-sidebar-primary underline text-center transition-colors mt-1"
        >
          サンプルデータを読み込む
        </button>

        {/* ─── Google Drive 連携 ─── */}
        <div className="border-t border-sidebar-border/50 pt-2 mt-1 space-y-1.5">
          <p className="text-[10px] text-sidebar-foreground/40 font-medium uppercase tracking-wider flex items-center gap-1 px-1">
            <Cloud size={9} />
            Google Drive
          </p>

          {isRestoringLogin ? (
            /* サイレントログイン復元中 */
            <div className="w-full flex items-center gap-2 px-3 py-2 rounded-md
                         bg-blue-600/10 text-blue-400/70
                         text-xs font-medium border border-blue-500/20">
              <Loader2 size={13} className="animate-spin" />
              ログイン状態を復元中...
            </div>
          ) : !isLoggedIn ? (
            /* 未ログイン時: ログインボタン */
            <button
              onClick={login}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md
                         bg-blue-600/20 hover:bg-blue-600/30 text-blue-400
                         text-xs font-medium transition-colors duration-150 border border-blue-500/30"
            >
              <LogIn size={13} />
              Googleでログイン
            </button>
          ) : (
            /* ログイン済み時 */
            <>
              {/* 同期状態バッジ */}
              <div className="flex items-center gap-1.5 px-1">
                {syncStatus === "syncing" && (
                  <span className="flex items-center gap-1 text-[10px] text-blue-400">
                    <RefreshCw size={10} className="animate-spin" />
                    同期中...
                  </span>
                )}
                {syncStatus === "synced" && (
                  <span className="flex items-center gap-1 text-[10px] text-green-400">
                    <Cloud size={10} />
                    {lastSyncedAt ? formatSyncTime(lastSyncedAt) + " に同期" : "同期済み"}
                  </span>
                )}
                {syncStatus === "error" && (
                  <span className="flex items-center gap-1 text-[10px] text-red-400" title={syncError ?? ""}>
                    <CloudOff size={10} />
                    同期エラー
                  </span>
                )}
                {(syncStatus === "idle") && (
                  <span className="flex items-center gap-1 text-[10px] text-sidebar-foreground/40">
                    <Cloud size={10} />
                    Drive連携中
                  </span>
                )}
                {/* ログアウトボタン（右端） */}
                <button
                  onClick={logout}
                  className="ml-auto flex items-center gap-1 text-[10px] text-sidebar-foreground/40 hover:text-red-400 transition-colors"
                  title="ログアウト"
                >
                  <LogOut size={10} />
                  解除
                </button>
              </div>

              {/* 自動同期の説明 */}
              <p className="text-[9px] text-sidebar-foreground/30 px-1 leading-relaxed">
                ✓ 保存のたび自動で同期（隠しフォルダ）
              </p>

              {/* Driveから復元ボタン */}
              <button
                onClick={handleDriveLoad}
                disabled={driveLoading || syncStatus === "syncing"}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md
                           bg-sidebar-accent hover:bg-sidebar-accent/80 text-sidebar-foreground/70
                           text-xs font-medium transition-colors duration-150 border border-sidebar-border
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {(driveLoading || syncStatus === "syncing") ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Cloud size={13} />
                )}
                Driveから復元
              </button>

              {/* 手動バックアップボタン */}
              {isLoaded && (
                <>
                  <button
                    onClick={handleDriveBackup}
                    disabled={driveLoading || backupStatus === "backing_up"}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md
                               bg-amber-600/15 hover:bg-amber-600/25 text-amber-400
                               text-xs font-medium transition-colors duration-150 border border-amber-500/25
                               disabled:opacity-50 disabled:cursor-not-allowed"
                    title="マイドライブ/時間割管理/ に日付付きバックアップを作成"
                  >
                    {backupStatus === "backing_up" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <CloudUpload size={13} />
                    )}
                    マイドライブにバックアップ
                  </button>
                  {backupStatus === "done" && lastBackupAt && (
                    <p className="text-[9px] text-amber-400/70 px-1">
                      ✓ {formatSyncTime(lastBackupAt)} にバックアップ完了
                    </p>
                  )}
                  {backupStatus === "error" && (
                    <p className="text-[9px] text-red-400 px-1" title={backupError ?? ""}>
                      ✗ バックアップ失敗
                    </p>
                  )}
                  <p className="text-[9px] text-sidebar-foreground/25 px-1 leading-relaxed">
                    → マイドライブ / 時間割管理 / に保存
                  </p>
                  <button
                    onClick={() => setShowDriveBackup(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md
                               bg-muted/30 hover:bg-muted/50 text-sidebar-foreground/60 hover:text-sidebar-foreground
                               text-xs font-medium transition-colors duration-150 border border-border/30"
                  >
                    <RefreshCw size={12} />
                    バックアップ一覧・復元
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Navigation - 常に表示、スクロールしない */}
      <nav className="px-2 py-2 space-y-0.5 border-b border-sidebar-border">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => {
              setActiveTab(item.id);
              // ボトムシートモードでは選択後に閉じる
              if (isBottomSheet && onClose) onClose();
            }}
            className={`sidebar-item w-full text-left ${activeTab === item.id ? "active" : ""}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* スクロール可能な下部エリア */}
      <div className={`overflow-y-auto flex flex-col ${isBottomSheet ? "" : "flex-1"}`}>

      {/* Week Navigation (only on grid tab) */}
      {activeTab === "grid" && (
        <div className="px-3 py-3 border-t border-sidebar-border">
          <p className="text-[10px] text-sidebar-foreground/50 mb-1.5 font-medium uppercase tracking-wider">週の移動</p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigateWeek(-1)}
              className="flex-1 flex items-center justify-center py-1.5 rounded hover:bg-sidebar-accent transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={goToToday}
              className="flex-1 text-[11px] py-1.5 rounded hover:bg-sidebar-accent transition-colors font-medium"
            >
              今週
            </button>
            <button
              onClick={() => navigateWeek(1)}
              className="flex-1 flex items-center justify-center py-1.5 rounded hover:bg-sidebar-accent transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <p className="text-[11px] text-sidebar-foreground/60 text-center mt-1">{weekLabel}</p>

          {/* Date picker for jump-to-week */}
          <div className="mt-2">
            <div className="relative">
              <button
                onClick={() => setShowDatePicker(v => !v)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px]
                           text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent
                           border border-sidebar-border transition-colors"
              >
                <CalendarDays size={11} />
                日付で移動
              </button>
              {showDatePicker && (
                <div className="absolute bottom-full mb-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-lg p-2 z-50">
                  <p className="text-[10px] text-muted-foreground mb-1">移動先の日付を選択</p>
                  <input
                    type="date"
                    value={datePickerValue}
                    min={semester?.startDate}
                    max={semester?.endDate}
                    onChange={e => {
                      setDatePickerValue(e.target.value);
                      if (e.target.value) {
                        goToDate(new Date(e.target.value + "T00:00:00"));
                        setShowDatePicker(false);
                        setDatePickerValue("");
                      }
                    }}
                    className="w-full text-[11px] bg-background border border-border rounded px-2 py-1 text-foreground"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Undo/Redo */}
      <div className="px-3 py-3 border-t border-sidebar-border">
        <div className="flex gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={undo}
                disabled={!canUndo}
                className="flex-1 h-8 bg-transparent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent disabled:opacity-30"
              >
                <RotateCcw size={13} />
                <span className="text-[11px] ml-1">元に戻す</span>
                {canUndo && (
                  <span className="ml-auto text-[10px] bg-sidebar-primary/20 text-sidebar-primary-foreground/70 rounded px-1">
                    {undoStack.length}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p className="text-xs">Ctrl+Z / ⌘Z</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={redo}
                disabled={!canRedo}
                className="h-8 w-8 p-0 bg-transparent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent disabled:opacity-30"
              >
                <RotateCw size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p className="text-xs">Ctrl+Shift+Z / ⌘⇧Z</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Export */}
      {isLoaded && (
        <div className="px-3 py-3 border-t border-sidebar-border">
          <p className="text-[10px] text-sidebar-foreground/50 mb-1.5 font-medium uppercase tracking-wider">エクスポート</p>
          <div className="space-y-0.5">
            <button
              onClick={exportEffective}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px]
                         text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              <FileJson size={12} />
              effective JSON
            </button>
            <button
              onClick={exportOverride}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px]
                         text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              <Download size={12} />
              override JSON
            </button>
            <button
              onClick={exportCSV}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px]
                         text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              <FileSpreadsheet size={12} />
              CSV
            </button>
            <button
              onClick={() => setShowExportDialog(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px]\n                         text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              <FileText size={12} />
              PDF / PNG / Excel
            </button>
            <button
              onClick={() => setShowExportDialog(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px]\n                         text-blue-400 hover:text-blue-300 hover:bg-sidebar-accent transition-colors font-medium"
            >
              <CalendarDays size={12} />
              Googleカレンダー連携
            </button>
          </div>
        </div>
      )}
      {showExportDialog && (
        <ExportDialog open={showExportDialog} onClose={() => setShowExportDialog(false)} />
      )}

      {/* Settings */}
      <div className="px-3 py-3 border-t border-sidebar-border space-y-1">
        {isLoaded && (
          <>
            <button
              onClick={() => setShowSettings(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px]
                         text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              <Settings size={12} />
              学期設定を変更
            </button>
            <button
              onClick={() => setShowHolidaySettings(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px]
                         text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              <CalendarDays size={12} />
              祝日・休校日の設定
            </button>
            {(mode === 'homeroom' || mode === 'multi_subject') && (
              <button
                onClick={() => setShowSubjectSettings(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px]
                           text-amber-400/80 hover:text-amber-400 hover:bg-sidebar-accent transition-colors"
              >
                <BookOpen size={12} />
                教科の管理
              </button>
            )}
          </>
        )}
        <ColorSettingsDialog />

        {/* モバイルメニュー形式切り替え (デスクトップでは非表示) */}
        <div className="lg:hidden border-t border-sidebar-border/50 pt-2 mt-1">
          <p className="text-[10px] text-sidebar-foreground/40 mb-1.5 px-2 font-medium uppercase tracking-wider flex items-center gap-1">
            <Smartphone size={9} />
            モバイルメニュー形式
          </p>
          <div className="flex gap-1">
            {([
              { value: "bottom_sheet" as SidebarStyle, label: "下から開く" },
              { value: "slide_left" as SidebarStyle, label: "左から開く" },
            ]).map(opt => (
              <button
                key={opt.value}
                onClick={() => setSidebarStyle(opt.value)}
                className={`flex-1 text-[10px] py-1 rounded border transition-colors ${
                  sidebarStyle === opt.value
                    ? "bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-primary"
                    : "border-sidebar-border text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      </div>{/* end scroll area */}

      {/* New File Wizard */}
      <NewFileWizard open={showNewDialog} onClose={() => setShowNewDialog(false)} />
      {/* Settings Dialog */}
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      {/* Holiday Settings Dialog */}
      <HolidaySettingsDialog open={showHolidaySettings} onOpenChange={setShowHolidaySettings} />
      {/* Subject Settings Dialog */}
      <SubjectSettingsDialog open={showSubjectSettings} onClose={() => setShowSubjectSettings(false)} />
      {/* Sample Picker Dialog */}
      <SamplePickerDialog open={showSamplePicker} onClose={() => setShowSamplePicker(false)} />
      {/* Drive Backup Dialog */}
      <DriveBackupDialog open={showDriveBackup} onClose={() => setShowDriveBackup(false)} />
    </aside>
  );
}
