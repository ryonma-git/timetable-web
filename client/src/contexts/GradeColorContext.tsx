// GradeColorContext.tsx
// Design: Swiss Grid × Japanese Functional Design
// Global context for grade color settings

import React, { createContext, useContext, useState } from "react";
import {
  GradeColorDef,
  loadGradeColorsFromStorage,
} from "@/lib/gradeColors";

interface GradeColorContextValue {
  gradeColors: Record<string, GradeColorDef>;
  setGradeColors: (colors: Record<string, GradeColorDef>) => void;
}

const GradeColorContext = createContext<GradeColorContextValue | null>(null);

export function GradeColorProvider({ children }: { children: React.ReactNode }) {
  const [gradeColors, setGradeColors] = useState<Record<string, GradeColorDef>>(
    () => loadGradeColorsFromStorage()
  );

  return (
    <GradeColorContext.Provider value={{ gradeColors, setGradeColors }}>
      {children}
    </GradeColorContext.Provider>
  );
}

export function useGradeColors(): GradeColorContextValue {
  const ctx = useContext(GradeColorContext);
  if (!ctx) throw new Error("useGradeColors must be used within GradeColorProvider");
  return ctx;
}
