// useSidebarStyle.ts
// モバイルでのサイドバー表示方式を管理するカスタムフック
// "bottom_sheet" | "slide_left" の2種類
// Reactコンテキストで共有 → Home.tsx と Sidebar.tsx が同じ状態を参照する

import { createContext, useContext, useState } from "react";

export type SidebarStyle = "bottom_sheet" | "slide_left";

const STORAGE_KEY = "mobile_sidebar_style";
const DEFAULT_STYLE: SidebarStyle = "bottom_sheet";

function readStoredStyle(): SidebarStyle {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "bottom_sheet" || stored === "slide_left") return stored;
  } catch {
    // ignore
  }
  return DEFAULT_STYLE;
}

interface SidebarStyleContextValue {
  sidebarStyle: SidebarStyle;
  setSidebarStyle: (style: SidebarStyle) => void;
}

export const SidebarStyleContext = createContext<SidebarStyleContextValue>({
  sidebarStyle: DEFAULT_STYLE,
  setSidebarStyle: () => {},
});

export function createSidebarStyleState(): SidebarStyleContextValue {
  // This is called inside SidebarStyleProvider - not a hook itself
  return { sidebarStyle: DEFAULT_STYLE, setSidebarStyle: () => {} };
}

export function useSidebarStyle(): SidebarStyleContextValue {
  return useContext(SidebarStyleContext);
}

export function useSidebarStyleState(): SidebarStyleContextValue {
  const [sidebarStyle, setSidebarStyleState] = useState<SidebarStyle>(readStoredStyle);

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
