#!/usr/bin/env python3
"""指導計画テンプレート 目視検証ダッシュボードを生成する。

1画面で：①生成した単元リスト ②時数の法定検算 ③社間比較 を一覧でき、
各テンプレートから「元ファイル（発行者のソースそのもの）」へ直リンクする。
ソースは抜粋ではなく発行者の原本URLを開く（=ソースそのもの）。

出力: ../verification/指導計画_検証ダッシュボード.html（自己完結HTML）
使い方: python3 scripts/build_verification_dashboard.py
"""
import json, glob, os, re, html, statistics
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), "..")
TPL = os.path.join(ROOT, "client/public/templates/teaching")
OUT_DIR = os.path.join(ROOT, "verification")
os.makedirs(OUT_DIR, exist_ok=True)

STD = {
 "国語": {1:306,2:315,3:245,4:245,5:175,6:175}, "社会": {3:70,4:90,5:100,6:105},
 "算数": {1:136,2:175,3:175,4:175,5:175,6:175}, "理科": {3:90,4:105,5:105,6:105},
 "生活": {1:102,2:105}, "音楽": {1:68,2:70,3:60,4:60,5:50,6:50},
 "図画工作": {1:68,2:70,3:60,4:60,5:50,6:50}, "家庭": {5:60,6:55,"5・6":115},
 "道徳": {1:34,2:35,3:35,4:35,5:35,6:35}, "保健": {3:4,4:4,5:8,6:8},
 "英語": {5:70,6:70}, "書写": {},
}

# 発行者の元ファイル(ソースそのもの)URL解決。抜粋でなく原本を開く。
TEN = "https://ten.tokyo-shoseki.co.jp/text/shou"
KYO = "https://www.kyoiku-shuppan.co.jp/textbook/shou"
MIT = "https://www.mitsumura-tosho.co.jp/download_file/view"
KEI = "https://www.shinko-keirin.co.jp/keirinkan/sho_r6"
KAI = "https://www.kairyudo.co.jp/contents/04_shiryo/nenkei/sho/data"
DAI = "https://www.dainippon-tosho.co.jp"
TEN_K = {1:"202401",2:"202503",3:"202512",4:"202503",5:"202401",6:"202412"}
KOK_S = {1:"2404",2:"2404",3:"2504",4:"2404",5:"2404",6:"2504"}
SHA_S = {3:"2504",4:"2504",5:"2504",6:"2604"}
ONG_S = {1:"2404",2:"2507",3:"2404",4:"2404",5:"2404",6:"2404"}
MIT_KOK = {1:"088f2846-983b-455d-b185-6c3a18a27671",2:"1916261d-d388-44ac-af42-3aa7e13b6b11",3:"7ff6b471-db8d-470a-968a-a9899624022a",4:"3db56761-ee29-4e40-81b8-d9480c60cd85",5:"d8b2753f-1cbb-415c-a570-2a2cfa70fbe3",6:"1fcac788-a61c-4521-a515-9a40f3413770"}
MIT_DOT = {1:"886e88ef-4363-4ff0-8b22-8d30a63c201d",2:"2fb2dcd0-9880-46bd-968d-b262022e17ec",3:"844c33aa-5c6e-49f7-afd9-6565b27cc913",4:"8417f499-2434-4b65-925f-df151544cbbd",5:"7a7478f9-5a56-4413-b131-23030dd14cff",6:"bb86697b-fef4-4d77-a8a3-c6c84d7e3d69"}
MIT_EIGO = {5:"b6bab04c-ded7-409d-9a63-f01c4c7c9d22",6:"a3a33b64-db9f-4dec-aa84-340520f80bd1"}
KAI_ZU = {1:"nenkei_r6shozu1_2",2:"nenkei_r6shozu2",3:"nenkei_r6shozu3",4:"nenkei_r6shozu4",5:"nenkei_r6shozu5_2",6:"nenkei_r6shozu6_2"}
KYOGEI = {1:26622,2:26624,3:26626,4:26628,5:26630,6:26632}
# index系（原本URL未確定の社）は発行者の指導計画ページへ
IDX = {
 "大日本図書理科": "https://www.dainippon-tosho.co.jp/introduction2024/contents/download.html",
 "大日本図書算数": "https://www.dainippon-tosho.co.jp/introduction2024/contents/download.html",
 "学校図書理科": "https://r6-sho.gakuto-plus.jp/rika", "学校図書算数": "https://r6-sho.gakuto-plus.jp/sansu",
 "信州教育出版社理科": "https://www.shinshin.shinshu-u.ac.jp/",
}

