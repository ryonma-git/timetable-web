// Sidebar.tsx
// Design: Swiss Grid × Japanese Functional Design
// Left sidebar: file load, navigation, undo/redo, export

import { useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileJson,
  FileSpreadsheet,
  History,
  Loader2,
  RotateCcw,
  RotateCw,
  TableProperties,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useTimetable, type ActiveTab } from "@/contexts/TimetableContext";
import { formatDateJP } from "@/lib/timetable";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

export function Sidebar() {
  const {
    isLoaded, loadZIP, loadedFileName,
    activeTab, setActiveTab,
    currentWeekMonday, navigateWeek, goToToday,
    canUndo, canRedo, undo, redo,
    undoStack,
    exportEffective, exportOverride, exportCSV,
    pendingOps,
  } = useTimetable();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const result = await loadZIP(file);
      toast.success(`読み込み完了: ${result.loadedFiles.length}ファイル`);
      if (result.warnings.length > 0) {
        result.warnings.forEach(w => toast.warning(w));
      }
    } catch (err) {
      toast.error(`読み込みエラー: ${String(err)}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleLoadSample = async () => {
    setLoading(true);
    try {
      const res = await fetch('https://files.manuscdn.com/user_upload_by_module/session_file/310519663293463662/aEseOLQbmvrIqnRV.zip');
      const blob = await res.blob();
      const file = new File([blob], 'sample_data.zip', { type: 'application/zip' });
      const result = await loadZIP(file);
      toast.success(`サンプルデータ読み込み完了: ${result.loadedFiles.length}ファイル`);
      if (result.warnings.length > 0) {
        result.warnings.forEach(w => toast.warning(w));
      }
    } catch (err) {
      toast.error(`読み込みエラー: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith(".zip")) {
      toast.error("ZIPファイルをドロップしてください");
      return;
    }
    setLoading(true);
    try {
      const result = await loadZIP(file);
      toast.success(`読み込み完了: ${result.loadedFiles.length}ファイル`);
      if (result.warnings.length > 0) {
        result.warnings.forEach(w => toast.warning(w));
      }
    } catch (err) {
      toast.error(`読み込みエラー: ${String(err)}`);
    } finally {
      setLoading(false);
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

  return (
    <aside
      className="w-[220px] shrink-0 flex flex-col h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border"
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* Logo */}
      <div className="px-4 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-sidebar-primary flex items-center justify-center shrink-0">
            <CalendarDays size={14} className="text-sidebar-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight text-sidebar-foreground">時間割管理</p>
            <p className="text-[10px] text-sidebar-foreground/50 leading-tight">Timetable Manager</p>
          </div>
        </div>
      </div>

      {/* File Load */}
      <div className="px-3 py-3 border-b border-sidebar-border">
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md
                     bg-sidebar-accent hover:bg-sidebar-primary/20 text-sidebar-foreground
                     text-xs font-medium transition-colors duration-150 border border-sidebar-border"
        >
          {loading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Upload size={13} />
          )}
          {loading ? "読み込み中..." : "ZIPを開く..."}
        </button>
        {loadedFileName && (
          <p className="mt-1.5 text-[10px] text-sidebar-foreground/50 truncate px-1" title={loadedFileName}>
            📄 {loadedFileName}
          </p>
        )}
        {!loadedFileName && (
          <>
            <p className="mt-1.5 text-[10px] text-sidebar-foreground/40 text-center">
              またはドラッグ＆ドロップ
            </p>
            <button
              onClick={handleLoadSample}
              disabled={loading}
              className="mt-1 w-full text-[10px] text-sidebar-primary/70 hover:text-sidebar-primary underline text-center transition-colors"
            >
              サンプルデータを読み込む
            </button>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`sidebar-item w-full text-left ${activeTab === item.id ? "active" : ""}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

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
        {pendingOps.length > 0 && (
          <p className="mt-1.5 text-[10px] text-amber-400 text-center">
            未保存の変更: {pendingOps.length}件
          </p>
        )}
      </div>

      {/* Export */}
      {isLoaded && (
        <div className="px-3 py-3 border-t border-sidebar-border">
          <p className="text-[10px] text-sidebar-foreground/50 mb-1.5 font-medium uppercase tracking-wider">エクスポート</p>
          <div className="space-y-1">
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
          </div>
        </div>
      )}
    </aside>
  );
}
