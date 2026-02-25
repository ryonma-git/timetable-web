// GradeColorContext.tsx
// Design: Swiss Grid × Japanese Functional Design
// Global context for grade color settings + subject color settings

import React, { createContext, useContext, useState } from "react";
import {
  GradeColorDef,
  loadGradeColorsFromStorage,
  loadSubjectColorsFromStorage,
  saveSubjectColorsToStorage,
} from "@/lib/gradeColors";

interface GradeColorContextValue {
  gradeColors: Record<string, GradeColorDef>;
  setGradeColors: (colors: Record<string, GradeColorDef>) => void;
  /** 教科色マップ: key = 教科名, value = GradeColorDef */
  subjectColors: Record<string, GradeColorDef>;
  setSubjectColors: (colors: Record<string, GradeColorDef>) => void;
  /** 教科色を1件更新してlocalStorageに保存 */
  updateSubjectColor: (subject: string, color: GradeColorDef) => void;
  /** 教科色を削除（デフォルトに戻す） */
  removeSubjectColor: (subject: string) => void;
}

const GradeColorContext = createContext<GradeColorContextValue | null>(null);

export function GradeColorProvider({ children }: { children: React.ReactNode }) {
  const [gradeColors, setGradeColors] = useState<Record<string, GradeColorDef>>(
    () => loadGradeColorsFromStorage()
  );

  const [subjectColors, setSubjectColorsState] = useState<Record<string, GradeColorDef>>(
    () => loadSubjectColorsFromStorage()
  );

  const setSubjectColors = (colors: Record<string, GradeColorDef>) => {
    setSubjectColorsState(colors);
    saveSubjectColorsToStorage(colors);
  };

  const updateSubjectColor = (subject: string, color: GradeColorDef) => {
    setSubjectColorsState(prev => {
      const next = { ...prev, [subject]: color };
      saveSubjectColorsToStorage(next);
      return next;
    });
  };

  const removeSubjectColor = (subject: string) => {
    setSubjectColorsState(prev => {
      const next = { ...prev };
      delete next[subject];
      saveSubjectColorsToStorage(next);
      return next;
    });
  };

  return (
    <GradeColorContext.Provider value={{
      gradeColors, setGradeColors,
      subjectColors, setSubjectColors,
      updateSubjectColor, removeSubjectColor,
    }}>
      {children}
    </GradeColorContext.Provider>
  );
}

export function useGradeColors(): GradeColorContextValue {
  const ctx = useContext(GradeColorContext);
  if (!ctx) throw new Error("useGradeColors must be used within GradeColorProvider");
  return ctx;
}