def src_url(tid, subj, g):
    try: gi = int(re.match(r'(\d+)', str(g)).group(1))
    except Exception: gi = 5
    if tid.startswith("tosho_kokugo"): return f"{TEN}/kokugo/data/kokugo_keikaku_{gi}_{TEN_K[gi]}.docx"
    if tid.startswith("tosho_shakai"): return f"{TEN}/shakai/data/shakai_keikaku_ryakuan_{gi}.docx"
    if tid.startswith("tosho_sansu"): return f"{TEN}/sansu/data/sansu_keikaku_ryakuan_{gi}_20240131.docx"
    if tid.startswith("tosho_rika"): return f"{TEN}/rika/data/rika_nenkankeikaku_{gi}{'_n' if gi==3 else ''}.docx"
    if tid.startswith("tosho_seikatsu"): return f"{TEN}/seikatsu/data/seikatsu_keikaku_r_{gi}_20240131.docx"
    if tid.startswith("tosho_shosha"): return f"{TEN}/shosha/data/shosha_keikaku_ryakuan_{gi}.docx"
    if tid.startswith("tosho_hoken"): return f"{TEN}/hoken/data/hoken_keikaku_ryakuan_{'3・4' if gi<=4 else '5・6'}.docx"
    if tid.startswith("tosho_katei"): return f"{TEN}/katei/data/katei_skeikaku_202401.docx"
    if tid.startswith("kyoiku_kokugo"): return f"{KYO}/kokugo/files/r6kokugo{gi}_nenkeihyouka_{KOK_S[gi]}.xlsx"
    if tid.startswith("kyoiku_shakai"): return f"{KYO}/shakai/files/r6shakai{gi}_nenkeihyouka_{SHA_S[gi]}.docx"
    if tid.startswith("kyoiku_sansu"): return f"{KYO}/sansu/files/r6sansu{gi}_nenkeihyouka_2404.xlsx"
    if tid.startswith("kyoiku_ongaku"): return f"{KYO}/ongaku/files/r6ongaku{gi}_nenkei_{ONG_S[gi]}.xlsx"
    if tid.startswith("kyoiku_dotoku"): return f"{KYO}/dotoku/files/R6dotoku{gi}_nenkeihyouka_2404.xlsx"
    if tid.startswith("kyoiku_shosha"): return f"{KYO}/shosha/files/r6shosha{gi}_nenkeihyouka_2404.xlsx"
    if tid.startswith("kyoiku_seikatsu"): return f"{KYO}/seikatsu/files/r6seikatsu{gi}_nenkeihyouka_2404.xlsx"
    if tid.startswith("mitsumura_kokugo"): return f"{MIT}/{MIT_KOK[gi]}/368"
    if tid.startswith("mitsumura_dotoku"): return f"{MIT}/{MIT_DOT[gi]}/583"
    if tid.startswith("mitsumura_eigo"): return f"{MIT}/{MIT_EIGO[gi]}/559"
    if tid.startswith("keirinkan_rika"): return f"{KEI}/rika/curriculum.html"
    if tid.startswith("keirinkan_sansu"): return f"{KEI}/sansu/file/sansu_guidance_plan{gi:02d}.xlsx"
    if tid.startswith("keirinkan_eigo"): return f"{KEI}/eigo/file/eigo_guidance_plan{gi:02d}.docx"
    if tid.startswith("kairyudo_zukou"): return f"{KAI}/{KAI_ZU[gi]}.xlsx"
    if tid.startswith("kairyudo_eigo"): return f"{KAI}/nenkei_r6shoei{gi}.xlsx"
    if tid.startswith("kairyudo_katei"): return f"{KAI}/nenkei_r6shoka{gi}.xlsx"
    if tid.startswith("dainippon_hoken"): return f"{DAI}/taiiku/files/r6hokenSH.xlsx"
    if tid.startswith("dainippon_seikatsu"): return f"{DAI}/seikatsu/files/r6seikatsuSH.xlsx"
    if tid.startswith("kyogei_ongaku"): return f"https://www.kyogei.co.jp/download/{KYOGEI[gi]}/"
    return IDX.get(f"{IDX_key(tid, subj)}", "")

