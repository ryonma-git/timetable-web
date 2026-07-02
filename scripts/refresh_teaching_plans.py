#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""年間指導計画テンプレートの「改訂チェック & 差し替え」エンジン（拡張版機能）。

教科書が改訂された時（おおむね4年ごと）や、年度更新の際に、1コマンド／将来は
アプリのボタン1発で次を行うことを目的とする：

  1. 各社の年間指導計画の配布元を再取得し、前回取得時から「変わっていないか」を
     フィンガープリント(sha256)で検知する。
  2. 変わっていれば差分を示し、新年度パッケージ（拡張パック形式）の雛形を生成する。
  3. 自動取得できないもの（要ログイン＝東京書籍Eネット、学校から請求＝信州 など）は
     “ユーザーがやるべき行動”を明確に提示する。

このスクリプトは本体アプリに同梱する機能の先行実装（CLI / Claude から実行）。
将来アプリ内に取り込む際は、この DRIVER とロジックをサービス層へ移植する。

機械可読の取得元設定は docs/teaching-plan-acquisition.json（本スクリプトが生成・更新）。
人間可読のマスターは docs/teaching-plan-sources.yaml。

使い方:
  python3 scripts/refresh_teaching_plans.py check            # 改訂チェック＋要対応レポート
  python3 scripts/refresh_teaching_plans.py check --offline  # 取得せず分類とバリデーションのみ
  python3 scripts/refresh_teaching_plans.py baseline         # 現在のソースを基準値として保存
  python3 scripts/refresh_teaching_plans.py package 2028     # 令和N年度パッケージ雛形を生成
  python3 scripts/refresh_teaching_plans.py manifest         # acquisition.json を書き出すだけ
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TPL_DIR = os.path.join(ROOT, "client/public/templates/teaching")
INDEX = os.path.join(TPL_DIR, "index.json")
ACQ_JSON = os.path.join(ROOT, "docs/teaching-plan-acquisition.json")
STATE = os.path.join(ROOT, "verification/refresh-state.json")
REPORT = os.path.join(ROOT, "verification/refresh-report.json")

# 標準授業時数（法定）。検証の基準。書写は独立の標準なし(各社30前後)。
STANDARD = {
    "国語": {1: 306, 2: 315, 3: 245, 4: 245, 5: 175, 6: 175},
    "社会": {3: 70, 4: 90, 5: 100, 6: 105},
    "算数": {1: 136, 2: 175, 3: 175, 4: 175, 5: 175, 6: 175},
    "理科": {3: 90, 4: 105, 5: 105, 6: 105},
    "生活": {1: 102, 2: 105},
    "音楽": {1: 68, 2: 70, 3: 60, 4: 60, 5: 50, 6: 50},
    "図画工作": {1: 68, 2: 70, 3: 60, 4: 60, 5: 50, 6: 50},
    "家庭": {5: 60, 6: 55},
    "道徳": {1: 34, 2: 35, 3: 35, 4: 35, 5: 35, 6: 35},
    "保健": {3: 4, 4: 4, 5: 8, 6: 8},
    "英語": {3: 35, 4: 35, 5: 70, 6: 70},
    "書写": {},  # 標準なし。社間比較で検証
}

# 取得方法の分類
#   auto          … 直リンクを curl で取得（フィンガープリントで改訂検知できる）
#   browser       … JS-SPA 等。Chrome拡張でDL（URLが動的／クリック要）
#   login         … 会員ログイン必須（未ログインだと取得不可）
#   school_request… 公開されず、学校の立場で請求が必要
METHOD_LABEL = {
    "auto": "自動取得",
    "browser": "ブラウザ操作要",
    "login": "要ログイン",
    "school_request": "学校から請求",
}

# ---------------------------------------------------------------------------
# 取得元ドライバ（publisher × subject 粒度）
#   urls: {grade: url}   … auto のとき再取得・フィンガープリント対象
#   curl_insecure: True  … TLS証明書が不正な配布元（学校図書 等）。-k 付与
#   user_action          … 自動取得できない場合にユーザーへ提示する行動
#   recurring: True      … 今後も繰り返し手動対応が必要（年度毎に再発する）
# ---------------------------------------------------------------------------
B_TEN = "https://ten.tokyo-shoseki.co.jp/text/shou"
B_KEN = "https://www.shinko-keirin.co.jp/keirinkan/sho_r6"

