/**
 * timetable.ts リグレッションテスト
 *
 * 対象: buildSwapOps の subject: undefined→null 修正（v33）が
 * 他の機能に意図しない影響を与えていないかを検証する。
 *
 * テスト対象関数:
 *   - buildSwapOps       （今回修正）
 *   - buildMoveOps       （類似パターン確認）
 *   - buildAddOp         （subject ?? undefined パターン確認）
 *   - buildDeleteOp      （clear_period_class 確認）
 *   - buildSetSubjectOp  （明示的 subject 渡し確認）
 *   - applyOverrides     （エンジン本体）
 */

import { describe, it, expect } from "vitest";
import {
  applyOverrides,
  buildSwapOps,
  buildMoveOps,
  buildAddOp,
  buildDeleteOp,
  buildSetSubjectOp,
  TimetableEntry,
} from "../timetable";

// ─── テスト用ベースエントリ生成 ────────────────────────────────────

function makeEntry(date: string, slots: Array<{ period: number; cls: string | null; subject?: string | null }>): TimetableEntry {
  return {
    date,
    weekday: "Mon",
    weekday_jp: "月",
    periods: slots.map(s => ({
      period: s.period,
      class: s.cls,
      subject: s.subject ?? undefined,
    })),
  };
}

function getSlot(entries: TimetableEntry[], date: string, period: number) {
  const entry = entries.find(e => e.date === date);
  return entry?.periods.find(p => p.period === period);
}

// ─── buildSwapOps テスト ────────────────────────────────────────────