def IDX_key(tid, subj):
    if tid.startswith("dainippon_rika"): return "大日本図書理科"
    if tid.startswith("dainippon_sansu"): return "大日本図書算数"
    if tid.startswith("gakuto_rika"): return "学校図書理科"
    if tid.startswith("gakuto_sansu"): return "学校図書算数"
    if tid.startswith("shinkyo"): return "信州教育出版社理科"
    return ""

def esc(s): return html.escape(str(s))

# データ収集
recs = []
for f in sorted(glob.glob(os.path.join(TPL, "*.json"))):
    if os.path.basename(f) == "index.json": continue
    try: d = json.load(open(f, encoding="utf-8"))
    except Exception: continue
    if d.get("sourceKind") == "builtin" or "units" not in d: continue
    g = d["grade"]; gi = int(re.match(r'(\d+)', g).group(1)) if re.match(r'\d', g) else 0
    periods = sum(len(u.get("lessons", [])) for u in d["units"])
    std = STD.get(d["subject"], {}).get(gi) or STD.get(d["subject"], {}).get(g)
    recs.append({
        "id": d["id"], "subject": d["subject"], "grade": g, "gi": gi,
        "source": d["source"], "periods": periods, "std": std,
        "note": d.get("note", ""), "url": src_url(d["id"], d["subject"], g),
        "units": [{"n": u["name"], "h": len(u.get("lessons", [])),
                   "ex": (u.get("lessons", [""])[0] if u.get("lessons") else "")} for u in d["units"]],
    })

# 社間比較
cross = defaultdict(list)
for r in recs:
    cross[(r["subject"], r["grade"])].append(r)

SUBORDER = ["国語","書写","社会","算数","理科","生活","音楽","図画工作","家庭","保健","道徳","英語"]
def subkey(s): return SUBORDER.index(s) if s in SUBORDER else 99

# ---- HTML 生成 ----
parts = ["""<!doctype html><html lang=ja><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>指導計画 検証ダッシュボード</title><style>
*{box-sizing:border-box}body{font-family:-apple-system,'Hiragino Sans',sans-serif;margin:0;background:#f5f5f7;color:#1d1d1f;line-height:1.5}
header{background:#1d1d1f;color:#fff;padding:20px 28px;position:sticky;top:0;z-index:10}
header h1{margin:0;font-size:19px}header p{margin:4px 0 0;color:#aaa;font-size:13px}
.wrap{padding:20px 28px;max-width:1400px;margin:0 auto}
h2{font-size:16px;margin:28px 0 12px;border-left:4px solid #0066cc;padding-left:10px}
.filters{margin:10px 0}.filters button{border:1px solid #ccc;background:#fff;border-radius:16px;padding:5px 13px;margin:3px;cursor:pointer;font-size:13px}
.filters button.on{background:#0066cc;color:#fff;border-color:#0066cc}
table.cross{border-collapse:collapse;width:100%;font-size:13px;background:#fff;border-radius:8px;overflow:hidden}
table.cross th,table.cross td{border:1px solid #e5e5e5;padding:6px 9px;text-align:left}
table.cross th{background:#f0f0f2}
.ok{color:#1a7f37;font-weight:600}.warn{color:#b3640a;font-weight:600}.bad{color:#c2143d;font-weight:700}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.card{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;display:flex;flex-direction:column}
.ch{padding:10px 14px;border-bottom:1px solid #eee}
.ch .t{font-weight:600;font-size:14px}.ch .m{font-size:12px;color:#888;margin-top:2px}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:12px;font-weight:600}
.b-ok{background:#e3f5e9;color:#1a7f37}.b-warn{background:#fff4e0;color:#b3640a}.b-info{background:#e8f0fe;color:#1a56b3}
.src{display:inline-block;margin-top:6px;font-size:12px;color:#0066cc;text-decoration:none;border:1px solid #cfe0ff;border-radius:6px;padding:3px 9px}
.src:hover{background:#eef5ff}
.ulist{padding:8px 14px;max-height:260px;overflow:auto;font-size:12px}
.ulist div{display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px dotted #eee}
.ulist .un{color:#1d1d1f}.ulist .uh{color:#888;white-space:nowrap}
.hide{display:none}
.legend{font-size:12px;color:#666;margin:6px 0}
</style>
<header><h1>指導計画テンプレート 検証ダッシュボード</h1>
<p>生成した単元リスト／法定時数の検算／社間比較を一画面で確認。各テンプレの「元ファイル」は発行者の原本(ソースそのもの)を開きます。</p></header>
<div class=wrap>"""]