DRIVER = [
    # ---- 東京書籍（道徳のみ Eネット要ログイン）----
    {"source": "東京書籍", "subject": "国語", "method": "auto",
     "url_pattern": B_TEN + "/kokugo/data/kokugo_keikaku_{g}_*.docx"},
    {"source": "東京書籍", "subject": "社会", "method": "auto",
     "url_pattern": B_TEN + "/shakai/data/shakai_keikaku_ryakuan_{g}.docx"},
    {"source": "東京書籍", "subject": "算数", "method": "auto",
     "url_pattern": B_TEN + "/sansu/data/sansu_keikaku_ryakuan_{g}_*.docx"},
    {"source": "東京書籍", "subject": "理科", "method": "auto",
     "url_pattern": B_TEN + "/rika/data/rika_nenkankeikaku_{g}*.docx"},
    {"source": "東京書籍", "subject": "生活", "method": "auto",
     "url_pattern": B_TEN + "/seikatsu/data/seikatsu_keikaku_r_{g}_*.docx"},
    {"source": "東京書籍", "subject": "書写", "method": "auto",
     "url_pattern": B_TEN + "/shosha/data/shosha_keikaku_ryakuan_{g}.docx"},
    {"source": "東京書籍", "subject": "家庭", "method": "auto",
     "url_pattern": B_TEN + "/katei/data/*.docx"},
    {"source": "東京書籍", "subject": "保健", "method": "auto",
     "url_pattern": B_TEN + "/hoken/data/hoken_keikaku_ryakuan_*.docx"},
    {"source": "東京書籍", "subject": "英語", "method": "auto",
     "url_pattern": B_TEN + "/eigo/data/*.docx"},
    {"source": "東京書籍", "subject": "道徳", "method": "login",
     "login_url": "https://www.tokyo-shoseki.co.jp/e-net/",
     "user_action": (
         "東京書籍『道徳』の年間指導計画は東書Eネット(ten.tokyo-shoseki.co.jp)の"
         "【会員ログイン必須】領域にあります。ログインしてから再実行してください。"
         "★既知の不具合: 5年の細案ページ(detail/118720)が6年ファイル(2024069240.docx)に"
         "差し替わっており、5年が取得できません。営業担当へ修正依頼が必要です（5年は現状欠番）。"),
     "missing_grades": [5]},

    # ---- 教育出版 ----
    {"source": "教育出版", "subject": "国語", "method": "auto"},
    {"source": "教育出版", "subject": "書写", "method": "auto"},
    {"source": "教育出版", "subject": "社会", "method": "auto"},
    {"source": "教育出版", "subject": "算数", "method": "auto"},
    {"source": "教育出版", "subject": "理科", "method": "auto"},
    {"source": "教育出版", "subject": "生活", "method": "auto"},
    {"source": "教育出版", "subject": "音楽", "method": "auto"},
    {"source": "教育出版", "subject": "英語", "method": "auto"},
    {"source": "教育出版", "subject": "道徳", "method": "auto"},

    # ---- 光村図書 ----
    {"source": "光村図書", "subject": "国語", "method": "auto"},
    {"source": "光村図書", "subject": "道徳", "method": "auto"},
    {"source": "光村図書", "subject": "生活", "method": "browser",
     "open_url": "https://www.mitsumura-tosho.co.jp/kyokasho/s-seikatsu/keikaku",
     "user_action": "光村『生活』はベクターPDF。LibreOfficeでPDF化→目視で読む(Claudeが実施)。"},
    {"source": "光村図書", "subject": "書写", "method": "browser",
     "open_url": "https://www.mitsumura-tosho.co.jp/kyokasho/s-shosha/keikaku",
     "user_action": (
         "光村『書写』は配布ページが完全なJS-SPA(/kyokasho/s-shosha/keikaku)。"
         "Chrome拡張で各学年のWordをクリックDLし、~/Downloads から解析する。"
         "★.docは(1)1・2/3・4/5・6年の合本→学年列で分割 (2)毛筆/硬筆接頭辞つき時数→合算 で読む。")},
    {"source": "光村図書", "subject": "英語", "method": "auto"},

    # ---- 啓林館 ----
    {"source": "啓林館", "subject": "理科", "method": "auto"},
    {"source": "啓林館", "subject": "算数", "method": "auto"},
    {"source": "啓林館", "subject": "英語", "method": "auto"},
    {"source": "啓林館", "subject": "生活", "method": "auto",
     "urls": {1: B_KEN + "/seikatsu/file/seikatsu_guidance_plan.xlsx",
              2: B_KEN + "/seikatsu/file/seikatsu_guidance_plan.xlsx"},
     "note": "【3学期制】シートに単元名併記の(N時間)。栽培/飼育の随時活動は除外。"},

    # ---- 開隆堂 ----
    {"source": "開隆堂", "subject": "図画工作", "method": "auto"},
    {"source": "開隆堂", "subject": "家庭", "method": "auto"},
    {"source": "開隆堂", "subject": "英語", "method": "auto"},

    # ---- 大日本図書 ----
    {"source": "大日本図書", "subject": "理科", "method": "auto"},
    {"source": "大日本図書", "subject": "算数", "method": "auto"},
    {"source": "大日本図書", "subject": "保健", "method": "auto"},
    {"source": "大日本図書", "subject": "生活", "method": "auto"},

    # ---- 学校図書 ----
    {"source": "学校図書", "subject": "理科", "method": "auto", "curl_insecure": True},
    {"source": "学校図書", "subject": "算数", "method": "auto", "curl_insecure": True},
    {"source": "学校図書", "subject": "生活", "method": "browser",
     "open_url": "https://r6-sho.gakuto-plus.jp/seikatsu/",
     "urls": {1: "https://r6-sho.gakuto-plus.jp/wp-content/uploads/r6_seikatsu_jou_nenkanhairetsu_2404.xlsx",
              2: "https://r6-sho.gakuto-plus.jp/wp-content/uploads/r6_seikatsu2_tangen.xlsx"},
     "user_action": "学校図書『生活』は横型ガント表。xlsxは取得できるが目視復元が必要(Claudeが実施)。"},

    # ---- 信州教育出版社 ----
    {"source": "信州教育出版社", "subject": "理科", "method": "auto"},
    {"source": "信州教育出版社", "subject": "生活", "method": "school_request", "recurring": True,
     "open_url": "https://www.shinkyo-pub.or.jp/",
     "user_action": (
         "信州教育出版社『生活』は公開資料が“中心活動別の計画例”のみで、単元×配当時数の"
         "確定表がありません。学校の立場で『時数入りの正式な年間指導計画』を請求してください。"
         "★請求しても時数入りが得られない場合は取得不能として扱い、ユーザー入力 or 他社流用で代替します。"),
     "missing_grades": [1, 2]},

    # ---- 教育芸術社 ----
    {"source": "教育芸術社", "subject": "音楽", "method": "auto",
     "note": "kyogei.co.jp /download/{id}/ は referer 必須。"},

    # ---- 日本文教出版 ----
    {"source": "日本文教出版", "subject": "社会", "method": "auto",
     "note": "/useful/ 配下。実ファイルURLはブラウザ発見が要ることがある。"},
    {"source": "日本文教出版", "subject": "算数", "method": "auto"},
    {"source": "日本文教出版", "subject": "図画工作", "method": "auto"},
    {"source": "日本文教出版", "subject": "道徳", "method": "auto"},

    # ---- 保健専門社 ----
    {"source": "大修館書店", "subject": "保健", "method": "auto",
     "urls": {3: "https://www.taishukan.co.jp/hoken/download/?act=word&id=497",
              4: "https://www.taishukan.co.jp/hoken/download/?act=word&id=497",
              5: "https://www.taishukan.co.jp/hoken/download/?act=word&id=498",
              6: "https://www.taishukan.co.jp/hoken/download/?act=word&id=498"}},
    {"source": "文教社", "subject": "保健", "method": "auto",
     "urls": {3: "https://bunkyosya.co.jp/r6-hoken/annualr-r6.xlsx",
              4: "https://bunkyosya.co.jp/r6-hoken/annualr-r6.xlsx",
              5: "https://bunkyosya.co.jp/r6-hoken/annualr-r6.xlsx",
              6: "https://bunkyosya.co.jp/r6-hoken/annualr-r6.xlsx"}},
    {"source": "光文書院", "subject": "保健", "method": "auto",
     "urls": {3: "https://www.kobun.co.jp/Portals/0/resource/products/hoken/dl/r6_hoken_henshushuisyo_34nen.pdf",
              4: "https://www.kobun.co.jp/Portals/0/resource/products/hoken/dl/r6_hoken_henshushuisyo_34nen.pdf",
              5: "https://www.kobun.co.jp/Portals/0/resource/products/hoken/dl/r6_hoken_henshushuisyo_56nen.pdf",
              6: "https://www.kobun.co.jp/Portals/0/resource/products/hoken/dl/r6_hoken_henshushuisyo_56nen.pdf"}},
    {"source": "光文書院", "subject": "道徳", "method": "auto"},
    {"source": "Gakken", "subject": "保健", "method": "auto",
     "urls": {3: "https://gakkokyoiku.gakken.co.jp/r6text_hoken/img/R6hoken_kousei.pdf",
              4: "https://gakkokyoiku.gakken.co.jp/r6text_hoken/img/R6hoken_kousei.pdf",
              5: "https://gakkokyoiku.gakken.co.jp/r6text_hoken/img/R6hoken_kousei.pdf",
              6: "https://gakkokyoiku.gakken.co.jp/r6text_hoken/img/R6hoken_kousei.pdf"}},
    {"source": "Gakken", "subject": "道徳", "method": "auto"},

    # ---- 三省堂（英語 5・6年。当初“要ログイン”は誤りで公開DL可）----
    {"source": "三省堂", "subject": "英語", "method": "auto",
     "urls": {5: "https://tb.sanseido-publ.co.jp/06cjpr/images/top/06crown_jr5_curric.docx",
              6: "https://tb.sanseido-publ.co.jp/06cjpr/images/top/06crown_jr6_curric.docx"},
     "note": "学習・指導内容一覧。配当時間は最終列(vMerge restart)。3・4年は外国語活動で検定教科書なし。"},
]


