# 時間割管理アプリ デザインアイデア

## 対象ユーザー
小学校教員。毎日使う業務ツール。操作効率と視認性が最優先。

---

<response>
<text>
## アイデア A: 「教室の黒板」モダンクラシック

**Design Movement**: Japanese Stationery / Academic Precision
**Core Principles**:
1. 情報密度を高く保ちながらも余白を活かした「読みやすさ」
2. 教育現場を連想させる落ち着いたグリーン系アクセント
3. グリッドの整合性を最優先した構造的レイアウト
4. 機能ごとに明確に区切られた「仕切り」の美学

**Color Philosophy**: ダークネイビー（#1a2332）をベースに、チョークホワイト（#f5f0e8）とセージグリーン（#4a7c59）のアクセント。落ち着きと信頼感。

**Layout Paradigm**: 左サイドバー固定（240px）＋ 中央コンテンツ（週間グリッド）＋ 右インスペクタ（280px）の3ペイン。

**Signature Elements**:
1. グリッドセルに微細なグリッドパターン背景
2. 曜日ヘッダーに黒板風の下線装飾
3. 操作ボタンに消しゴム/チョーク風のテクスチャ

**Interaction Philosophy**: 操作は最小クリック数で完結。ホバーで詳細表示。
**Animation**: セル選択時に軽いスケールアップ（1.02）。状態変更時にフェードイン。
**Typography**: 見出しに「Noto Serif JP」、本文に「Noto Sans JP」
</text>
<probability>0.08</probability>
</response>

<response>
<text>
## アイデア B: 「清潔感のある業務ツール」Functional Minimalism ← 採用

**Design Movement**: Swiss Grid System × Japanese Functional Design
**Core Principles**:
1. 情報の階層を色と太さで明確に表現
2. 操作の流れを左→右、上→下の自然な視線移動に沿わせる
3. 状態（空き/授業あり/今日/選択中）を色で即座に判別可能にする
4. 余白を「呼吸」として使い、密度が高くても圧迫感を与えない

**Color Philosophy**:
- ベース: スレートグレー系の白（#f8fafc）
- プライマリ: インディゴブルー（oklch(0.45 0.2 264)）— 信頼・知性
- 授業あり: 淡いブルー背景（oklch(0.95 0.05 264)）
- 今日列: アンバーアクセント（oklch(0.85 0.12 80)）
- 空きコマ: ニュートラルグレー

**Layout Paradigm**:
- 左サイドバー（220px）: データ読み込み・ナビゲーション・Undo/Redo・エクスポート
- 中央メインエリア: 今日のバナー + 週間グリッド（スクロール可）
- 右インスペクタ（280px）: 選択コマの詳細 + 操作フォーム（react-resizable-panelsで幅調整可）

**Signature Elements**:
1. 週間グリッドのヘッダー行に今日の日付をアンバーでハイライト
2. 授業コマにクラス名を大きく表示、理由タグをピル型で下部に表示
3. サイドバーのUndoスタック数をバッジで表示

**Interaction Philosophy**:
- セルクリック → 右インスペクタに詳細が即時表示
- ドラッグ＆ドロップ → ドロップ先をグリーンでハイライト
- 操作完了 → Sonnerトーストで結果を通知

**Animation**:
- セル選択: border-color transition 150ms
- インスペクタ表示: slide-in from right 200ms
- グリッド更新: opacity flash 100ms

**Typography**:
- 見出し: 「BIZ UDPGothic」 bold — 教育現場でなじみのある字体
- 本文: 「Noto Sans JP」 regular/medium
- 数字: tabular-nums で揃える
</text>
<probability>0.09</probability>
</response>

<response>
<text>
## アイデア C: 「カラーコーディングされた時間割」Vibrant Utility

**Design Movement**: Material Design 3 × Pastel Academic
**Core Principles**:
1. クラスごとに固有の色を割り当て、視覚的に即座に識別
2. カード型UIでコマを表現、影で浮き上がり感を演出
3. アニメーションを積極的に使い、操作のフィードバックを豊かに

**Color Philosophy**: 各学年に固有のパステルカラー（4年=ピーチ、5年=ミント、6年=ラベンダー）。背景は純白。

**Layout Paradigm**: 全画面グリッド優先。サイドバーはコラプス可能。

**Signature Elements**:
1. クラスカードにグラデーション背景
2. ドラッグ中のカードに影とローテーション
3. 集計画面にドーナツチャート

**Interaction Philosophy**: ゲーミフィケーション要素。操作完了時に小さなアニメーション。
**Animation**: Spring physics でのドラッグ。カード入れ替え時のフリップアニメーション。
**Typography**: 「M PLUS Rounded 1c」— 親しみやすい丸ゴシック
</text>
<probability>0.07</probability>
</response>

---

## 採用: アイデア B「清潔感のある業務ツール」

業務ツールとして毎日使う性質上、視認性・操作効率・情報密度のバランスが最も重要。
Swiss Grid × Japanese Functional Design のアプローチで、
インディゴブルーをプライマリカラーとした3ペインレイアウトを採用する。