describe("buildSwapOps", () => {
  // ケース1: 授業あり（教科あり） ↔ 空きコマ の交換（今回のバグ修正箇所）
  it("授業あり(教科あり) ↔ 空きコマ: 交換後に移動元の教科がnullになること", () => {
    const base = [
      makeEntry("2026-04-07", [
        { period: 1, cls: "1年1組", subject: "理科" }, // 授業あり
        { period: 2, cls: null, subject: undefined },   // 空きコマ
      ]),
    ];
    const ops = buildSwapOps(
      "2026-04-07", 1, "1年1組",   // src: 授業あり（理科）
      "2026-04-07", 2, null,        // dst: 空きコマ
      undefined,
      "理科",   // srcSubject
      null,     // dstSubject（空きコマ）
    );
    const { effective } = applyOverrides(base, ops);

    const slot1 = getSlot(effective, "2026-04-07", 1);
    const slot2 = getSlot(effective, "2026-04-07", 2);

    // 移動元（period 1）: 空きコマになること
    expect(slot1?.class).toBeNull();
    expect(slot1?.subject).toBeNull(); // ← v33修正の核心: undefinedではなくnullになること

    // 移動先（period 2）: 授業あり（理科）になること
    expect(slot2?.class).toBe("1年1組");
    expect(slot2?.subject).toBe("理科");
  });

  // ケース2: 授業あり（教科あり） ↔ 授業あり（教科あり） の交換
  it("授業あり(教科A) ↔ 授業あり(教科B): 教科が正しく入れ替わること", () => {
    const base = [
      makeEntry("2026-04-07", [
        { period: 1, cls: "1年1組", subject: "理科" },
        { period: 2, cls: "2年1組", subject: "数学" },
      ]),
    ];
    const ops = buildSwapOps(
      "2026-04-07", 1, "1年1組",
      "2026-04-07", 2, "2年1組",
      undefined,
      "理科",
      "数学",
    );
    const { effective } = applyOverrides(base, ops);

    const slot1 = getSlot(effective, "2026-04-07", 1);
    const slot2 = getSlot(effective, "2026-04-07", 2);

    expect(slot1?.class).toBe("2年1組");
    expect(slot1?.subject).toBe("数学");
    expect(slot2?.class).toBe("1年1組");
    expect(slot2?.subject).toBe("理科");
  });

  // ケース3: 授業あり（教科なし） ↔ 空きコマ の交換（single_subjectモードの典型）
  it("授業あり(教科なし) ↔ 空きコマ: 交換後に移動元がnullになること", () => {
    const base = [
      makeEntry("2026-04-07", [
        { period: 1, cls: "1年1組", subject: undefined }, // 教科なし
        { period: 2, cls: null, subject: undefined },      // 空きコマ
      ]),
    ];
    const ops = buildSwapOps(
      "2026-04-07", 1, "1年1組",
      "2026-04-07", 2, null,
      undefined,
      null,  // srcSubject（教科なし）
      null,  // dstSubject（空きコマ）
    );
    const { effective } = applyOverrides(base, ops);

    const slot1 = getSlot(effective, "2026-04-07", 1);
    const slot2 = getSlot(effective, "2026-04-07", 2);

    expect(slot1?.class).toBeNull();
    expect(slot1?.subject).toBeNull();
    expect(slot2?.class).toBe("1年1組");
    expect(slot2?.subject).toBeNull();
  });

  // ケース4: 空きコマ ↔ 空きコマ の交換（変化なし）
  it("空きコマ ↔ 空きコマ: どちらも空きコマのままであること", () => {
    const base = [
      makeEntry("2026-04-07", [
        { period: 1, cls: null },
        { period: 2, cls: null },
      ]),
    ];
    const ops = buildSwapOps(
      "2026-04-07", 1, null,
      "2026-04-07", 2, null,
      undefined,
      null,
      null,
    );
    const { effective } = applyOverrides(base, ops);

    const slot1 = getSlot(effective, "2026-04-07", 1);
    const slot2 = getSlot(effective, "2026-04-07", 2);

    expect(slot1?.class).toBeNull();
    expect(slot2?.class).toBeNull();
  });

  // ケース5: 異なる日付間の交換
  it("異なる日付間の交換: 両日付のコマが正しく入れ替わること", () => {
    const base = [
      makeEntry("2026-04-07", [{ period: 1, cls: "1年1組", subject: "理科" }]),
      makeEntry("2026-04-08", [{ period: 1, cls: null }]),
    ];
    const ops = buildSwapOps(
      "2026-04-07", 1, "1年1組",
      "2026-04-08", 1, null,
      undefined,
      "理科",
      null,
    );
    const { effective } = applyOverrides(base, ops);

    expect(getSlot(effective, "2026-04-07", 1)?.class).toBeNull();
    expect(getSlot(effective, "2026-04-07", 1)?.subject).toBeNull();
    expect(getSlot(effective, "2026-04-08", 1)?.class).toBe("1年1組");
    expect(getSlot(effective, "2026-04-08", 1)?.subject).toBe("理科");
  });

  // ケース6: multi_subjectモード（複数教科）の交換
  it("multi_subjectモード: 異なる教科同士の交換が正しく動作すること", () => {
    const base = [
      makeEntry("2026-04-07", [
        { period: 1, cls: "1年1組", subject: "国語" },
        { period: 2, cls: "1年1組", subject: "算数" },
      ]),
    ];
    const ops = buildSwapOps(
      "2026-04-07", 1, "1年1組",
      "2026-04-07", 2, "1年1組",
      undefined,
      "国語",
      "算数",
    );
    const { effective } = applyOverrides(base, ops);

    expect(getSlot(effective, "2026-04-07", 1)?.subject).toBe("算数");
    expect(getSlot(effective, "2026-04-07", 2)?.subject).toBe("国語");
  });
});

// ─── buildMoveOps テスト ────────────────────────────────────────────