import re

# ---------------------------------------------------------------------------
# URLレジストリ（docs/teaching-plan-source-urls.json）を DRIVER にマージする。
# 実ダウンロードURLはコードでなくこのJSONで管理し、archive_sources.py が
# 取得検証済みのURLを追記していく。キーは "発行者/教科"、値は {学年: URL}。
# "_insecure": true でTLS検証をスキップ（学校図書等の証明書不備サイト用）。
# ---------------------------------------------------------------------------
URLS_JSON = os.path.join(ROOT, "docs/teaching-plan-source-urls.json")


def _merge_url_registry():
    try:
        with open(URLS_JSON, encoding="utf-8") as f:
            reg = json.load(f)
    except FileNotFoundError:
        return
    except Exception as e:  # 壊れたレジストリは全体を止めず警告
        print(f"[warn] URLレジストリ読込失敗: {e}", file=sys.stderr)
        return
    for d in DRIVER:
        ent = reg.get(f"{d['source']}/{d['subject']}")
        if not ent:
            continue
        urls = {int(k): v for k, v in ent.items()
                if k != "_insecure" and isinstance(v, str)}
        if urls:
            # レジストリを正とし、DRIVER側の暫定URLより優先
            d["urls"] = {**d.get("urls", {}), **urls}
        if ent.get("_insecure"):
            d["curl_insecure"] = True