# サマリ
n_tpl = len(recs)
subjset = sorted(set(r["subject"] for r in recs), key=subkey)
parts.append(f'<p class=legend>収録 {n_tpl} テンプレート／{len(subjset)} 教科。バッジ: '
             f'<span class="badge b-ok">時数=標準</span> '
             f'<span class="badge b-info">標準比(帯/予備等で差)</span> '
             f'<span class="badge b-warn">社間外れ値の疑い</span></p>')

# 社間比較
parts.append("<h2>① 社間検算（同一学習指導要領→総時数は揃うはず。★=中央比±25%超）</h2>")
parts.append('<table class=cross><tr><th>教科・学年</th><th>標準</th><th>各社の時数（社:時数）</th></tr>')
for key in sorted(cross, key=lambda k:(subkey(k[0]), k[1])):
    rs = cross[key]
    if len(rs) < 2: continue
    ps = [r["periods"] for r in rs]; med = statistics.median(ps)
    std = rs[0]["std"]
    cells = []
    for r in sorted(rs, key=lambda x:-x["periods"]):
        out = med and abs((r["periods"]-med)/med) > 0.25
        cells.append(f'<span class="{ "bad" if out else "" }">{esc(r["source"])}:{r["periods"]}</span>')
    parts.append(f'<tr><td>{esc(key[0])}{esc(key[1])}</td><td>{std if std else "—"}</td><td>{" / ".join(cells)}</td></tr>')
parts.append("</table>")

# フィルタ
parts.append("<h2>② 全テンプレート（生成リスト×元ファイル）</h2>")
btns = '<button class="on" data-s="all">すべて</button>' + "".join(f'<button data-s="{esc(s)}">{esc(s)}</button>' for s in subjset)
parts.append(f'<div class=filters>{btns}</div>')

parts.append('<div class=cards id=cards>')
for r in sorted(recs, key=lambda x:(subkey(x["subject"]), x["gi"], x["source"])):
    std = r["std"]
    if r["subject"] == "書写" or std is None:
        badge = '<span class="badge b-info">時数 %d</span>' % r["periods"]
    elif r["periods"] == std:
        badge = '<span class="badge b-ok">%d時=標準</span>' % r["periods"]
    else:
        pct = round(r["periods"]/std*100) if std else 0
        badge = '<span class="badge b-info">%d時 / 標準%d (%d%%)</span>' % (r["periods"], std, pct)
    src = (f'<a class=src href="{esc(r["url"])}" target=_blank rel=noopener>📄 元ファイルを開く</a>'
           if r["url"] else '<span class=src style="color:#aaa;border-color:#eee">原本URL未確定</span>')
    ul = "".join(f'<div><span class=un>{esc(u["n"])}</span><span class=uh>{u["h"]}時</span></div>' for u in r["units"])
    parts.append(f'''<div class=card data-s="{esc(r["subject"])}">
<div class=ch><div class=t>{esc(r["subject"])} {esc(r["grade"])}・{esc(r["source"])}</div>
<div class=m>{badge} ・ 全{len(r["units"])}単元</div>{src}</div>
<div class=ulist>{ul}</div></div>''')
parts.append("</div>")

parts.append("""</div><script>
const btns=document.querySelectorAll('.filters button'),cards=document.querySelectorAll('#cards .card');
btns.forEach(b=>b.onclick=()=>{btns.forEach(x=>x.classList.remove('on'));b.classList.add('on');
const s=b.dataset.s;cards.forEach(c=>c.classList.toggle('hide',s!=='all'&&c.dataset.s!==s));});
</script></html>""")

out = os.path.join(OUT_DIR, "指導計画_検証ダッシュボード.html")
open(out, "w", encoding="utf-8").write("\n".join(parts))
print("written:", out, len("\n".join(parts)), "bytes /", n_tpl, "templates")
