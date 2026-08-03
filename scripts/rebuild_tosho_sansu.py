#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""東京書籍 算数を「小単元＝単元」へ再構築する（細案×略案の突き合わせ）。

構造:
  略案 sansu_keikaku_ryakuan_{g}_*.docx … 大単元名 + 指導時数（表形式）
  細案 sansu_keikaku_saian_{g}_*.docx  … 小単元見出し「(1) 整数と小数 上p.8～13 4時間」+「まとめ … 1時間」

方針:
  文書順に並ぶ 小単元 の時数を、略案の 大単元 の時数に合致するまで足し込み、
  ぴったり一致した組を「その大単元に属する小単元群」とみなす。
  一致しない大単元は分割せずそのまま残す（推測で割り振らない）。
  単元名は 大単元「小単元」 の入れ子表記。総時数は不変。

使い方:
  python3 scripts/rebuild_tosho_sansu.py          # ドライラン
  python3 scripts/rebuild_tosho_sansu.py --apply  # 反映
"""
import argparse
import glob
import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
Z = "０１２３４５６７８９"
ROOT = os.path.join(os.path.dirname(__file__), "..")
TPL = os.path.join(ROOT, "client/public/templates/teaching")
SRC = os.path.join(ROOT, "sources/teaching-plans/小学校/算数/東京書籍")
STD = {1: 136, 2: 175, 3: 175, 4: 175, 5: 175, 6: 175}


def n(s):
    return (s or "").translate(str.maketrans(Z, "0123456789"))


def rows_of(path):
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    out = []
    for tbl in root.iter(f"{NS}tbl"):
        for tr in tbl.findall(f"{NS}tr"):
            out.append(
                [
                    ("".join(x.text or "" for x in tc.iter(f"{NS}t"))).strip().replace("　", " ")
                    for tc in tr.findall(f"{NS}tc")
                ]
            )
    return out


def parse_ryakuan(g):
    """略案から 大単元(名前, 時数) を文書順に。時数が数値の行のみ。"""
    files = glob.glob(os.path.join(SRC, f"sansu_keikaku_ryakuan_{g}_*.docx"))
    if not files:
        return []
    units = []
    for cells in rows_of(files[0]):
        if len(cells) < 4:
            continue
        # 表2/3: [上下巻, 学期, 単元, 指導時数, ページ, 指導内容, 学指]
        name, hrs = cells[2].strip(), n(cells[3]).strip()
        if name and re.fullmatch(r"\d{1,2}", hrs):
            units.append((name, int(hrs)))
    return units


SUB_HDR = re.compile(r"^(?:\((\d+)\)\s*)?(.+?)\s*(?:[上下]?p\.[\d～\-–、,\s]+)?\s*(\d+)\s*時間")


def parse_saian(g):
    """細案から 小単元(名前, 時数) を文書順に（1セルの見出し行）。"""
    files = glob.glob(os.path.join(SRC, f"sansu_keikaku_saian_{g}_*.docx"))
    if not files:
        return []
    subs = []
    for cells in rows_of(files[0]):
        nz = [c for c in cells if c]
        if len(nz) != 1:
            continue
        t = n(nz[0])
        if t.startswith("【発展】") or "毎時の評価規準" in t or "年間指導計画作成資料" in t:
            continue
        m = SUB_HDR.match(t)
        if not m:
            continue
        name = re.sub(r"\s*[上下]?p\..*$", "", m.group(2)).strip()
        name = re.sub(r"★.*$", "", name).strip()
        # 末尾の丸数字（①②…＝細案の内部連番）は表示に不要なので落とす
        name = re.sub(r"[\s　]*[①-⑳]+$", "", name).strip()
        if name:
            subs.append((name, int(m.group(3))))
    return subs


def match_and_build(bigs, subs):
    """大単元列と小単元列を時数で突き合わせ、units を作る。"""
    units, i, matched, unmatched = [], 0, 0, 0
    for bname, bh in bigs:
        # ★☆で始まる補助ページ（学びのとびら/おぼえているかな 等）は細案に対応項目が無い。
        # これらに細案項目を消費させると以降の対応が丸ごとずれるため、最初から除外する。
        if bname.startswith(("★", "☆")):
            units.append({"name": bname, "lessons": [bname] * bh})
            unmatched += 1
            continue
        acc, take = 0, []
        j = i
        while j < len(subs) and acc < bh:
            acc += subs[j][1]
            take.append(subs[j])
            j += 1
        if acc == bh and len(take) >= 1:
            # ぴったり一致 → 小単元に分割（1個だけなら大単元名のまま）
            if len(take) == 1:
                units.append({"name": bname, "lessons": [bname] * bh})
            else:
                for sname, sh in take:
                    nm = f"{bname}「{sname}」"
                    units.append({"name": nm, "lessons": [nm] * sh})
            i = j
            matched += 1
        else:
            # 一致しない → 分割せずそのまま（推測しない）
            units.append({"name": bname, "lessons": [bname] * bh})
            unmatched += 1
    return units, matched, unmatched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    idx_path = os.path.join(TPL, "index.json")
    idx = json.load(open(idx_path, encoding="utf-8"))
    byid = {t["id"]: t for t in idx["templates"]}
    total_changed = 0

    for g in range(1, 7):
        bigs = parse_ryakuan(g)
        subs = parse_saian(g)
        if not bigs or not subs:
            print(f"  {g}年: 原本不足（略案{len(bigs)} 細案{len(subs)}）→ スキップ")
            continue
        units, m, um = match_and_build(bigs, subs)
        tot = sum(len(u["lessons"]) for u in units)
        before = sum(h for _, h in bigs)
        ok = tot == before
        big8 = sum(1 for u in units if len(u["lessons"]) >= 8)
        print(
            f"  {g}年: 大単元{len(bigs)} → {len(units)}単元 {tot}時"
            f"（一致{m}/不一致{um}・8コマ以上{big8}）{'✓' if ok else '✗時数変化'}"
        )
        if not ok:
            continue
        tid = f"tosho_sansu{g}"
        p = os.path.join(TPL, f"{tid}.json")
        if not os.path.exists(p):
            continue
        if args.apply:
            doc = json.load(open(p, encoding="utf-8"))
            doc["units"] = units
            base = (doc.get("note") or "").split("★再構築")[0].rstrip()
            doc["note"] = (
                base
                + "★再構築: 細案(sansu_keikaku_saian)の小単元見出し「(N) 名称 …N時間」を単元の基準にし、"
                "略案の大単元と時数で突き合わせて『大単元「小単元」』の入れ子命名に。"
                "時数が一致しない大単元は分割せず維持（推測しない）。原本は sources/teaching-plans に保管。"
            )
            json.dump(doc, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            if tid in byid:
                byid[tid]["units"] = len(units)
                byid[tid]["periods"] = tot
        total_changed += 1

    if args.apply and total_changed:
        json.dump(idx, open(idx_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"\nindex.json 同期・{total_changed}学年を更新")


if __name__ == "__main__":
    main()