def grade_int(s):
    """'5年'/'5・6'/'5・6年' などから先頭の学年番号を取り出す。失敗時 0。"""
    m = re.search(r"\d", str(s))
    return int(m.group()) if m else 0


def driver_for(source, subject):
    for d in DRIVER:
        if d["source"] == source and d["subject"] == subject:
            return d
    return None


def load_json(p, default=None):
    if not os.path.exists(p):
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save_json(p, obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def load_inventory():
    """index.json から (source, subject) ごとの収録テンプレートを集約。"""
    idx = load_json(INDEX, {"templates": []})
    inv = defaultdict(list)
    for t in idx["templates"]:
        if t.get("sourceKind") == "builtin":
            continue
        inv[(t.get("source"), t.get("subject"))].append(t)
    return inv


def curl_fetch(url, insecure=False, referer=None):
    """curl で取得しバイト列を返す。失敗時 None。(JS-SPA等は取れないことがある)"""
    cmd = ["/usr/bin/curl", "-sL", "-A", "Mozilla/5.0", "--max-time", "30"]
    if insecure:
        cmd.append("-k")
    if referer:
        cmd += ["-H", "Referer: " + referer]
    cmd.append(url)
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=40).stdout
    except Exception:
        return None
    # HTML エラーページ/空は失敗扱い
    if not out or len(out) < 200:
        return None
    head = out[:512].lstrip().lower()
    if head.startswith(b"<!doctype html") or head.startswith(b"<html"):
        return None
    return out


