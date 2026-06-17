// 各教科書会社の年間指導計画Excelの取り込みダイアログ（P3）
// パーサ: lib/teachingPlanPublisherImport.ts / 適用: applyTemplate()

import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FileUp, Info, Building2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { parsePublisherFile, type PublisherParseResult, type ApplyMode } from "@/lib/teachingPlanPublisherImport";
import { applyTemplate, type TemplateDoc } from "@/lib/teachingPlanTemplates";
import type { GradeSubjectPlan } from "@/lib/timetableFile";

const GRADES = ["1年", "2年", "3年", "4年", "5年", "6年"];
const SUBJECTS = ["国語", "算数", "理科", "社会", "英語", "生活", "音楽", "図工", "家庭", "体育", "道徳", "外国語"];

interface PlanRow { include: boolean; grade: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  getPlan: (id: string) => GradeSubjectPlan | null;
  onApply: (plan: GradeSubjectPlan) => void;
}

export function TeachingPlanPublisherImportDialog({ open, onClose, getPlan, onApply }: Props) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<PublisherParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [subject, setSubject] = useState("理科");
  const [mode, setMode] = useState<ApplyMode>("replaceAll");
  const [applying, setApplying] = useState(false);

  const reset = () => { setResult(null); setRows([]); setFileName(""); };

  const handleFile = async (file: File) => {
    setParsing(true); reset();
    try {
      const r = await parsePublisherFile(file);
      if (r.kind === "unknown" || r.plans.length === 0) {
        toast.error(t("pub.parseFailed"));
        setResult(r);
        return;
      }
      setResult(r);
      setFileName(file.name);
      setSubject(r.plans[0].subjectHint || "理科");
      setRows(r.plans.map((p) => ({ include: true, grade: p.gradeHint ?? "" })));
    } catch (e) {
      toast.error(`${t("pub.parseFailed")}: ${e instanceof Error ? e.message : e}`);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const previewPlan = result?.plans.find((_, i) => rows[i]?.include) ?? null;
  const previewIdx = result?.plans.findIndex((_, i) => rows[i]?.include) ?? -1;

  const handleImport = () => {
    if (!result) return;
    const targets = result.plans
      .map((p, i) => ({ p, row: rows[i] }))
      .filter((x) => x.row?.include && x.row.grade);
    if (targets.length === 0) { toast.warning(t("pub.selectGrade")); return; }
    setApplying(true);
    try {
      let n = 0;
      for (const { p, row } of targets) {
        const id = `${row.grade}|||${subject}`;
        const doc: TemplateDoc = {
          id, source: t("pub.sourceLabel"), sourceKind: "imported",
          grade: row.grade, subject, units: p.units,
        };
        const plan = applyTemplate(getPlan(id), doc, mode, { id, grade: row.grade, subject });
        onApply(plan);
        n++;
      }
      toast.success(`${n}${t("pub.importedSuffix")}`);
      onClose();
    } catch (e) {
      toast.error(`${t("pub.importFailed")}: ${e instanceof Error ? e.message : e}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 size={18} className="text-indigo-600" />
            {t("pub.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{t("pub.intro")}</p>

          {/* ファイル選択 */}
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          <Button variant="outline" className="w-full h-10 gap-2 border-dashed" disabled={parsing}
            onClick={() => fileRef.current?.click()}>
            {parsing ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} className="text-indigo-600" />}
            {parsing ? t("pub.parsing") : fileName || t("pub.chooseFile")}
          </Button>

          {result && result.plans.length > 0 && (
            <>
              <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Info size={12} />
                {result.kind === "perUnitSheets" ? t("pub.kindUnitSheets") : t("pub.kindAllocation")}
                ・{t("pub.detected")}: {result.plans.length}
              </div>

              {/* 教科（全体共通） */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t("pub.subject")}</span>
                <Select value={subject} onValueChange={setSubject}>
                  <SelectTrigger className="h-8 w-32 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {/* 取り込む計画（学年ごと） */}
              <div className="border border-border rounded-lg divide-y divide-border">
                {result.plans.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5">
                    <input type="checkbox" className="accent-primary"
                      checked={rows[i]?.include ?? false}
                      onChange={(e) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, include: e.target.checked } : r))} />
                    <Select value={rows[i]?.grade ?? ""} onValueChange={(v) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, grade: v } : r))}>
                      <SelectTrigger className="h-8 w-24 text-sm"><SelectValue placeholder={t("pub.gradePh")} /></SelectTrigger>
                      <SelectContent>{GRADES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">
                      {p.units.length}{t("tpl.unitsUnit")} ・ {p.periods}{t("tpl.periodsUnit")}
                    </span>
                  </div>
                ))}
              </div>

              {/* プレビュー */}
              {previewPlan && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="bg-muted/40 px-3 py-1.5 text-xs font-semibold flex justify-between">
                    <span>{t("tpl.preview")}{previewIdx >= 0 && rows[previewIdx]?.grade ? `（${rows[previewIdx].grade} ${subject}）` : ""}</span>
                  </div>
                  <div className="max-h-44 overflow-y-auto p-3 text-xs space-y-1.5">
                    {previewPlan.units.map((u, ui) => (
                      <div key={ui}>
                        <span className="font-bold">{u.name}</span>
                        <span className="text-muted-foreground"> ({u.lessons.length})</span>
                        {u.lessons[0] && <span className="text-muted-foreground"> — {u.lessons.find((l) => l) || t("pub.contentEmpty")}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.warnings.map((w, i) => (
                <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-700 flex gap-1.5">
                  <Info size={13} className="shrink-0 mt-0.5" />{w}
                </div>
              ))}

              {/* 適用方法 */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold">{t("tpl.applyMode")}</p>
                {([
                  { v: "replaceAll", label: t("tpl.modeAll"), desc: t("tpl.modeAllDesc") },
                  { v: "fillEmpty", label: t("tpl.modeFill"), desc: t("tpl.modeFillDesc") },
                ] as const).map((m) => (
                  <label key={m.v} className={cn("flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all",
                    mode === m.v ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                    <input type="radio" name="pubmode" className="mt-1 accent-primary" checked={mode === m.v} onChange={() => setMode(m.v)} />
                    <div><p className="text-sm font-medium">{m.label}</p><p className="text-[11px] text-muted-foreground">{m.desc}</p></div>
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border">
                <Button variant="outline" size="sm" onClick={onClose}>{t("tpl.cancel")}</Button>
                <Button size="sm" className="gap-1.5 bg-primary" disabled={applying} onClick={handleImport}>
                  {applying ? <Loader2 size={13} className="animate-spin" /> : <FileUp size={13} />}
                  {t("pub.import")}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
