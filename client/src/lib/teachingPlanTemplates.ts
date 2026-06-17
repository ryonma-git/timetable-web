// 指導計画テンプレート（内蔵カタログ）の取得と適用
// 設計: docs/teaching-plan-import-design.md（P1）
//
// public/templates/teaching/index.json  … 一覧（軽量・最初に取得）
// public/templates/teaching/<id>.json    … テンプレ本体（選択時に遅延ロード）
//
// テンプレ本体は { units: [{ name, lessons: string[] }] } のコンパクト形式。
// 適用時に既存の GradeSubjectPlan（units[] + lessons[]）へ展開・マージする。

import type { GradeSubjectPlan, TeachingUnit, LessonPlanEntry } from "./timetableFile";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DIR = `${BASE}/templates/teaching`;

export interface TemplateIndexEntry {
  id: string;
  source: string;
  grade: string;
  subject: string;
  year?: string;
  edition?: string;
  units: number;
  periods: number;
  file: string;
  sourceKind?: "builtin" | "publisher" | "extension";
}

export interface TemplateIndex {
  version: number;
  sources: { id: string; name: string; kind: string }[];
  templates: TemplateIndexEntry[];
}

export interface TemplateDoc {
  id: string;
  source: string;
  sourceKind: "builtin" | "imported" | "extension";
  grade: string;
  subject: string;
  year?: string;
  edition?: string;
  note?: string;
  units: { name: string; lessons: string[] }[];
}

// ─── 拡張パッケージ（ローカルストレージ） ──────────────────────────

export interface ExtensionPack {
  packId: string;
  name: string;
  importedAt: string;
  templates: TemplateDoc[];
}

const EXT_KEY = "tp-ext-packs";

export function getExtensionPacks(): ExtensionPack[] {
  try {
    const raw = localStorage.getItem(EXT_KEY);
    return raw ? (JSON.parse(raw) as ExtensionPack[]) : [];
  } catch {
    return [];
  }
}

export function saveExtensionPack(pack: ExtensionPack): void {
  const packs = getExtensionPacks().filter((p) => p.packId !== pack.packId);
  packs.push(pack);
  localStorage.setItem(EXT_KEY, JSON.stringify(packs));
}

export function removeExtensionPack(packId: string): void {
  const packs = getExtensionPacks().filter((p) => p.packId !== packId);
  localStorage.setItem(EXT_KEY, JSON.stringify(packs));
}

export function getExtensionTemplateDoc(templateId: string): TemplateDoc | null {
  for (const pack of getExtensionPacks()) {
    const doc = pack.templates.find((t) => t.id === templateId);
    if (doc) return doc;
  }
  return null;
}

export function extensionPacksAsIndexEntries(): TemplateIndexEntry[] {
  const entries: TemplateIndexEntry[] = [];
  for (const pack of getExtensionPacks()) {
    for (const doc of pack.templates) {
      entries.push({
        id: doc.id,
        source: doc.source,
        grade: doc.grade,
        subject: doc.subject,
        edition: doc.edition,
        units: doc.units.length,
        periods: doc.units.reduce((s, u) => s + u.lessons.length, 0),
        file: "",
        sourceKind: "extension",
      });
    }
  }
  return entries;
}

export type ApplyMode = "fillEmpty" | "replaceUnits" | "replaceAll";

function genId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ─── 取得 ────────────────────────────────────────────────────

export async function fetchTemplateIndex(): Promise<TemplateIndex> {
  const res = await fetch(`${DIR}/index.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`テンプレ一覧の取得に失敗しました (HTTP ${res.status})`);
  return res.json();
}

export async function fetchTemplateDoc(entry: TemplateIndexEntry): Promise<TemplateDoc> {
  const res = await fetch(`${DIR}/${entry.file}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`テンプレ本体の取得に失敗しました (HTTP ${res.status})`);
  return res.json();
}