describe("buildMoveOps", () => {
  // ケース7: 移動（src→dst、srcは空きコマに）
  it("移動: srcが空きコマになり、dstに授業が移ること", () => {
    const base = [
      makeEntry("2026-04-07", [
        { period: 1, cls: "1年1組", subject: "理科" },
        { period: 2, cls: null },
      ]),
    ];
    const ops = buildMoveOps(
      "2026-04-07", 1, "1年1組",
      "2026-04-07", 2, null,
      undefined,
      "理科",
    );
    const { effective } = applyOverrides(base, ops);

    // src: clear_period_classなのでclass・subjectともにnull
    expect(getSlot(effective, "2026-04-07", 1)?.class).toBeNull();
    expect(getSlot(effective, "2026-04-07", 1)?.subject).toBeNull();

    // dst: 移動先に授業が入る
    expect(getSlot(effective, "2026-04-07", 2)?.class).toBe("1年1組");
    expect(getSlot(effective, "2026-04-07", 2)?.subject).toBe("理科");
  });

  // ケース8: 移動（教科なし）
  it("移動(教科なし): srcが空きコマになり、dstに授業(教科なし)が移ること", () => {
    const base = [
      makeEntry("2026-04-07", [
        { period: 1, cls: "2年1組", subject: undefined },
        { period: 2, cls: null },
      ]),
    ];
    const ops = buildMoveOps(
      "2026-04-07", 1, "2年1組",
      "2026-04-07", 2, null,
      undefined,
      undefined, // srcSubject未指定（single_subjectモード）
    );
    const { effective } = applyOverrides(base, ops);

    expect(getSlot(effective, "2026-04-07", 1)?.class).toBeNull();
    // clear_period_classはsubjectをnullにする
    expect(getSlot(effective, "2026-04-07", 1)?.subject).toBeNull();

    expect(getSlot(effective, "2026-04-07", 2)?.class).toBe("2年1組");
    // srcSubject=undefinedの場合、dstのsubjectは元の値を保持（set_period_classのskip動作）
    // これはbuildMoveOpsの意図的な動作（dstの既存subjectを上書きしない）
  });
});

// ─── buildAddOp テスト ─────────────────────────────────────────────

describe("buildAddOp", () => {
  // ケース9: 新規追加（教科あり）
  it("新規追加(教科あり): classとsubjectが正しく設定されること", () => {
    const base = [
      makeEntry("2026-04-07", [{ period: 1, cls: null }]),
    ];
    const ops = [buildAddOp("2026-04-07", 1, "3年1組", undefined, "社会")];
    const { effective } = applyOverrides(base, ops);

    expect(getSlot(effective, "2026-04-07", 1)?.class).toBe("3年1組");
    expect(getSlot(effective, "2026-04-07", 1)?.subject).toBe("社会");
  });

  // ケース10: 新規追加（教科なし）- subject未指定でも既存subjectを上書きしない
  it("新規追加(教科なし): classのみ設定され、既存subjectは保持されること", () => {
    const base = [
      makeEntry("2026-04-07", [{ period: 1, cls: null, subject: "理科" }]),
    ];
    // subject未指定（undefined）でaddOp
    const ops = [buildAddOp("2026-04-07", 1, "4年1組")];
    const { effective } = applyOverrides(base, ops);

    expect(getSlot(effective, "2026-04-07", 1)?.class).toBe("4年1組");
    // subject=undefinedのop → applyOverridesでスキップ → 既存の"理科"が保持される（意図的動作）
    expect(getSlot(effective, "2026-04-07", 1)?.subject).toBe("理科");
  });
});

// ─── buildDeleteOp テスト ──────────────────────────────────────────

describe("buildDeleteOp", () => {
  // ケース11: 削除（clear_period_class）でsubjectもnullになること
  it("削除: classとsubjectがともにnullになること", () => {
    const base = [
      makeEntry("2026-04-07", [{ period: 1, cls: "5年1組", subject: "体育" }]),
    ];
    const ops = [buildDeleteOp("2026-04-07", 1, "5年1組")];
    const { effective } = applyOverrides(base, ops);

    expect(getSlot(effective, "2026-04-07", 1)?.class).toBeNull();
    expect(getSlot(effective, "2026-04-07", 1)?.subject).toBeNull();
  });
});

// ─── buildSetSubjectOp テスト ─────────────────────────────────────

describe("buildSetSubjectOp", () => {
  // ケース12: 教科のみ変更
  it("教科のみ変更: classは変わらずsubjectのみ更新されること", () => {
    const base = [
      makeEntry("2026-04-07", [{ period: 1, cls: "6年1組", subject: "国語" }]),
    ];
    const ops = [buildSetSubjectOp("2026-04-07", 1, "6年1組", "算数")];
    const { effective } = applyOverrides(base, ops);

    expect(getSlot(effective, "2026-04-07", 1)?.class).toBe("6年1組");
    expect(getSlot(effective, "2026-04-07", 1)?.subject).toBe("算数");
  });

  // ケース13: 教科をnullに変更（教科削除）
  it("教科削除: subjectがnullになること", () => {
    const base = [
      makeEntry("2026-04-07", [{ period: 1, cls: "6年1組", subject: "国語" }]),
    ];
    const ops = [buildSetSubjectOp("2026-04-07", 1, "6年1組", null)];
    const { effective } = applyOverrides(base, ops);

    expect(getSlot(effective, "2026-04-07", 1)?.class).toBe("6年1組");
    expect(getSlot(effective, "2026-04-07", 1)?.subject).toBeNull();
  });
});

