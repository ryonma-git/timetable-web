// 指導計画テンプレート取り込みダイアログ（P1: 内蔵・学習指導要領ベース）
// 設計: docs/teaching-plan-import-design.md

import { useState, useEffect, useMemo, useRef } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, BookMarked, Info, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  fetchTemplateIndex, fetchTemplateDoc, applyTemplate,
  getExtensionPacks, saveExtensionPack, removeExtensionPack,
  getExtensionTemplateDoc, extensionPacksAsIndexEntries,
  type TemplateIndex, type TemplateIndexEntry, type TemplateDoc, type ApplyMode,
  type ExtensionPack,
} from "@/lib/teachingPlanTemplates";
import type { GradeSubjectPlan } from "@/lib/timetableFile";

interface Props {
  open: boolean;
  onClose: () => void;
  /** ダイアログを開いた時点の学年・教科（初期選択に使う） */
  initialGrade?: string;
  initialSubject?: string;
  /** id (`学年|||教科`) から既存計画を引く */
  getPlan: (id: string) => GradeSubjectPlan | null;
  /** 適用後（upsertTeachingPlan を呼ぶ） */
  onApply: (plan: GradeSubjectPlan) => void;
}

export function TeachingPlanTemplateDialog({ open, onClose, initialGrade, initialSubject, getPlan, onApply }: Props) {
  const { t } = useLanguage();
  const [index, setIndex] = useState<TemplateIndex | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sourceId, setSourceId] = useState<string>("");
  const [grade, setGrade] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string>("");

  const [doc, setDoc] = useState<TemplateDoc | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [mode, setMode] = useState<ApplyMode>("fillEmpty");
  const [applying, setApplying] = useState(false);

  const [extPacks, setExtPacks] = useState<ExtensionPack[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // 取り込み先（＝選んだ学年×教科）。セレクタ変更に追従する
  const target = useMemo(
    () => (grade && subject ? { id: `${grade}|||${subject}`, grade, subject } : null),
    [grade, subject]
  );
  const existingPlan = useMemo(
    () => (target ? getPlan(target.id) : null),
    [target, getPlan]
  );

  // 一覧取得 & 初期選択（開いた時点の学年×教科をプリセット）
  useEffect(() => {
    if (!open) return;
    setError(null); setDoc(null); setSelectedId("");
    setExtPacks(getExtensionPacks());
    setLoadingIndex(true);
    fetchTemplateIndex()
      .then((idx) => {
        setIndex(idx);
        setSourceId(idx.sources[0]?.id ?? "");
        setGrade(initialGrade ?? idx.templates[0]?.grade ?? "");
        setSubject(initialSubject ?? idx.templates[0]?.subject ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingIndex(false));
  }, [open, initialGrade, initialSubject]);

  // 取り込み先が変わったら既定の取り込み方法を更新（入力済みなら補完、空なら全置換）
  useEffect(() => {
    setMode(existingPlan && existingPlan.lessons.some((l) => l.content?.trim()) ? "fillEmpty" : "replaceAll");
  }, [existingPlan]);

  const extEntries = useMemo(() => extensionPacksAsIndexEntries(), [extPacks]);
  const templates = useMemo(
    () => [...(index?.templates ?? []), ...extEntries],
    [index, extEntries]
  );
  const grades = useMemo(() => Array.from(new Set(templates.map((x) => x.grade))).sort(), [templates]);
  const subjects = useMemo(
    () => Array.from(new Set(templates.filter((x) => x.grade === grade).map((x) => x.subject))).sort(),
    [templates, grade]
  );
  const matches = useMemo(
    () => templates.filter((x) => x.grade === grade && x.subject === subject),
    [templates, grade, subject]
  );

  // 学年/教科が変わったら候補の先頭を選ぶ
  useEffect(() => {
    if (matches.length > 0) setSelectedId(matches[0].id);
    else setSelectedId("");
  }, [matches]);

  // 選択テンプレ本体を遅延ロード
  useEffect(() => {
    const entry = matches.find((m) => m.id === selectedId);
    if (!entry) { setDoc(null); return; }
    if (entry.sourceKind === "extension") {
      const extDoc = getExtensionTemplateDoc(entry.id);
      setDoc(extDoc);
      return;
    }
    setLoadingDoc(true);
    fetchTemplateDoc(entry)
      .then(setDoc)
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingDoc(false));
  }, [selectedId, matches]);

  const hasExistingContent = !!existingPlan && existingPlan.lessons.some((l) => l.content?.trim());

  // 拡張パッケージJSONの読み込み
  const handleImportPack = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string);
        if (!raw || typeof raw !== "object" || !Array.isArray(raw.templates)) {
          throw new Error(t("tpl.packInvalid"));
        }
        const pack: ExtensionPack = {
          packId: raw.packId ?? `ext-${Date.now()}`,
          name: raw.name ?? file.name.replace(/\.json$/, ""),
          importedAt: new Date().toISOString(),
          templates: raw.templates,
        };
        saveExtensionPack(pack);
        setExtPacks(getExtensionPacks());
        toast.success(t("tpl.packImported").replace("{n}", String(pack.templates.length)));
      } catch (err) {
        toast.error(`${t("tpl.packError")}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleRemovePack = (packId: string) => {
    removeExtensionPack(packId);
    setExtPacks(getExtensionPacks());
    toast.success(t("tpl.packRemoved"));
  };

  const handleApply = () => {
    if (!doc || !target) return;
    setApplying(true);
    try {
      const plan = applyTemplate(existingPlan, doc, mode, target);
      onApply(plan);
      toast.success(t("tpl.applied"));
      onClose();
    } catch (e) {
      toast.error(`${t("tpl.applyFailed")}: ${e instanceof Error ? e.message : e}`);
    } finally {
      setApplying(false);
    }
  };

  const totalPeriods = doc?.units.reduce((s, u) => s + u.lessons.length, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookMarked size={18} className="text-indigo-600" />
            {t("tpl.title")}
          </DialogTitle>
        </DialogHeader>

        {loadingIndex ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
            <Loader2 size={16} className="animate-spin" />{t("tpl.loading")}
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-sm text-destructive">
            {t("tpl.loadError")}: {error}
          </div>
        ) : (
          <div className="space-y-4">
            {/* セレクタ */}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("tpl.source")}>
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {index?.sources.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("tpl.edition")}>
                <Select value={matches.find((m) => m.id === selectedId)?.edition ?? "標準"} onValueChange={() => {}}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="標準">{t("tpl.editionStd")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("tpl.grade")}>
                <Select value={grade} onValueChange={setGrade}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {grades.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("tpl.subject")}>
                <Select value={subject} onValueChange={setSubject}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {target && (
              <p className="text-[11px] text-muted-foreground">
                {t("tpl.targetLabel")}: <span className="font-semibold text-foreground">{target.grade} {target.subject}</span>
              </p>
            )}

            {/* プレビュー */}
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="bg-muted/40 px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-semibold">{t("tpl.preview")}</span>
                {doc && <span className="text-[11px] text-muted-foreground">{doc.units.length}{t("tpl.unitsUnit")} ・ {totalPeriods}{t("tpl.periodsUnit")}</span>}
              </div>
              <div className="max-h-56 overflow-y-auto p-3 text-xs">
                {matches.length === 0 ? (
                  <p className="text-muted-foreground py-4 text-center">{t("tpl.noMatch")}</p>
                ) : loadingDoc || !doc ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-4"><Loader2 size={14} className="animate-spin" />{t("tpl.loading")}</div>
                ) : (
                  <div className="space-y-2.5">
                    {doc.units.map((u, ui) => (
                      <div key={ui}>
                        <p className="font-bold text-foreground">{u.name} <span className="font-normal text-muted-foreground">({u.lessons.length})</span></p>
                        <ol className="mt-0.5 ml-1 space-y-0.5">
                          {u.lessons.map((l, li) => (
                            <li key={li} className="text-muted-foreground flex gap-1.5">
                              <span className="text-muted-foreground/50 tabular-nums">{li + 1}.</span>{l}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {doc?.note && (
                <div className="bg-amber-50 border-t border-amber-200 px-3 py-2 text-[11px] text-amber-700 flex gap-1.5">
                  <Info size={13} className="shrink-0 mt-0.5" />{doc.note}
                </div>
              )}
            </div>

            {/* 適用方法 */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold">{t("tpl.applyMode")}</p>
              <div className="grid grid-cols-1 gap-1.5">
                {([
                  { v: "fillEmpty", label: t("tpl.modeFill"), desc: t("tpl.modeFillDesc") },
                  { v: "replaceUnits", label: t("tpl.modeUnits"), desc: t("tpl.modeUnitsDesc") },
                  { v: "replaceAll", label: t("tpl.modeAll"), desc: t("tpl.modeAllDesc") },
                ] as const).map((m) => (
                  <label key={m.v}
                    className={cn(
                      "flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all",
                      mode === m.v ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    )}>
                    <input type="radio" name="tplmode" className="mt-1 accent-primary"
                      checked={mode === m.v} onChange={() => setMode(m.v)} />
                    <div>
                      <p className="text-sm font-medium">{m.label}{m.v === "fillEmpty" && <span className="ml-1.5 text-[10px] text-primary">（{t("tpl.recommended")}）</span>}</p>
                      <p className="text-[11px] text-muted-foreground">{m.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
              {!hasExistingContent && mode !== "replaceAll" && (
                <p className="text-[11px] text-muted-foreground">{t("tpl.emptyHint")}</p>
              )}
            </div>

            {/* 拡張パッケージ管理 */}
            {extPacks.length > 0 && (
              <div className="border border-dashed border-border rounded-lg p-3 space-y-1.5">
                <p className="text-[11px] font-semibold text-muted-foreground">{t("tpl.installedPacks")}</p>
                {extPacks.map((pk) => (
                  <div key={pk.packId} className="flex items-center justify-between">
                    <span className="text-xs text-foreground">{pk.name} <span className="text-muted-foreground">({pk.templates.length}件)</span></span>
                    <button
                      onClick={() => handleRemovePack(pk.packId)}
                      className="text-muted-foreground hover:text-destructive p-1 rounded"
                      title={t("tpl.removePack")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* フッター */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>{t("tpl.cancel")}</Button>
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground"
                  onClick={() => fileRef.current?.click()}>
                  <Upload size={13} />{t("tpl.importPack")}
                </Button>
                <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImportPack} />
              </div>
              <Button size="sm" className="gap-1.5 bg-primary" disabled={!doc || applying || !target} onClick={handleApply}>
                {applying ? <Loader2 size={13} className="animate-spin" /> : <BookMarked size={13} />}
                {t("tpl.apply")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
