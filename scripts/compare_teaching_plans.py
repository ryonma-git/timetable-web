#!/usr/bin/env python3
"""指導計画テンプレートの社間横断比較QA。

同一の学習指導要領が基なので、教科×学年の総時数は社間でほぼ揃うはず。
中央値比 ±25% 超を外れ値（読み取りミス疑い）として表示する。

使い方: python3 scripts/compare_teaching_plans.py
"""
import json, glob, statistics, re, os
from collections import defaultdict

D = os.path.join(os.path.dirname(__file__), "..", "client/public/templates/teaching")
data = defaultdict(list)
for f in glob.glob(os.path.join(D, "*.json")):
    if os.path.basename(f) == "index.json":
        continue
    try:
        d = json.load(open(f, encoding="utf-8"))
    except Exception:
        continue
    if not all(k in d for k in ("subject", "grade", "units")) or not isinstance(d["units"], list):
        continue
    p = sum(len(u.get("lessons", [])) for u in d["units"])
    data[(d["subject"], d["grade"])].append((d["source"], p))

gk = lambda g: (int(re.match(r"(\d+)", g).group(1)) if re.match(r"(\d+)", g) else 99)
out = 0
for k in sorted(data, key=lambda x: (x[0], gk(x[1]))):
    rows = [r for r in data[k] if "標準" not in r[0]]
    if len(rows) < 2:
        continue
    med = statistics.median([r[1] for r in rows])
    line = " / ".join(
        f"{'★' if med and abs((p - med) / med) > 0.25 else ''}{s}:{p}"
        for s, p in sorted(rows, key=lambda x: -x[1])
    )
    if any(med and abs((p - med) / med) > 0.25 for s, p in rows):
        out += 1
    print(f"【{k[0]}{k[1]}】中央{med:.0f}時  {line}")
print(f"\n外れ値(読み取りミス疑い): {out}件")
