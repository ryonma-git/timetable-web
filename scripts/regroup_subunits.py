#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""既存テンプレートを「小単元＝単元」へ再グルーピングする（原本の再取得不要）。

背景:
  多くのテンプレートは 単元=大単元 / 各コマ内容=小単元(節)名 という構造で保存されている。
  例) 単元「天気の変化」(10コマ) の lessons = [雲と天気, 雲と天気, …, 天気の予想, …]
  大単元は10〜15コマと大きく、学期をまたいでアプリ上の不具合になりやすい。

方針（社会で確立した方式を全教科へ）:
  各単元内で「連続する同一コマ内容」をひとまとまりとし、それを新しい単元にする。
  単元名は 大単元「小単元」 の入れ子表記にして、大単元の文脈を残す。
  → 総時数・コマ内容は一切変えない（並べ替えのみ）。検証はそのまま通る。

安全装置:
  - 総時数が変わる変換は行わない（変わったら中止）。
  - グループが1つしかない単元はそのまま（分割しない）。
  - --min-unit で「この大きさ未満の単元は分割しない」を指定可（既定4コマ）。
    例: 道徳のように 単元=月/コマ=教材 の構造を細切れにしないため。

使い方:
  python3 scripts/regroup_subunits.py --subject 理科            # 対象教科をドライラン
  python3 scripts/regroup_subunits.py --subject 理科 --apply    # 実際に書き換え
  python3 scripts/regroup_subunits.py --id tosho_rika5 --apply  # 単体指定
