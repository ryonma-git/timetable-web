# 現在地と次にやること（作業の栞）

最終更新: 2026-07-02 / 記録者: Claude(opus)。**mainは無傷**（全開発は feature ブランチ上）。

## ブランチ地図
| ブランチ | 中身 | main比 |
|---|---|---|
| `main` | リリース基準（指導計画Excel往復＋サンプルまで） | — |
| `feature/teaching-plan-templates` | 指導計画テンプレ本体（三省堂英語まで） | 先行 |
| `feature/teaching-plan-refresh` | 改訂チェック＆取得ブラウザ＋社会再構築＋std法定化＋**中学原本** | ↑を内包し先行 |
| `feature/mobile-sync` | 上記全部＋**スマホ連動(自宅/Vercel)** ← いま最新・作業中 | 96コミット先行 |

> feature/mobile-sync は teaching-plan-refresh から分岐＝これまでの成果を全部含む最新。

---

## A. スマホ連動を Vercel で動かす（中断中・再開ポイント）
コードは完成済み（`api/sync`・`vercel.json`・KVアダプタ、`docs/mobile-sync-design.md §6.6`）。残りは **Vercel上の操作だけ**。

1. **デプロイのブランチを `feature/mobile-sync` にする**（mainには同期コードが無い）
   - Vercelプロジェクト作成後 → **Settings → Git → Production Branch → `feature/mobile-sync`** → Redeploy。
   - （mainをリリース基準に保つため、マージではなくブランチ切替を推奨）
2. **環境変数 `SYNC_TOKEN`** を設定（長い乱数。`python3 -c "import secrets;print(secrets.token_urlsafe(32))"` で生成）。
   - ※前回チャットで生成した値があるが、gitには載せていない。改めて生成してよい。
3. **Storage → KV(Upstash Redis) を作成しプロジェクトに Connect**（`KV_REST_API_URL`/`KV_REST_API_TOKEN` が自動注入）。
4. 画面設定: Preset=Vite のまま／Root=`./` のまま（`vercel.json`が出力先 `dist/public` を上書き）。
5. デプロイ後、`https://<app>.vercel.app` を Mac と iPhone で開く → サイドバー「スマホ連動」→
   **サーバURLは空欄**・**トークン=SYNC_TOKEN** を入力 → 有効化。
- 注意: 取得ブラウザ（指導計画の改訂チェック）は python 依存で **Vercelでは動かない**（Macローカル専用。アプリは自動で「この環境では実行できません」表示）。

**代替案**: どうしてもmain運用にしたいなら Claude が `feature/mobile-sync`→main マージ可（ただし96コミット全部がmainに乗る）。

---

## B. 指導計画データの残作業（feature/teaching-plan-refresh 系）
1. **中学の年間指導計画**: 東京書籍・中学9教科の**原本は保管済み**（`sources/teaching-plans/中学校/…東京書籍`）。
   → パース＆テンプレ化（小単元＝単元・入れ子命名の方式は小学社会で確立済み）。
   → 社会（別ページ）と、**数研出版など中学専業社**の取得元開拓（`docs/teaching-plan-chugaku-roster.md` にロスター済み）。
2. **小学の小単元再構築を他教科へ展開**（社会3社=完了。国語/理科/算数…）。原本は保管庫へ、`validate_teaching_data.py` で毎回検証。
3. **改訂チェックの実URL一括登録**（`refresh_teaching_plans.py` の DRIVER：現状fingerprint対象は一部。残りURL登録で全社差分検知に）。

## C. スマホ連動の作り込み（P3・Vercel疎通後）
- 競合UI（409時に取り込む/上書きを選ぶ）、同期状態インジケータ（ヘッダ等に常時表示）、定期プル。

---

## 電話・外部依頼で残っているもの
- **信州教育出版社（生活）**: 学校の立場で「時数入りの正式な年間指導計画」を請求。得られなければ取得不能として代替。
- （東京書籍 道徳5年は解決済み。三省堂英語も公開DLで解決済み。）

## 再開時のコマンド早見
```bash
cd timetable-web
git checkout feature/mobile-sync   # 最新の全部入り
npm run dev                        # 開発サーバ(:3000)
python3 scripts/validate_teaching_data.py   # 指導計画データ検証
python3 scripts/refresh_teaching_plans.py check --offline  # 取得元の要対応一覧
```
