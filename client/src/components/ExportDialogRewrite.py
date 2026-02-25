#!/usr/bin/env python3
import re

with open('client/src/components/ExportDialog.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix import
content = content.replace(
    'import { exportToPNG, exportTimetableExcel } from "@/lib/exportUtils";',
    'import { exportTimetableExcel } from "@/lib/exportUtils";\nimport { exportTimetablePNG, exportTimetablePDF } from "@/lib/timetableSvgExport";'
)

# Replace handleExportPDF block using regex
pdf_pattern = r'  // ── Export: PDF \(multi-page via print\) ──+\n  const handleExportPDF = useCallback\(async \(\) => \{.*?\}, \[printRef, weeksToPrint, currentFile, orientation\]\);'
pdf_replacement = '''  // ── Export: PDF (SVGベース、週ごとに1ページ) ────────────────────────────
  const handleExportPDF = useCallback(async () => {
    if (weeksToPrint.length === 0) return;
    setIsExporting(true);
    try {
      const title = currentFile?.meta.title ?? "時間割";
      await exportTimetablePDF(
        {
          effectiveEntries,
          weekMondayStrs: weeksToPrint,
          title,
          filterClass: filterClass === "__all__" ? null : filterClass,
          gradeColors,
          showReason,
          showEmptyCells,
          holidays,
          orientation,
        },
        `${title}_時間割.pdf`,
      );
    } finally {
      setIsExporting(false);
    }
  }, [weeksToPrint, currentFile, effectiveEntries, filterClass, gradeColors, showReason, showEmptyCells, holidays, orientation]);'''

content, n1 = re.subn(pdf_pattern, pdf_replacement, content, flags=re.DOTALL)
print(f'PDF replaced: {n1}')

# Replace handleExportPNG block using regex
png_pattern = r'  // ── Export: PNG ──+\n  const handleExportPNG = useCallback\(async \(\) => \{.*?\}, \[printRef, weeksToPrint, currentFile\]\);'
png_replacement = '''  // ── Export: PNG (SVGベース) ────────────────────────────────────────────
  const handleExportPNG = useCallback(async () => {
    if (weeksToPrint.length === 0) return;
    setIsExporting(true);
    try {
      const title = currentFile?.meta.title ?? "時間割";
      await exportTimetablePNG(
        {
          effectiveEntries,
          weekMondayStrs: weeksToPrint,
          title,
          filterClass: filterClass === "__all__" ? null : filterClass,
          gradeColors,
          showReason,
          showEmptyCells,
          holidays,
          orientation,
        },
        `${title}_時間割.png`,
      );
    } finally {
      setIsExporting(false);
    }
  }, [weeksToPrint, currentFile, effectiveEntries, filterClass, gradeColors, showReason, showEmptyCells, holidays, orientation]);'''

content, n2 = re.subn(png_pattern, png_replacement, content, flags=re.DOTALL)
print(f'PNG replaced: {n2}')

with open('client/src/components/ExportDialog.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