def sha(b):
    return hashlib.sha256(b).hexdigest()


# ---------------------------------------------------------------------------
def cmd_manifest(args):
    """ドライバを機械可読 JSON として書き出す（人間可読マスターは yaml）。"""
    out = {"_comment": "生成物。編集はDRIVER(refresh_teaching_plans.py)側を正とする。",
           "standard_hours": STANDARD, "sources": DRIVER}
    save_json(ACQ_JSON, out)
    print("wrote", os.path.relpath(ACQ_JSON, ROOT))


def validate_hours(inv):
    """収録テンプレートの合計時数を標準時数と突き合わせ、過大(読み取りミス疑い)を返す。

    ・複合学年('5・6'等)は対象学年の標準時数を合算して比較。
    ・配当は標準の8割程度が正常(帯学習・予備除く)なので過小は警告しない。
    ・過大は +25% 超のみ(二重計上=読み取りミスの典型)。書写は標準なしのため対象外。
    """
    issues = []
    for (src, subj), tpls in sorted(inv.items()):
        std = STANDARD.get(subj, {})
        if not std:
            continue
        for t in tpls:
            grades = [int(x) for x in re.findall(r"\d", str(t.get("grade", "")))]
            per = t.get("periods")
            exp = sum(std.get(g, 0) for g in grades)
            if exp and per and (per - exp) / exp > 0.25:
                issues.append((src, subj, t.get("grade"), per, exp, "過大(読取ミス疑い)"))
    return issues


def cmd_check(args):
    inv = load_inventory()
    state = load_json(STATE, {})
    new_state = dict(state)
    report = {"changed": [], "unchanged": [], "fetch_fail": [],
              "action_required": [], "auto_no_url": [], "validation": []}

    print("=" * 70)
    print(" 年間指導計画 改訂チェック")
    print("=" * 70)

    for d in DRIVER:
        src, subj, method = d["source"], d["subject"], d["method"]
        key = f"{src}/{subj}"
        have = inv.get((src, subj), [])
        have_grades = sorted(grade_int(t["grade"]) for t in have)

        # --- 自動取得できないものは「要対応」として提示 ---
        if method != "auto":
            report["action_required"].append({
                "key": key, "method": method,
                "label": METHOD_LABEL[method],
                "have_grades": have_grades,
                "user_action": d.get("user_action", ""),
                "recurring": d.get("recurring", False),
                "missing_grades": d.get("missing_grades", [])})
            continue

        # --- auto: URL未登録は offline でも分類しUIに出す（保守メモ） ---
        urls = d.get("urls")
        if not urls:
            report["auto_no_url"].append({
                "key": key, "have_grades": have_grades,
                "url_pattern": d.get("url_pattern", "")})
            continue
        if args.offline:  # 取得はしない（分類・検証のみ）
            continue

        changed_grades, ok_grades, fail_grades = [], [], []
        for g, url in urls.items():
            b = curl_fetch(url, insecure=d.get("curl_insecure", False))
            if b is None:
                fail_grades.append(g)
                continue
            h = sha(b)
            skey = f"{key}#{g}"
            prev = state.get(skey)
            new_state[skey] = {"sha": h, "url": url, "bytes": len(b)}
            if prev and prev.get("sha") != h:
                changed_grades.append(g)
            else:
                ok_grades.append(g)
        rec = {"key": key, "url_sample": list(urls.values())[0],
               "changed": sorted(set(changed_grades)),
               "ok": sorted(set(ok_grades)),
               "fail": sorted(set(fail_grades))}
        if changed_grades:
            report["changed"].append(rec)
        elif fail_grades and not ok_grades:
            report["fetch_fail"].append(rec)
        else:
            report["unchanged"].append(rec)

    report["validation"] = [
        {"source": s, "subject": sj, "grade": g, "periods": p,
         "expected": e, "flag": fl}
        for (s, sj, g, p, e, fl) in validate_hours(inv)]

    # ---- 出力 ----
    if not args.offline:
        print(f"\n[改訂検知] 変更あり {len(report['changed'])} / "
              f"変更なし {len(report['unchanged'])} / 取得失敗 {len(report['fetch_fail'])}")
        for r in report["changed"]:
            print(f"  ⚠️ 変更あり {r['key']} 学年{r['changed']} → 再解析と差し替えが必要")
        for r in report["fetch_fail"]:
            print(f"  ❓ 取得失敗 {r['key']}（URL失効/サイト改編の可能性）")

    print(f"\n[要対応 {len(report['action_required'])}件] 自動取得できない取得元:")
    order = {"login": 0, "school_request": 1, "browser": 2}
    for e in sorted(report["action_required"],
                    key=lambda x: order.get(x["method"], 9)):
        icon = {"login": "🔒", "school_request": "🏫",
                "browser": "🌐"}.get(e["method"], "🔧")
        rec = "（毎年度再発）" if e.get("recurring") else ""
        miss = f" ★欠番:{e['missing_grades']}年" if e.get("missing_grades") else ""
        print(f"  {icon} {e['key']} [{e['label']}]{rec}{miss}")
        if e.get("user_action"):
            for line in _wrap(e["user_action"], 64):
                print(f"        {line}")

    if report["auto_no_url"]:
        keys = "・".join(e["key"] for e in report["auto_no_url"])
        print(f"\n[保守メモ] 自動取得だが実URL未登録 {len(report['auto_no_url'])}件"
              "（改訂検知の対象外。差分を追うなら DRIVER に urls を追記）:")
        for line in _wrap(keys, 60):
            print(f"        {line}")

    if report["validation"]:
        print(f"\n[時数バリデーション] 標準時数からの逸脱 {len(report['validation'])}件:")
        for v in report["validation"]:
            print(f"  ! {v['source']} {v['subject']}{v['grade']}年 "
                  f"{v['periods']}時 (標準{v['expected']}) {v['flag']}")
    else:
        print("\n[時数バリデーション] 逸脱なし ✓")

    import datetime
    report["_generatedAt"] = datetime.datetime.now().isoformat(timespec="seconds")
    save_json(REPORT, report)
    if not args.offline:
        save_json(STATE, new_state)
        print(f"\nレポート: {os.path.relpath(REPORT, ROOT)}")
        if not state:
            print("※ 初回実行のため全件を基準値として保存しました（次回から差分検知）。")
    print("\n次の手順: ⚠️変更ありは Claude に『<社><教科>を再取得して差し替えて』、"
          "🔒/🏫/🌐 は上記アクション後に再実行してください。")