// ─── applyOverrides エンジン本体テスト ────────────────────────────

describe("applyOverrides エンジン", () => {
  // ケース14: 複数opの連続適用（swap後にsetSubject）
  it("連続op: swap後にsetSubjectを適用しても正しく動作すること", () => {
    const base = [
      makeEntry("2026-04-07", [
        { period: 1, cls: "1年1組", subject: "理科" },
        { period: 2, cls: null },
      ]),
    ];
    const swapOps = buildSwapOps(
      "2026-04-07", 1, "1年1組",
      "2026-04-07", 2, null,
      undefined, "理科", null,
    );
    const setSubjectOp = buildSetSubjectOp("2026-04-07", 2, "1年1組", "算数");
    const { effective } = applyOverrides(base, [...swapOps, setSubjectOp]);

    // swap後: period1=空き、period2=1年1組(理科)
    // setSubject後: period2=1年1組(算数)
    expect(getSlot(effective, "2026-04-07", 1)?.class).toBeNull();
    expect(getSlot(effective, "2026-04-07", 1)?.subject).toBeNull();
    expect(getSlot(effective, "2026-04-07", 2)?.class).toBe("1年1組");
    expect(getSlot(effective, "2026-04-07", 2)?.subject).toBe("算数");
  });

  // ケース15: 存在しない日付のopは警告auditが出てスキップされること
  it("存在しない日付のop: auditにwarnが記録されてスキップされること", () => {
    const base = [
      makeEntry("2026-04-07", [{ period: 1, cls: "1年1組" }]),
    ];
    // 存在しない日付「2026-04-99」のみのopを作成
    const ops = [{
      id: "test-op-1",
      op: "set_period_class" as const,
      date: "2026-04-99", // 存在しない日付
      period: 1,
      class: null,
      subject: null,
    }];
    const { effective, audit } = applyOverrides(base, ops);

    // 存在しない日付のopはスキップ（warnが出る）
    expect(audit.some(a => a.level === "warn" && a.date === "2026-04-99")).toBe(true);
    // 存在する日付（2026-04-07）のコマは変化しない
    expect(getSlot(effective, "2026-04-07", 1)?.class).toBe("1年1組");
  });

  // ケース16: opsが空の場合はbaseと同じ結果になること
  it("空のops: baseと同じ結果になること", () => {
    const base = [
      makeEntry("2026-04-07", [{ period: 1, cls: "1年1組", subject: "理科" }]),
    ];
    const { effective } = applyOverrides(base, []);

    expect(getSlot(effective, "2026-04-07", 1)?.class).toBe("1年1組");
    expect(getSlot(effective, "2026-04-07", 1)?.subject).toBe("理科");
  });

  // ケース17: homeroomモード相当（subjectのみ設定、classは固定）
  it("homeroomモード相当: 同じclassでsubjectのみ変わる交換が正しく動作すること", () => {
    const base = [
      makeEntry("2026-04-07", [
        { period: 1, cls: "3年2組", subject: "国語" },
        { period: 2, cls: "3年2組", subject: "算数" },
      ]),
    ];
    const ops = buildSwapOps(
      "2026-04-07", 1, "3年2組",
      "2026-04-07", 2, "3年2組",
      undefined,
      "国語",
      "算数",
    );
    const { effective } = applyOverrides(base, ops);

    expect(getSlot(effective, "2026-04-07", 1)?.class).toBe("3年2組");
    expect(getSlot(effective, "2026-04-07", 1)?.subject).toBe("算数");
    expect(getSlot(effective, "2026-04-07", 2)?.class).toBe("3年2組");
    expect(getSlot(effective, "2026-04-07", 2)?.subject).toBe("国語");
  });
});
