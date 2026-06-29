# 指導計画 一次ソース保管庫

各教科書発行者の年間指導計画の**配布元の原本**（docx/xlsx/pdf）を、再パース・単元再構築・
改訂検証の土台として永続保管する。`/tmp` ではなくここに置く（揮発・紛失を防ぐ）。

## 構成
```
sources/teaching-plans/
  <校種>/<教科>/<発行者>/<原本ファイル>
  MANIFEST.json   … 原本→テンプレ対応・取得元URL・sha256・解析メモ
  README.md
```

## 方針
- 取得したら必ずここへ保存し MANIFEST.json に登録（path / url / sha256 / templateIds / parse）。
- 再取得は `scripts/refresh_teaching_plans.py` / 各取得元URL から。login/browser 必須のものは
  原本をここに保存しておくこと（自動再取得できないため特に重要）。
- 大容量(>5MB)の原本は必要に応じ .gitignore 可（その場合も MANIFEST に url を残す）。
- 単元再構築の原則: **小単元＝単元**（大単元は括り。汎用名「導入/いかす」等のみ大単元を接頭して曖昧さ回避）。
