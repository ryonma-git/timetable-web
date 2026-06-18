# 指導計画テンプレート実装 — 再開ガイド

ブランチ: `feature/teaching-plan-templates`  
最終更新: 2026-06-18

---

## 2026-06-18 追記（国語・道徳の追加収録 / 社会の保留）

### 追加収録 ✅（テンプレ総数 60件）
- **光村図書 国語 1〜6年**（`mitsumura_kokugo1-6.json`）
  - 出典: 光村図書「年間指導計画例」xlsx（`download_file/view/<uuid>/368`）。
  - 構造: `col2=単元名・教材名＋「N時間（領域）」`, `col3=時(コマ番号)`, `col4/col5=1コマ内の活動ステップ`。
  - **重要(時数の数え方)**: 学校現場では「N時間＝Nコマ」。**コマ数は col2 の「N時間」表記が正**。col3のコマ番号で活動をまとめ、1コマ内に複数活動があってもそのコマに集約する。col4/col5の活動行を数えてはいけない（過大計上になる）。
  - **重要(上下巻)**: 1〜4年は **上巻・下巻の2シート**構成。`wb.sheetnames` を**全て**読んで連結すること（5・6年は1シート）。上巻だけだと約半分欠落する。
  - 結果: 1年243/2年246/3年201/4年193/5年143/6年143時。標準授業時数(306/315/245/245/175/175)の約8割で全学年一貫＝帯学習・予備等を除く名前付き教材の配当。
  - 生成スクリプト: `/tmp/fix_kokugo.py`（要 `/tmp/teaching_plan_downloads/mitsumura_kokugo{1-6}.xlsx` 再取得。`/tmp`は揮発するので注意）。
- **光村図書 道徳 1〜6年**（`mitsumura_dotoku1-6.json`）
  - 出典: 光村図書「年間指導計画」**Word(.docx)**（`/kyokasho/s-dotoku/keikaku`）。
  - 構造: 1表。**7列行=実教材**（col0=重点テーマ大単元, col1=月, col2=主題名・内容項目・教材名）。4列の「適宜」コラム行は配当外。
  - 抽出: 7列かつ col1 が「N月」の行のみを各時に、重点テーマを大単元に。→ 時数 1年34・2〜6年35 で**標準に整合**。
  - docx 解析は python-docx 不使用（zip→`word/document.xml`を ElementTree で直接パース。pip 不在のため）。

### 社会 — 東京書籍「略案」で実装完了 ✅
- **東京書籍 社会 3〜6年**（`tosho_shakai3-6.json`）。出典: `https://ten.tokyo-shoseki.co.jp/text/shou/shakai/data/shakai_keikaku_ryakuan_{3,4,5,6}.docx`（取得元ページ `…/text/shou/shakai/keikaku/`、href相対 `../../shakai/data/…`）。
- 構造: 単一表。列 `月／学期／(前期)／単元名+時数／小単元時数／小単元名／指導要領／(上下)／ページ`。**3・4年=8列、5・6年=9列**(前期列の有無)。インデックスは col3=大単元, col4=小単元時数, col5=小単元名 で共通。大単元検出は `^\d+[．\s]`（3年は "1 …" スペース、4年以降は "1．…"）。各小単元時数ぶん小単元名を展開。
- **検証: 合計時数が標準授業時数と完全一致（3:70/4:90/5:100/6:105）**。整合性◎。
- ✗ 教育出版 社会Word（70テーブル・重複で約2倍）と日本文教（PDFのみ）は不採用。

### Task 2（内容空テンプレの詳細版差し替え）— 部分着手
- 啓林館 理科の詳細版（学習内容つき）`rika_unit_example03-06.xlsx` を取得済み（`/tmp/teaching_plan_downloads/`）。単一シート・【単元の目標】ブロック区切り・`次/時/指導計画/重点`列。単元名抽出が複雑なため未整形。配当表版（単元名・時数は正確、内容空）を現状維持。

### 検証レポート
- `/Users/ryon/Projects/指導計画_国語道徳_検証.html`（左=元ファイル先頭抜粋／右=抽出単元・時数・各先頭3時、時数サニティ判定つき）。

---

## 完了済み実装

### Task A — 単元並び替えボタン ✅
`client/src/components/TeachingPlanView.tsx` の `UnitEditor` コンポーネントに
上下矢印ボタンを追加済み。ホバー時に表示、disabled 時は薄く表示。
- `moveUnit(idx, dir)` 関数: units 配列の swap ロジック
- アイコン: `ChevronUp` / `ChevronDown`（lucide-react）
- 翻訳: `tp.moveUnitUp` / `tp.moveUnitDown`（日本語・英語とも LanguageContext.tsx に追加済み）

### Task B — テンプレートJSON収録 ✅（理科5社・算数3社・英語2社）

