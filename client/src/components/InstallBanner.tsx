// InstallBanner.tsx
// iOSのSafariで開いた際に「ホーム画面に追加」を案内するバナー
// - スタンドアロン（PWAとして起動済み）の場合は表示しない
// - 一度閉じたら7日間は表示しない（localStorage）
// - iOS Safari以外では表示しない

import { useState, useEffect } from "react";
import { X, Share } from "lucide-react";

const STORAGE_KEY = "install_banner_dismissed_at";
const DISMISS_DAYS = 7;

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  // SafariはChromeやFxのUAを含まない
  const isSafari = /safari/i.test(ua) && !/crios|fxios|opios|chrome/i.test(ua);
  return isIos && isSafari;
}

function isStandalone(): boolean {
  // PWAとしてホーム画面から起動されている場合
  return (
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function wasDismissedRecently(): boolean {
  try {
    const ts = localStorage.getItem(STORAGE_KEY);
    if (!ts) return false;
    const dismissedAt = new Date(ts).getTime();
    const now = Date.now();
    return now - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function InstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // iOS Safari かつ スタンドアロンでない かつ 最近閉じていない場合に表示
    if (isIosSafari() && !isStandalone() && !wasDismissedRecently()) {
      // 少し遅延させてページ読み込み後に表示
      const timer = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // ignore
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[200] mx-3 mb-4 rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden"
      style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
    >
      {/* 上部アクセントライン */}
      <div className="h-1 bg-gradient-to-r from-blue-500 to-indigo-600" />

      <div className="p-4">
        {/* ヘッダー */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-md">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-white" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm leading-tight">時間割管理をホーム画面に追加</p>
              <p className="text-xs text-gray-500 mt-0.5">アプリとして快適に使えます</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0 transition-colors"
            aria-label="閉じる"
          >
            <X size={16} />
          </button>
        </div>

        {/* 手順 */}
        <div className="bg-gray-50 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">1</div>
            <div className="flex items-center gap-1.5 text-sm text-gray-700">
              <span>画面下の</span>
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white border border-gray-300 rounded text-xs font-medium">
                <Share size={11} className="text-blue-500" />
                <span>共有</span>
              </span>
              <span>をタップ</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">2</div>
            <p className="text-sm text-gray-700">
              <span className="font-medium">「ホーム画面に追加」</span>を選択
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">3</div>
            <p className="text-sm text-gray-700">右上の<span className="font-medium">「追加」</span>をタップして完了</p>
          </div>
        </div>
      </div>
    </div>
  );
}