// テンプレを「フラットな計画」（units + lessons）へ展開
function expand(doc: TemplateDoc): { units: TeachingUnit[]; lessons: LessonPlanEntry[] } {
  const units: TeachingUnit[] = [];
  const lessons: LessonPlanEntry[] = [];
  for (const u of doc.units) {
    const uid = genId();
    units.push({ id: uid, name: u.name, plannedPeriods: u.lessons.length });
    u.lessons.forEach((content, i) => {
      lessons.push({ id: genId(), unitId: uid, unitPeriod: i + 1, content });
    });
  }
  return { units, lessons };
}

// ─── 適用（既存計画へのマージ）─────────────────────────────────

export function applyTemplate(
  existing: GradeSubjectPlan | null,
  doc: TemplateDoc,
  mode: ApplyMode,
  target: { id: string; grade: string; subject: string }
): GradeSubjectPlan {
  const expanded = expand(doc);
  const base: GradeSubjectPlan = existing ?? {
    id: target.id, grade: target.grade, subject: target.subject, units: [], lessons: [],
  };

  if (mode === "replaceAll" || base.lessons.length === 0) {
    // 全置換（または既存が空）→ テンプレで丸ごと作る
    return { id: base.id, grade: base.grade, subject: base.subject, ...expanded };
  }

  if (mode === "replaceUnits") {
    // 単元（名前・コマ数・色）はテンプレ構成に置き換え。
    // 各コマの content（手入力）は位置対応で温存する。
    const lessons = expanded.lessons.map((l, i) => {
      const prev = base.lessons[i];
      return {
        ...l,
        content: prev?.content ? prev.content : l.content,
        ...(prev?.notes ? { notes: prev.notes } : {}),
        ...(prev?.classOverrides ? { classOverrides: prev.classOverrides } : {}),
        ...(prev?.id ? { id: prev.id } : {}),
      };
    });
    return { id: base.id, grade: base.grade, subject: base.subject, units: expanded.units, lessons };
  }

  // fillEmpty: 既存の空いているコマ（content未入力）だけテンプレ内容で補完。
  // 既存より行が足りなければテンプレ分を末尾に追加。単元割当が空の行も補う。
  const units: TeachingUnit[] = [...base.units];
  const unitByName = new Map(units.map((u) => [u.name, u]));
  const ensureUnit = (name: string): string => {
    const ex = unitByName.get(name);
    if (ex) return ex.id;
    const nu: TeachingUnit = { id: genId(), name, plannedPeriods: 0 };
    units.push(nu);
    unitByName.set(name, nu);
    return nu.id;
  };
  // テンプレ各コマに対応する単元名を引く
  const tmplUnitNameByLessonIdx: string[] = [];
  doc.units.forEach((u) => u.lessons.forEach(() => tmplUnitNameByLessonIdx.push(u.name)));

  const lessons: LessonPlanEntry[] = base.lessons.map((l, i) => {
    if (l.content && l.content.trim()) return l; // 既に入力済みは温存
    const tmplContent = expanded.lessons[i]?.content;
    if (!tmplContent) return l;
    const unitName = tmplUnitNameByLessonIdx[i];
    const unitId = l.unitId || (unitName ? ensureUnit(unitName) : "");
    return { ...l, content: tmplContent, unitId };
  });
  // テンプレの方が長い分は追記
  for (let i = base.lessons.length; i < expanded.lessons.length; i++) {
    const unitName = tmplUnitNameByLessonIdx[i];
    const unitId = unitName ? ensureUnit(unitName) : "";
    lessons.push({ id: genId(), unitId, unitPeriod: lessons.length + 1, content: expanded.lessons[i].content });
  }
  // plannedPeriods を実コマ数で更新
  for (const u of units) {
    u.plannedPeriods = lessons.filter((l) => l.unitId === u.id).length || u.plannedPeriods;
  }
  return { id: base.id, grade: base.grade, subject: base.subject, units, lessons };
}