**収録済みテンプレート（48件）**:
```
builtin:  std_3/4_science, std_3/4_english, std_5/6_japanese, std_5/6_math,
          std_5/6_science, std_5/6_english（12件）

大日本図書: dainippon_rika3-6, dainippon_sansu3-6（8件）
学校図書:   gakuto_rika3-6, gakuto_sansu3-6（8件）
啓林館:     keirinkan_rika3-6, keirinkan_sansu3-6（8件）
教育出版:   kyoikushuppan_rika3-6（4件）
信州教育:   shinkyo_rika3-6（4件）
開隆堂:     kairyudo_eigo5/6（2件）
教育出版:   kyoiku_eigo5/6（2件）
```

データソースと解析フォーマット詳細 → `docs/publisher-formats.md`

**未収録**:
- 光村図書 英語（配当時数なし、形式G）
- 東京書籍 理科（Excel非公開）
- 社会・国語・道徳 全社

### Task C — 拡張パッケージ機構 🔲 未実装
TODO: JSON bundle（複数テンプレートをまとめたZIP or JSONファイル）を
ユーザーがUI経由でインポートできる仕組み。

設計案:
```json
// extension-pack.json
{
  "version": 1,
  "name": "算数テンプレート集 v1",
  "publisher": "学校図書",
  "templates": [
    { "id": "...", "grade": "3年", "subject": "算数", "units": [...] }
  ]
}
```

インポートUI候補: `LLMImportDialog.tsx` に新タブを追加するか、
`TeachingPlanTemplateDialog.tsx` にファイルドロップゾーンを追加。

### Task D — ドキュメント ✅
- `docs/publisher-formats.md`: Excel形式一覧（形式A〜K）
- `docs/RESUME_PROGRESS.md`: このファイル

---

## 再開手順

### 1. ブランチ確認
```bash
git checkout feature/teaching-plan-templates
git status
```

### 2. 主要ファイル一覧

| ファイル | 役割 |
|---------|------|
| `client/src/components/TeachingPlanView.tsx` | 指導計画UI（単元並び替えボタン追加済み） |
| `client/src/contexts/LanguageContext.tsx` | 翻訳キー（tp.moveUnitUp/Down 追加済み） |
| `client/src/lib/teachingPlanTemplates.ts` | テンプレートロジック（applyTemplate等） |
| `client/src/lib/teachingPlanPublisherImport.ts` | ExcelJSベースのインポーター（形式A/B） |
| `client/public/templates/teaching/index.json` | テンプレートレジストリ（48件） |
| `client/public/templates/teaching/*.json` | 各テンプレートJSONファイル |
| `docs/publisher-formats.md` | 各社Excelフォーマット解説 |

### 3. 残作業

#### Task C: 拡張パッケージインポートUI
```
優先度: 中
推定工数: 3〜5時間
```

実装ステップ:
1. 拡張パッケージ JSON スキーマ定義（`shared/schema.ts` か `lib/teachingPlanTemplates.ts` に追加）
2. `client/public/templates/teaching/` 内テンプレートを 1 つの bundle にパッケージするスクリプト
3. `TeachingPlanTemplateDialog.tsx` にファイルインポートUI（ドラッグ&ドロップ or ファイル選択）
4. インポートしたテンプレートをローカルストレージかIndexedDBに保存
5. `loadTemplateById()` をローカルストレージも検索するよう拡張

#### 社会・国語・道徳のテンプレート追加
```
優先度: 低
```
各社サイトから年間指導計画Excelを手動取得し、同じパイプラインで処理。

---

## テンプレートJSON形式

```typescript
interface GradeSubjectPlan {
  id: string;              // e.g. "dainippon_rika5"
  source: string;          // e.g. "大日本図書"
  sourceKind: "builtin" | "publisher" | "community";
  grade: string;           // e.g. "5年"
  subject: string;         // e.g. "理科"
  year: number;            // 2024
  edition: string;         // "令和6年度版"
  retrievedAt: string;     // "2026-06-18"
  units: Array<{
    name: string;          // 単元名
    lessons: string[];     // コマごとの内容（空文字可）
  }>;
}
```

## インデックスファイル形式

`client/public/templates/teaching/index.json`:
```json
{
  "sources": [
    { "id": "大日本図書", "name": "大日本図書", "kind": "publisher" },
    ...
  ],
  "templates": [
    {
      "id": "dainippon_rika5",
      "grade": "5年",
      "subject": "理科",
      "source": "大日本図書",
      "edition": "令和6年度版",
      "sourceKind": "publisher",
      "file": "dainippon_rika5.json"
    },
    ...
  ]
}
```

---

## 2026-06-18 深夜 自律実行 — 東京書籍 主要5教科を一括追加（総82件）

東京書籍は `ten.tokyo-shoseki.co.jp/text/shou/<教科>/keikaku/` にWord/Excelの年間指導計画があり、**いずれも合計時数が標準授業時数と一致/近似**して検証できる優良ソース。取得は `…/<教科>/data/…`（hrefは `../../<教科>/data/` 相対）。docxはzip→`word/document.xml`をElementTree直読み。

