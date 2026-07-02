#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""年間指導計画の一次ソースを一括ダウンロードして保管庫へ格納・台帳登録する。

- URL源: DRIVER + docs/teaching-plan-source-urls.json（refresh_teaching_plans と共有）
- 保存先: sources/teaching-plans/<校種>/<教科>/<発行者>/<ファイル名>
- 台帳:   sources/teaching-plans/MANIFEST.json（sha256・URL・対応テンプレIDを登録）

同一URLを複数学年が共有する場合（例: 大修館 3・4年=1ファイル）は1回だけ取得し、
grades をまとめて1エントリにする。HTMLが返る・空などの失敗はエラーとして列挙し、
exit code 1 で終える（改訂チェックの土台を静かに欠けさせない）。

使い方: python3 scripts/archive_sources.py [--only 発行者/教科]
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import zipfile
import io

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import refresh_teaching_plans as rtp  # DRIVER / curl_fetch / レジストリを共有

ARC = os.path.join(rtp.ROOT, "sources", "teaching-plans")
MANIFEST = os.path.join(ARC, "MANIFEST.json")


def sniff_ext(b: bytes) -> str:
    """マジックバイトから拡張子を推定（クエリ付きURL等でファイル名が取れない場合用）。"""
    if b[:4] == b"%PDF":
        return ".pdf"
    if b[:2] == b"PK":  # OOXML: 中身で docx / xlsx を判別
        try:
            names = zipfile.ZipFile(io.BytesIO(b)).namelist()
            if any(n.startswith("word/") for n in names):
                return ".docx"
            if any(n.startswith("xl/") for n in names):
                return ".xlsx"
        except Exception:
            pass
        return ".zip"
    if b[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return ".doc"  # 旧OLE (doc/xls)
    return ".bin"


def filename_for(url: str, body: bytes, publisher: str, subject: str, grades) -> str:
    base = os.path.basename(url.split("?")[0])
    if base and "." in base:
        return base
    # クエリ型URL（taishukan ?act=word&id=497 等）: 意味の分かる名前を合成
    q = re.sub(r"[^0-9A-Za-z]+", "_", url.split("?")[1] if "?" in url else "file").strip("_")
    g = "・".join(str(x) for x in grades)
    return f"{publisher}_{subject}_{g}年_{q}{sniff_ext(body)}"


def template_ids_for(inv, source, subject, grades):
    ids = []
    for t in inv.get((source, subject), []):
        if rtp.grade_int(t.get("grade")) in grades:
            ids.append(t["id"])
    return sorted(set(ids))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="'発行者/教科' で対象を絞る")
    args = ap.parse_args()
    rtp._merge_url_registry()
    inv = rtp.load_inventory()

    man = rtp.load_json(MANIFEST, {"description": "指導計画テンプレートの一次ソース(配布元の原本)。", "entries": []})
    by_path = {e["path"]: e for e in man["entries"]}
    ok = fail = skip = 0
    failures = []

    for d in rtp.DRIVER:
        key = f"{d['source']}/{d['subject']}"
        if args.only and key != args.only:
            continue
        urls = d.get("urls")
        if not urls:
            continue
        level = d.get("level", "小学校")
        # 同一URLの学年をまとめる
        by_url = {}
        for g, u in urls.items():
            by_url.setdefault(u, []).append(int(g))
        for url, grades in by_url.items():
            body = rtp.curl_fetch(url, insecure=d.get("curl_insecure", False))
            if body is None:
                fail += 1
                failures.append(f"{key} {grades}年: {url}")
                continue
            fname = filename_for(url, body, d["source"], d["subject"], grades)
            rel = f"{level}/{d['subject']}/{d['source']}/{fname}"
            dst = os.path.join(ARC, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            sha = hashlib.sha256(body).hexdigest()[:16]
            prev = by_path.get(rel)
            if prev and prev.get("sha256_16") == sha:
                skip += 1  # 変化なし＝上書き不要（台帳の日付も維持）
                continue
            with open(dst, "wb") as f:
                f.write(body)
            entry = {
                "level": level, "subject": d["subject"], "publisher": d["source"],
                "grades": sorted(grades), "path": rel, "url": url,
                "sha256_16": sha, "bytes": len(body),
                "templateIds": template_ids_for(inv, d["source"], d["subject"], grades),
                "retrievedAt": datetime.date.today().isoformat(),
                "method": d["method"],
            }
            man["entries"] = [e for e in man["entries"] if e["path"] != rel]
            man["entries"].append(entry)
            by_path[rel] = entry
            ok += 1
            print(f"  ✓ {key} {sorted(grades)}年 → {rel} ({len(body):,}B)")

    man["entries"].sort(key=lambda e: (e["level"], e["subject"], e["publisher"], str(e.get("grades") or e.get("grade"))))
    man["updatedAt"] = datetime.date.today().isoformat()
    rtp.save_json(MANIFEST, man)
    print(f"\n保管 {ok} / 変化なし {skip} / 失敗 {fail}（台帳 {len(man['entries'])} 件）")
    if failures:
        print("失敗一覧（URL失効/サイト改編の可能性）:")
        for f_ in failures:
            print("  ✗", f_)
        sys.exit(1)


if __name__ == "__main__":
    main()
