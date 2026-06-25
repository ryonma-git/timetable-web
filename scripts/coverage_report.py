#!/usr/bin/env python3
"""令和6年度 小学校検定教科書の発行者ロスターと、収録済みテンプレートを突き合わせ、
教科ごとの取得率と未取得社（理由つき）を出力する。

ロスター出典: 教科書協会 https://www.textbook.or.jp/textbook/06e_textbook.html
未取得理由は docs/teaching-plan-sources.yaml と整合させて更新すること。

使い方: python3 scripts/coverage_report.py
"""
import json, glob, os, re
from collections import defaultdict

# 令和6年度 検定教科書 発行者ロスター（地図は指導計画なしのため除外）
ROSTER = {
    "国語": ["東京書籍", "教育出版", "光村図書"],
    "書写": ["東京書籍", "教育出版", "光村図書"],
    "社会": ["東京書籍", "教育出版", "日本文教出版"],
    "算数": ["東京書籍", "大日本図書", "学校図書", "教育出版", "啓林館", "日本文教出版"],
    "理科": ["東京書籍", "大日本図書", "学校図書", "教育出版", "信州教育出版社", "啓林館"],
    "生活": ["東京書籍", "大日本図書", "学校図書", "教育出版", "信州教育出版社", "光村図書", "啓林館"],
    "音楽": ["教育出版", "教育芸術社"],
    "図画工作": ["開隆堂", "日本文教出版"],
    "家庭": ["東京書籍", "開隆堂"],
    "保健": ["東京書籍", "大日本図書", "大修館書店", "文教社", "光文書院", "Gakken"],
    "英語": ["東京書籍", "開隆堂", "三省堂", "教育出版", "光村図書", "啓林館"],
    "道徳": ["東京書籍", "教育出版", "光村図書", "日本文教出版", "光文書院", "Gakken"],
}
# 未取得の理由（np=計画を配布せず, gantt=横型で読取困難, js=JSサイト未対応, todo=容易だが未着手）
# 注: 日本文教は /useful/ 配下に年間指導計画案あり(社会/算数/道徳/図工 取得済)
REASON = {
    ("生活", "学校図書"): "matrix", ("生活", "信州教育出版社"): "multi",
    ("書写", "光村図書"): "doc_var", ("英語", "三省堂"): "gated",
    ("保健", "大修館書店"): "js", ("保健", "文教社"): "js",
    ("保健", "光文書院"): "taiiku", ("保健", "Gakken"): "taiiku",
}
REASON_LABEL = {"np": "計画未配布", "matrix": "横型マトリクスで読取困難",
                "pdf_doc": "PDF/.doc形式", "doc_var": ".doc・学年別レイアウト差で不整合",
                "gated": "ログイン必須(公開DL不可)", "js": "JSサイト未調査",
                "taiiku": "体育全体に内包され保健分離不可", "multi": "作成資料(複数の計画例)で単一の確定時数なし"}

D = os.path.join(os.path.dirname(__file__), "..", "client/public/templates/teaching")
have = defaultdict(set)
for f in glob.glob(os.path.join(D, "*.json")):
    if os.path.basename(f) == "index.json":
        continue
    try:
        d = json.load(open(f, encoding="utf-8"))
    except Exception:
        continue
    if d.get("sourceKind") == "builtin" or "subject" not in d:
        continue
    have[d["subject"]].add(d["source"])

tot_have = tot_all = tot_obtainable = 0
print("教科別カバレッジ（令和6年度 検定教科書 発行者ロスター対比）\n")
for subj, pubs in ROSTER.items():
    got = [p for p in pubs if p in have.get(subj, set())]
    miss = [p for p in pubs if p not in have.get(subj, set())]
    # 取得可能母数 = 計画未配布(np)を除く
    obtainable = [p for p in pubs if REASON.get((subj, p)) != "np"]
    tot_have += len(got); tot_all += len(pubs); tot_obtainable += len(obtainable)
    mark = "✅" if not miss else ("◎" if all(REASON.get((subj, p)) in ("np",) for p in miss) else "→")
    line = f"{mark} {subj:5} {len(got)}/{len(pubs)}社  取得:[{('・'.join(got))}]"
    if miss:
        md = "  未:[" + "・".join(f"{p}({REASON_LABEL.get(REASON.get((subj,p),'todo'),'未着手')})" for p in miss) + "]"
        line += md
    print(line)

print(f"\n合計: {tot_have}/{tot_all}社 取得"
      f"（うち配布あり母数 {tot_obtainable} に対する取得率 {tot_have}/{tot_obtainable} = {tot_have/tot_obtainable*100:.0f}%）")
print("◎=残りは全て『計画未配布』で取得不能（実質コンプリート） / →=取得可能な未取得あり")