- **社会3-6年**（`tosho_shakai*`）`shakai_keikaku_ryakuan_{3-6}.docx`。大単元/小単元/時数の単一表。**標準完全一致(70/90/100/105)**。3-4年8列・5-6年9列。
- **算数1-6年**（`tosho_sansu*`）`sansu_keikaku_ryakuan_{1-6}_20240131.docx`。表2(上巻)・表3(下巻)に単元/指導時数。**単元計＋予備時数＝標準(136/175)を全学年で検証**。整数時数1..25のセルの直前を単元名とするペア検出（ヘッダ列数とデータ列数がずれるため）。
- **国語1-6年**（`tosho_kokugo*`）`kokugo_keikaku_{1-6}_*.docx`の5列表(table6)。col1=教材名+「N時間」。**N時間=コマ**。注意: col1は「単元・教材+既習事項」結合列なので**最初のN時間のみ**採用。さらに**単元番号と時数桁の結合**（"漢字を使おう２"+"1時間"="21時間"）を、時数>15なら末尾1桁採用で補正。標準の約8-9割（帯/予備除く配当）。※Excel版`R6kokugo_keikaku_k_*.xlsx`は時数の無い「指導事項関連表」なので不可。
- **理科3-6年**（`tosho_rika*`）`rika_nenkankeikaku_{3-6}*.docx`。大単元(col3)→節(col5)＋節時数(col4)。時数は「3(4)」形式で**括弧内=発展込み**を採用→標準一致(90/105/105、4年のみ102)。
- **英語5-6年**（`tosho_eigo*`）`r6_eigo_keikaku_{5,6}nen_*.docx`。Unitごとのブロック表。「単元名」「配当時間」セルの次セルを取得。**合計70時間で標準完全一致**。NEW HORIZON Elementary。

### 2026-06-18 追加実装（松尾さん起床後の依頼）
- ✅ **光村 英語5-6年「Here We Go!」**（`mitsumura_eigo*`／**本市採用教科書**）。細案docx（`download_file/view/<uuid>/559`、5年`b6bab04c…`/6年`a3a33b64…`）。Unitヘッダ表(配当時間)＋詳細表(時/活動内容)。**70時間で標準完全一致**。※略案xlsxは時数列なしで不可。
- ✅ **教育出版 国語1-6年**（`kyoiku_kokugo*`、`ひろがる言葉`）。Excel(`/textbook/shou/kokugo/files/r6kokugoN_nenkeihyouka_*.xlsx`)。col3=時数(N/(領域N))→N時間、col4=教材名(教科書手前で切る)、col6=コマ、col7=活動。標準の約8割。
- ✅ **教育出版 道徳1-6年**（`kyoiku_dotoku*`、`はばたこう明日へ`）。Excel(`/dotoku/files/R6dotokuN_nenkeihyouka_2404.xlsx`)。col3=教材名,col4=時数,月で単元化。**標準34/35と完全一致**。
- ✅ **啓林館 算数3-6年の時数バグ修正**。出典=配当表`shinko-keirin.co.jp/keirinkan/sho_r6/sansu/file/sansu_guidance_plan0N.xlsx`。**col8「時」は大単元ごとにリセットする時番号→各大単元の最大値が時数**(旧実装は行数計上で過少56-67)。1-4年は上下巻2シート連結。→149/155/157/135時(標準175の77-90%)。

### 2026-06-18 追加3件（全6教科が2社以上に・総108件）
- ✅ **教育出版 算数1-6年**（`kyoiku_sansu*`）。Excel(`/textbook/shou/sansu/files/r6sansuN_nenkeihyouka_2404.xlsx`)。**「（N時間）」を含む行＝大単元ヘッダ**(col1=単元名,●○■◎や番号の接頭辞)、明細のcol1整数=小単元時数。標準の約9割。
- ✅ **啓林館 英語5-6年「Blue Sky」**（`keirinkan_eigo*`）。docx(`/keirinkan/sho_r6/eigo/file/eigo_guidance_plan0{5,6}.docx`)。12列表、col1=配当時数,col2=Unit名。Unit+REVIEWで64/65時(標準70の9割)。
- ✅ **教育出版 社会3-6年**（`kyoiku_shakai*`）。Word(`/shakai/files/r6shakaiN_nenkeihyouka_*.docx`)。**70表の重複回避法**=「大単元」「配当時間 N時間」を含むヘッダ表のみで大単元・時数を取り、直後の概要表の丸数字中単元を内容に。標準一致/近似(70/88/100/105)。

### まだ残っている候補
- 算数・理科の他社残り、書写・地図・生活・音楽・図工・家庭。
- 国語・道徳の他社（学校図書・三省堂・日文・学研・光文書院 等）。
- 既存`keirinkan_sansu`は配当表方式に修正済み。

## TypeScript 型チェック

```bash
cd /Users/ryon/timetable_app_manus_claude/timetable-web
npx tsc --noEmit
```

## デプロイ

```bash
git add -A && git commit -m "feat: ..."
git push origin feature/teaching-plan-templates
```

Netlify が自動ビルド・プレビュー URL を生成。
`main` へのマージは **絶対にしないこと**（stable ブランチ保護）。
