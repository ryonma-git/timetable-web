// useSidebarStyle.ts
// モバイルでのサイドバー表示方式を管理するカスタムフック
// "bottom_sheet" | "slide_left" の2種類
// localStorageに保存して永続化

import { useState, useEffect } from "react";

export type SidebarStyle = "bottom_sheet" | "slide_left";

const STORAGE_KEY = "mobile_sidebar_style";
const DEFAULT_STYLE: SidebarStyle = "bottom_sheet";

export function useSidebarStyle() {
  const [sidebarStyle, setSidebarStyleState] = useState<SidebarStyle>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "bottom_sheet" || stored === "slide_left") return stored;
    } catch {
      // ignore
    }
    return DEFAULT_STYLE;
  });

  const setSidebarStyle = (style: SidebarStyle) => {
    setSidebarStyleState(style);
    try {
      localStorage.setItem(STORAGE_KEY, style);
    } catch {
      // ignore
    }
  };

  return { sidebarStyle, setSidebarStyle };
}