def _wrap(text, width):
    out, cur = [], ""
    for ch in text:
        cur += ch
        if len(cur) >= width and ch in "。、）":
            out.append(cur)
            cur = ""
    if cur:
        out.append(cur)
    return out


def cmd_baseline(args):
    """現在のソースを取得して基準フィンガープリントを保存（差分検知の起点）。"""
    args.offline = False
    # check と同じ取得を行い state を書く（report は捨てる）
    inv = load_inventory()
    state = {}
    n = 0
    for d in DRIVER:
        if d["method"] != "auto" or not d.get("urls"):
            continue
        for g, url in d["urls"].items():
            b = curl_fetch(url, insecure=d.get("curl_insecure", False))
            if b is not None:
                state[f"{d['source']}/{d['subject']}#{g}"] = {
                    "sha": sha(b), "url": url, "bytes": len(b)}
                n += 1
    save_json(STATE, state)
    print(f"基準フィンガープリントを {n} 件保存: {os.path.relpath(STATE, ROOT)}")


def cmd_package(args):
    """令和N年度パッケージ（拡張パック形式）の雛形を生成。
    現行テンプレートをコピーして“差し替え対象”の器を用意する。"""
    year = args.year
    reiwa = year - 2018
    pkg_dir = os.path.join(TPL_DIR, "packages", f"reiwa{reiwa}")
    os.makedirs(pkg_dir, exist_ok=True)
    idx = load_json(INDEX, {"templates": []})
    templates = []
    for t in idx["templates"]:
        if t.get("sourceKind") == "builtin":
            continue
        doc = load_json(os.path.join(TPL_DIR, t["file"]))
        if not doc:
            continue
        doc = dict(doc)
        doc["year"] = year
        doc["sourceKind"] = "extension"
        templates.append(doc)
    pack = {
        "version": 1,
        "packId": f"teaching-plan-reiwa{reiwa}",
        "name": f"年間指導計画 令和{reiwa}年度版パッケージ",
        "description": (
            f"令和{reiwa}年度({year}年度)教科書改訂に対応する差し替えパック。"
            "refresh_teaching_plans.py check で『変更あり』となった社・教科を"
            "再取得して各テンプレートを更新してから配布する。"),
        "baseEdition": f"令和{reiwa - 4}年度版からの更新",
        "templates": templates,
    }
    out = os.path.join(pkg_dir, f"teaching-plan-reiwa{reiwa}.pack.json")
    save_json(out, pack)
    print(f"パッケージ雛形を生成: {os.path.relpath(out, ROOT)}（{len(templates)}テンプレート）")
    print("→ check の『変更あり』社のテンプレートを再取得・更新し、このパックを配布してください。")


