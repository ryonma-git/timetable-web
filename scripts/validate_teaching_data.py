#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""指導計画データの整合性バリデータ。

検査項目:
  [FAIL] index.json のエントリが指すファイルが存在しない / JSONとして壊れている
  [FAIL] index の units / periods がテンプレ実体と不一致（過去に三省堂で発生）
  [FAIL] index 内の id 重複、entry.id とファイル内 doc.id の不一致
  [FAIL] MANIFEST.json の path が存在しない / sha256 が実ファイルと不一致
  [WARN] テンプレディレクトリの孤児ファイル（index から参照されていない）
  [WARN] 標準時数から+25%超の過大（読取ミス疑い）/ builtin(std_)の法定時数未達
  [WARN] MANIFEST の templateIds が index に存在しない

使い方:
  python3 scripts/validate_teaching_data.py          # 検査のみ（FAILがあれば exit 1）
  python3 scripts/validate_teaching_data.py --fix    # index の units/periods を実体に同期
"""
import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import refresh_teaching_plans as rtp

TPL = rtp.TPL_DIR
INDEX = rtp.INDEX
MANIFEST = os.path.join(rtp.ROOT, "sources", "teaching-plans", "MANIFEST.json")
IGNORE = {"index.json", "extension-pack-sample.json"}

fails, warns = [], []


def fail(msg):
    fails.append(msg)


def warn(msg):
    warns.append(msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fix", action="store_true", help="indexのunits/periodsを実体に同期")
    args = ap.parse_args()

    idx = rtp.load_json(INDEX)
    if not idx:
        fail(f"index.json が読めない: {INDEX}")
        report_and_exit()

    # --- index ↔ 実体 ---
    seen_ids = set()
    referenced = set()
    fixed = 0
    for t in idx.get("templates", []):
        tid = t.get("id")
        if tid in seen_ids:
            fail(f"id重複: {tid}")
        seen_ids.add(tid)
        f = t.get("file")
        if not f:
            if t.get("sourceKind") != "extension":
                fail(f"{tid}: file 未設定")
            continue
        referenced.add(f)
        p = os.path.join(TPL, f)
        if not os.path.exists(p):
            fail(f"{tid}: ファイルが存在しない → {f}")
            continue
        try:
            doc = json.load(open(p, encoding="utf-8"))
        except Exception as e:
            fail(f"{tid}: JSON破損 → {f} ({e})")
            continue
        if doc.get("id") != tid:
            fail(f"{tid}: ファイル内 id と不一致 (doc.id={doc.get('id')})")
        units = len(doc.get("units", []))
        periods = sum(len(u.get("lessons", [])) for u in doc.get("units", []))
        if t.get("units") != units or t.get("periods") != periods:
            if args.fix:
                t["units"], t["periods"] = units, periods
                fixed += 1
            else:
                fail(f"{tid}: index({t.get('units')}単元/{t.get('periods')}時) ≠ 実体({units}/{periods})"
                     "  ※ --fix で同期可")
        for gk in ("grade", "subject", "source"):
            if not t.get(gk):
                fail(f"{tid}: {gk} 未設定")

    # --- 孤児ファイル ---
    for name in sorted(os.listdir(TPL)):
        if not name.endswith(".json") or name in IGNORE:
            continue
        if os.path.isdir(os.path.join(TPL, name)):
            continue
        if name not in referenced:
            warn(f"孤児ファイル（indexから未参照）: {name}")

    # --- 時数（過大＝読取ミス疑い / std_ の法定未達） ---
    inv = rtp.load_inventory()
    for (s, sj, g, p, e, fl) in rtp.validate_hours(inv):
        warn(f"時数過大: {s} {sj}{g} {p}時 (標準{e}) {fl}")
    for t in idx.get("templates", []):
        if t.get("sourceKind") != "builtin":
            continue
        std = rtp.STANDARD.get(t.get("subject"), {})
        g = rtp.grade_int(t.get("grade"))
        if std.get(g) and t.get("periods") and t["periods"] < std[g]:
            warn(f"builtin法定未達: {t['id']} {t['periods']}時 (法定{std[g]}) ※標準テンプレ再整備の対象")

    # --- MANIFEST ---
    man = rtp.load_json(MANIFEST)
    if man:
        for e in man.get("entries", []):
            p = os.path.join(rtp.ROOT, "sources", "teaching-plans", e["path"])
            if not os.path.exists(p):
                fail(f"MANIFEST: 原本が存在しない → {e['path']}")
                continue
            sha = hashlib.sha256(open(p, "rb").read()).hexdigest()[:16]
            if sha != e.get("sha256_16"):
                fail(f"MANIFEST: sha不一致（原本が改変された可能性） → {e['path']}")
            for tid in e.get("templateIds", []):
                if tid not in seen_ids:
                    warn(f"MANIFEST: templateId が index に無い → {tid} ({e['path']})")

    if args.fix and fixed:
        rtp.save_json(INDEX, idx)
        print(f"--fix: index の units/periods を {fixed} 件同期しました")

    report_and_exit()


def report_and_exit():
    for m in fails:
        print(f"  ✗ FAIL {m}")
    for m in warns:
        print(f"  ! WARN {m}")
    print(f"\n結果: FAIL {len(fails)} / WARN {len(warns)}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
