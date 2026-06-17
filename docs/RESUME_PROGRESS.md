# 指導計画テンプレート実装 — 再開ガイド

ブランチ: `feature/teaching-plan-templates`  
最終更新: 2026-06-18

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