def cmd_ui(args):
    """取得ブラウザ(アプリUI)向けに、社×教科の状態を1つのJSONで標準出力へ。

    直近の check 結果(refresh-report.json)と DRIVER を統合し、カードに必要な
    status / アクション(login/open) / 校種(level) をUI都合の形にして返す。
    """
    inv = load_inventory()
    report = load_json(REPORT, {})

    # 状態の逆引き表（auto 社の改訂検知結果）
    auto_status = {}
    for r in report.get("changed", []):
        auto_status[r["key"]] = ("changed", r.get("changed", []))
    for r in report.get("unchanged", []):
        auto_status[r["key"]] = ("unchanged", [])
    for r in report.get("fetch_fail", []):
        auto_status[r["key"]] = ("fetch_fail", [])
    no_url = {e["key"] for e in report.get("auto_no_url", [])}

    cards = []
    for d in DRIVER:
        key = f"{d['source']}/{d['subject']}"
        have = inv.get((d["source"], d["subject"]), [])
        method = d["method"]
        chg = []  # 非autoカードや未チェックで未定義参照しないよう毎回初期化
        if method == "auto":
            st, chg = auto_status.get(key, ("unknown", []))
            if key not in auto_status:
                # 直近レポートに現れないauto: URL登録が無ければ no_url と明示
                st = "no_url" if (key in no_url or not d.get("urls")) else "unknown"
            status = st  # changed/unchanged/fetch_fail/no_url/unknown
        else:
            status = method  # login/school_request/browser
        action_kind, action_url = None, None
        if d.get("login_url"):
            action_kind, action_url = "login", d["login_url"]
        elif d.get("open_url"):
            action_kind, action_url = "open", d["open_url"]
        cards.append({
            "level": d.get("level", "小学校"),
            "source": d["source"],
            "subject": d["subject"],
            "method": method,
            "methodLabel": METHOD_LABEL[method],
            "status": status,
            "haveGrades": sorted(grade_int(t["grade"]) for t in have),
            "changedGrades": chg if method == "auto" else [],
            "missingGrades": d.get("missing_grades", []),
            "recurring": bool(d.get("recurring")),
            "userAction": d.get("user_action", ""),
            "actionKind": action_kind,
            "actionUrl": action_url,
            "note": d.get("note", ""),
        })
    out = {
        "generatedAt": report.get("_generatedAt"),
        "hasBaseline": os.path.exists(STATE),
        "levels": sorted({c["level"] for c in cards}),
        "validation": report.get("validation", []),
        "cards": cards,
    }
    print(json.dumps(out, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(description="年間指導計画 改訂チェック&差し替えエンジン")
    sub = ap.add_subparsers(dest="cmd")
    c = sub.add_parser("check", help="改訂チェック＋要対応レポート")
    c.add_argument("--offline", action="store_true", help="取得せず分類/検証のみ")
    sub.add_parser("baseline", help="現在のソースを基準値として保存")
    sub.add_parser("manifest", help="acquisition.json を書き出す")
    sub.add_parser("ui", help="取得ブラウザ向けに状態をJSONで標準出力")
    p = sub.add_parser("package", help="令和N年度パッケージ雛形を生成")
    p.add_argument("year", type=int, help="西暦(例: 2028)")
    args = ap.parse_args()
    _merge_url_registry()
    if args.cmd == "check":
        cmd_check(args)
    elif args.cmd == "baseline":
        cmd_baseline(args)
    elif args.cmd == "manifest":
        cmd_manifest(args)
    elif args.cmd == "ui":
        cmd_ui(args)
    elif args.cmd == "package":
        cmd_package(args)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