"""
import argparse
import json
import os
import glob
import re

ROOT = os.path.join(os.path.dirname(__file__), "..")
TPL = os.path.join(ROOT, "client/public/templates/teaching")
MARK = "★再構築"


def groups_of(unit):
    """単元内の lessons を「連続する同一内容」でまとめる → [(内容, コマ数)]"""
    out = []
    for l in unit["lessons"]:
        if not out or out[-1][0] != l:
            out.append([l, 1])
        else:
            out[-1][1] += 1
    return [(n, c) for n, c in out]


def nested_name(big, small):
    """大単元「小単元」。小単元が大単元と同一/空なら大単元のみ。"""
    b = (big or "").strip()
    s = (small or "").strip()
    if not s or s == b:
        return b or s
    # 既に入れ子になっているものは触らない
    if "「" in b and b.endswith("」"):
        return b
    return f"{b}「{s}」" if b else s


def looks_like_section_names(doc, max_name=32, min_avg=3.0):
    """コマ内容が『節名』か『各時の学習活動の記述』かを判定する。

    節名なら分割して小単元にできる（東書/教育出版タイプ）。
    学習活動の記述だと1コマ単元が量産されるので分割してはいけない
    （大日本/学校図書/啓林タイプ。小単元を得るには原本の再解析が必要）。
    判定材料: 名前の長さの中央値 と 分割後の平均コマ数。
    """
    names, total, groups = [], 0, 0
    for u in doc["units"]:
        gs = groups_of(u)
        total += len(u["lessons"])
        groups += len(gs)
        names += [n for n, _ in gs]
    if not names or groups == 0:
        return False, "対象なし"
    names_sorted = sorted(len(n) for n in names)
    median_len = names_sorted[len(names_sorted) // 2]
    avg = total / groups
    if median_len > max_name:
        return False, f"コマ内容が長文(中央値{median_len}字)=学習活動の記述"
    if avg < min_avg:
        return False, f"分割後が細かすぎ(平均{avg:.1f}コマ)"
    return True, f"節名らしい(中央値{median_len}字/平均{avg:.1f}コマ)"


def regroup_doc(doc, min_unit=4):
    """doc の units を小単元基準へ。戻り: (新units, 変更したか)"""
    new_units = []
    changed = False
    for u in doc["units"]:
        gs = groups_of(u)
        # 分割しない条件: グループが1つ / 単元が小さい
        if len(gs) < 2 or len(u["lessons"]) < min_unit:
            new_units.append(u)
            continue
        for name, cnt in gs:
            nm = nested_name(u["name"], name)
            new_units.append({"name": nm, "lessons": [nm] * cnt})
        changed = True
    return new_units, changed


def process(path, min_unit, apply_, force=False):
    doc = json.load(open(path, encoding="utf-8"))
    if doc.get("sourceKind") != "publisher":
        return None
    before_periods = sum(len(u["lessons"]) for u in doc["units"])
    before_units = len(doc["units"])
    ok, why = looks_like_section_names(doc)
    if not ok and not force:
        return ("GUARD", os.path.basename(path), why, 0)
    new_units, changed = regroup_doc(doc, min_unit)
    after_periods = sum(len(u["lessons"]) for u in new_units)
    if after_periods != before_periods:
        return ("ERROR", os.path.basename(path), before_periods, after_periods)
    if not changed:
        return ("SKIP", os.path.basename(path), before_units, before_units)
    if apply_:
        doc["units"] = new_units
        note = (doc.get("note") or "").split(MARK)[0].rstrip()
        doc["note"] = (
            note + f"{MARK}: 小単元(節)を単元の基準にし、単元名を『大単元「小単元」』の入れ子表記へ"
            "（学期跨ぎ低減・大単元の文脈保持）。総時数・コマ内容は不変。"
        )
        json.dump(doc, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return ("OK", os.path.basename(path), before_units, len(new_units))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--subject", help="対象教科（例: 理科）")
    ap.add_argument("--id", help="対象テンプレートid（例: tosho_rika5）")
    ap.add_argument("--min-unit", type=int, default=4, help="この未満のコマ数の単元は分割しない")
    ap.add_argument("--apply", action="store_true", help="実際に書き換える")
    ap.add_argument("--force", action="store_true", help="安全装置を無視して分割する")
    args = ap.parse_args()

    targets = []
    for f in sorted(glob.glob(os.path.join(TPL, "*.json"))):
        if os.path.basename(f) == "index.json":
            continue
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        if d.get("sourceKind") != "publisher":
            continue
        if args.id and d.get("id") != args.id:
            continue
        if args.subject and d.get("subject") != args.subject:
            continue
        targets.append(f)

    print(f"対象 {len(targets)} 件  min-unit={args.min_unit}  {'[適用]' if args.apply else '[ドライラン]'}")
    stats = {"OK": 0, "SKIP": 0, "ERROR": 0, "GUARD": 0}
    for f in targets:
        r = process(f, args.min_unit, args.apply, args.force)
        if not r:
            continue
        kind, name, a, b = r
        stats[kind] += 1
        if kind == "OK":
            print(f"  ✓ {name:28} {a:3}単元 → {b:3}単元")
        elif kind == "ERROR":
            print(f"  ✗ {name:28} 時数不一致 {a} → {b}（中止）")
        elif kind == "GUARD":
            print(f"  – {name:28} 見送り: {a}")
    print(f"\n変更 {stats['OK']} / 変更なし {stats['SKIP']} / 見送り {stats['GUARD']} / エラー {stats['ERROR']}")
    if args.apply and stats["OK"]:
        # index.json の units/periods を実体に同期
        idx_path = os.path.join(TPL, "index.json")
        idx = json.load(open(idx_path, encoding="utf-8"))
        fixed = 0
        for t in idx["templates"]:
            p = os.path.join(TPL, t.get("file", ""))
            if not os.path.exists(p):
                continue
            d = json.load(open(p, encoding="utf-8"))
            u, per = len(d["units"]), sum(len(x["lessons"]) for x in d["units"])
            if t.get("units") != u or t.get("periods") != per:
                t["units"], t["periods"] = u, per
                fixed += 1
        if fixed:
            json.dump(idx, open(idx_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            print(f"index.json を同期: {fixed} 件")


if __name__ == "__main__":
    main()
