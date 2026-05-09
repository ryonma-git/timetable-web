import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Language = "ja" | "en";

const STORAGE_KEY = "timetable_language";

const translations = {
  ja: {
    "app.title": "時間割管理",
    "app.subtitle": "Timetable Manager",
    "common.loading": "読み込み中...",
    "common.save": "保存",
    "common.saved": "保存済み",
    "common.unsaved": "未保存",
    "common.done": "完了",
    "common.error": "エラー",
    "common.cancel": "解除",
    "common.settings": "設定",
    "common.language": "言語",
    "common.japanese": "日本語",
    "common.english": "English",
    "common.justNow": "たった今",
    "common.minutesAgo": "分前",
    "sidebar.newFile": "新規作成",
    "sidebar.openFile": "ファイルを開く",
    "sidebar.saveWithUnsaved": "保存（未保存あり）",
    "sidebar.loadSample": "サンプルデータを読み込む",
    "sidebar.homeroom": "担任",
    "sidebar.notSet": "未設定",
    "sidebar.multiSubject": "複数教科",
    "sidebar.nav.grid": "週間時間割",
    "sidebar.nav.stats": "クラス別集計",
    "sidebar.nav.history": "変更履歴",
    "sidebar.nav.audit": "適用ログ",
    "sidebar.weekNav": "週の移動",
    "sidebar.thisWeek": "今週",
    "sidebar.jumpByDate": "日付で移動",
    "sidebar.pickDate": "移動先の日付を選択",
    "sidebar.undo": "元に戻す",
    "sidebar.export": "エクスポート",
    "sidebar.googleCalendar": "Googleカレンダー連携",
    "sidebar.semesterSettings": "学期設定を変更",
    "sidebar.holidaySettings": "祝日・休校日の設定",
    "sidebar.subjectManagement": "教科の管理",
    "sidebar.mobileMenuStyle": "モバイルメニュー形式",
    "sidebar.mobileBottomSheet": "下から開く",
    "sidebar.mobileSlideLeft": "左から開く",
    "drive.restoring": "ログイン状態を復元中...",
    "drive.loginExpired": "Googleログインが切れました。再ログインしてください。",
    "drive.relogin": "再ログイン",
    "drive.requestCookie": "Cookie許可を要求",
    "drive.requestCookieTitle": "サードパーティCookieの許可をブラウザに要求します",
    "drive.login": "Googleでログイン",
    "drive.syncing": "同期中...",
    "drive.syncedSuffix": " に同期",
    "drive.synced": "同期済み",
    "drive.syncError": "同期エラー",
    "drive.connected": "Drive連携中",
    "drive.disconnect": "解除",
    "drive.reauthTitle": "アカウントの権限を再確認します",
    "drive.logoutTitle": "ログアウト",
    "drive.autoSyncHelp": "✓ 保存のたび自動で同期（隠しフォルダ）",
    "drive.syncOnly": "Drive同期のみ",
    "drive.syncOnlyTitle": "ローカル保存なしで Drive の隠しフォルダだけ更新します",
    "drive.restore": "Driveから復元",
    "drive.backupTitle": "マイドライブ/時間割管理/ に日付付きバックアップを作成",
    "drive.backupToMyDrive": "マイドライブにバックアップ",
    "drive.backupDoneSuffix": " にバックアップ完了",
    "drive.backupFailed": "バックアップ失敗",
    "drive.backupDestination": "→ マイドライブ / 時間割管理 / に保存",
    "drive.backupList": "バックアップ一覧・復元",
    "toast.loaded": "読み込み完了",
    "toast.zipLoaded": "ZIPから読み込み完了",
    "toast.supportedFiles": "対応ファイル: .timetable または .zip",
    "toast.loadError": "読み込みエラー",
    "toast.saved": "保存しました",
    "toast.driveSaved": "Google Driveに保存しました",
    "toast.driveSaveFailed": "Drive保存に失敗しました",
    "toast.backupFailed": "バックアップに失敗しました",
    "toast.driveEmpty": "Google Driveにデータがありませんでした",
    "toast.driveLoaded": "Google Driveから読み込みました",
    "toast.driveLoadFailed": "Drive読み込みに失敗しました",
    "home.titleFallback": "時間割管理",
    "home.saveLocalTitle": "クリックしてローカル保存",
    "home.import": "インポート",
    "home.importTitle": "パッチインポート",
    "home.export": "エクスポート",
    "home.exportTitle": "エクスポート（Excel / PDF / ICS / Google連携 / 生データ）",
    "home.googleLink": "Google連携",
    "home.googleLinkTitle": "Googleカレンダーに直接追加",
    "home.print": "印刷",
    "home.moreActions": "その他の操作",
    "home.exportMenu": "エクスポート",
    "home.exportMenuItem": "エクスポート...",
    "home.googleCalendarMenuItem": "Googleカレンダー連携...",
    "home.rawCsv": "生データ（CSV）",
    "home.patchImport": "パッチインポート",
    "home.printPreview": "印刷プレビュー",
  },
  en: {
    "app.title": "Timetable Manager",
    "app.subtitle": "Timetable Manager",
    "common.loading": "Loading...",
    "common.save": "Save",
    "common.saved": "Saved",
    "common.unsaved": "Unsaved",
    "common.done": "Done",
    "common.error": "Error",
    "common.cancel": "Disconnect",
    "common.settings": "Settings",
    "common.language": "Language",
    "common.japanese": "Japanese",
    "common.english": "English",
    "common.justNow": "Just now",
    "common.minutesAgo": "min ago",
    "sidebar.newFile": "New File",
    "sidebar.openFile": "Open File",
    "sidebar.saveWithUnsaved": "Save (unsaved changes)",
    "sidebar.loadSample": "Load sample data",
    "sidebar.homeroom": "Homeroom",
    "sidebar.notSet": "Not set",
    "sidebar.multiSubject": "Multiple subjects",
    "sidebar.nav.grid": "Weekly Timetable",
    "sidebar.nav.stats": "Class Stats",
    "sidebar.nav.history": "Change History",
    "sidebar.nav.audit": "Apply Log",
    "sidebar.weekNav": "Week Navigation",
    "sidebar.thisWeek": "This Week",
    "sidebar.jumpByDate": "Jump by Date",
    "sidebar.pickDate": "Select a date",
    "sidebar.undo": "Undo",
    "sidebar.export": "Export",
    "sidebar.googleCalendar": "Google Calendar",
    "sidebar.semesterSettings": "Semester Settings",
    "sidebar.holidaySettings": "Holidays / School Closures",
    "sidebar.subjectManagement": "Manage Subjects",
    "sidebar.mobileMenuStyle": "Mobile Menu Style",
    "sidebar.mobileBottomSheet": "Bottom Sheet",
    "sidebar.mobileSlideLeft": "Slide from Left",
    "drive.restoring": "Restoring login...",
    "drive.loginExpired": "Google login expired. Please sign in again.",
    "drive.relogin": "Sign in again",
    "drive.requestCookie": "Request cookie access",
    "drive.requestCookieTitle": "Request browser permission for third-party cookie access",
    "drive.login": "Sign in with Google",
    "drive.syncing": "Syncing...",
    "drive.syncedSuffix": " synced",
    "drive.synced": "Synced",
    "drive.syncError": "Sync error",
    "drive.connected": "Drive connected",
    "drive.disconnect": "Disconnect",
    "drive.reauthTitle": "Reconfirm account permissions",
    "drive.logoutTitle": "Sign out",
    "drive.autoSyncHelp": "Auto-sync on every save (hidden folder)",
    "drive.syncOnly": "Sync to Drive only",
    "drive.syncOnlyTitle": "Update only the hidden Drive copy without local save",
    "drive.restore": "Restore from Drive",
    "drive.backupTitle": "Create a dated backup in My Drive/Timetable Manager/",
    "drive.backupToMyDrive": "Back up to My Drive",
    "drive.backupDoneSuffix": " backup complete",
    "drive.backupFailed": "Backup failed",
    "drive.backupDestination": "Saved to My Drive / Timetable Manager /",
    "drive.backupList": "Backup List / Restore",
    "toast.loaded": "Loaded",
    "toast.zipLoaded": "Loaded from ZIP",
    "toast.supportedFiles": "Supported files: .timetable or .zip",
    "toast.loadError": "Load error",
    "toast.saved": "Saved",
    "toast.driveSaved": "Saved to Google Drive",
    "toast.driveSaveFailed": "Failed to save to Drive",
    "toast.backupFailed": "Backup failed",
    "toast.driveEmpty": "No data found in Google Drive",
    "toast.driveLoaded": "Loaded from Google Drive",
    "toast.driveLoadFailed": "Failed to load from Drive",
    "home.titleFallback": "Timetable Manager",
    "home.saveLocalTitle": "Click to save locally",
    "home.import": "Import",
    "home.importTitle": "Patch import",
    "home.export": "Export",
    "home.exportTitle": "Export (Excel / PDF / ICS / Google / Raw data)",
    "home.googleLink": "Google",
    "home.googleLinkTitle": "Add directly to Google Calendar",
    "home.print": "Print",
    "home.moreActions": "More actions",
    "home.exportMenu": "Export",
    "home.exportMenuItem": "Export...",
    "home.googleCalendarMenuItem": "Google Calendar...",
    "home.rawCsv": "Raw Data (CSV)",
    "home.patchImport": "Patch Import",
    "home.printPreview": "Print Preview",
  },
} as const;

export type TranslationKey = keyof typeof translations.ja;

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function readStoredLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "en" ? "en" : "ja";
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage: setLanguageState,
    t: (key) => translations[language][key] ?? translations.ja[key],
  }), [language]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}
