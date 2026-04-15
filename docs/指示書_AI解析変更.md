# NEXUS OPS 作業指示書 — AI 解析の内容変更

作成日: 2026-04-16
対象リポジトリ: [tpp217/nexus-ops](https://github.com/tpp217/nexus-ops)
作業環境: ローカル VSCode + Claude Code（ブランチ接頭辞は `lc/`）

---

## 1. プロジェクト概要

NEXUS OPS は、店舗・スタッフの 1on1 / MTG 記録を Excel / ZIP からインポートし、AI で分析・可視化する社内向けウェブアプリ。

- MODULE 001「店舗 MT 記録分析」が現行のメイン機能
- Excel → パース → Supabase 保存 → AI 解析 → カード表示 / PDF 出力 の流れ

## 2. 技術スタック（現状）

| 層 | 採用技術 |
|---|---|
| フロントエンド | Vanilla HTML / CSS / JavaScript（フレームワーク不使用） |
| Excel / ZIP | SheetJS (XLSX) / JSZip |
| PDF 生成 | jsPDF + html2canvas |
| バックエンド | Node.js + Express 5（`server.js` 1本の All-in-One） |
| DB | Supabase（`meeting_records` テーブルほか） |
| AI エンジン | `gsk super_agent` を `child_process.exec` で呼び出し |
| シークレット管理 | Doppler（`npm start` は `doppler run -- node server.js`） |
| ホスティング | Vercel（静的） + VM 側 AI API のハイブリッド構成（PR #2） |
| 共通ルール | main 直 push 禁止 / ブランチは `lc/<種別>/<内容>` / `.env` ローカル禁止 |

## 3. ディレクトリ構成

```
nexus-ops/
├── index.html              # ダッシュボード
├── meeting-analyzer.html   # MODULE 001
├── css/style.css
├── js/
│   ├── analyzer.js         # 分析エンジン（Excel パース・AI 呼び出し・描画）
│   └── pdf-export.js       # PDF エクスポート
├── server.js               # Express サーバ（静的配信 + REST + /api/analyze）
├── package.json            # start: doppler run -- node server.js
└── docs/                   # 本指示書など
```

## 4. 既存の AI 解析仕様（変更前）

### 4.1 エンドポイント

| Method | Path | 用途 | タイムアウト |
|---|---|---|---|
| POST | `/api/analyze` | 1 レコード（単票）総評 | 120s |
| POST | `/api/analyze/person` | 対象者の全レコードを俯瞰した総合評価 | 180s |
| GET | `/api/health` | ヘルスチェック | — |

### 4.2 現行プロンプトの骨子

- ロール: 「人材育成の専門家」
- 観点: 課題 / 状態 / 感情・モチベーション / 原因と結果 / アクション（決定・保留・予定）
- 出力: JSON のみ（前置き禁止）

### 4.3 現行のレスポンス JSON スキーマ

```json
{
  "ai_review":           "総評（単票 600〜800字 / 全体 800〜1000字、箇条書き禁止）",
  "ai_status":           "進行中 | 停滞中 | 予定",
  "ai_actions_decided":  ["決定事項（最大5）"],
  "ai_actions_pending":  ["保留事項（最大3）"],
  "ai_actions_planned":  ["予定事項（最大3）"]
}
```

### 4.4 Supabase 側で保持している AI カラム（analyzer.js 931〜941 行より）

- `ai_review` / `ai_status`
- `ai_actions_decided` / `ai_actions_pending` / `ai_actions_planned`
- `ai_summary` / `ai_strengths` / `ai_challenges` / `ai_concerns` / `ai_next_actions`
- `ai_person_profile`

> 注: 上記のうち `ai_summary` 以降は過去仕様の残存カラム。現行プロンプトは返していないため UI 側で空扱い。

### 4.5 フロント側の利用箇所

- `js/analyzer.js`
  - AI 呼び出し: `fetch(\`${AI_API_BASE}/analyze\`)` / `fetch(\`${AI_API_BASE}/analyze/person\`)`
  - 描画: `ai_review` / `ai_status` などを `renderAiPersonResult` 系で表示
  - 保存: 上記カラムをそのまま Supabase に upsert

---

## 5. 変更点 — AI 解析の新仕様

### 5.1 目的 / 背景
- 現在の総評（`ai_review`）が長文一塊で読みにくい
- AI 解析結果と、その上に表示される「人物評価〜レコード本文」の内容が重複しており、画面が冗長
- → **AI 解析だけを見れば必要情報が揃う状態**にしたい

### 5.2 表示仕様の変更（フロント）

#### 5.2.1 個人ヘッダー直下の「集計レポート」ブロックを削除
- 月別 MT レコード（`renderTimelineCard`）は**そのまま残す**
- 削除対象は `meeting-analyzer.html` 1040〜1142 行付近、`renderPersonPanel` 系の以下ブロック
  | セクション見出し | 行 | 描画元データ |
  |---|---|---|
  | 人物評価・総合的な特徴 | 1040〜1046 | `personProfile` |
  | 変化・改善の軌跡 | 1050〜1072 | `changeTrack` |
  | 一貫して発揮されている特徴・強み / 繰り返し現れる課題 | 1074〜1095 | `persistentStrengths` / `persistentChallenges` |
  | 繰り返し指示・継続課題（定着確認が必要） | 1097〜1108 | `repeatedInstructions` |
  | 継続している取り組み | 1110〜1121 | `ongoingInitiatives` |
  | これからどうしていくか（今後の方針） | 1123〜1140 | `futureDirection` |
- 上記は「AI 総合分析」結果と内容が重複するため非表示化
- **DB / レコード処理はそのまま**（`buildPersonReport` などのロジックは PDF 出力で使用しているため関数は残す）
- `meeting-analyzer.html` 1038 行の `#aiPersonResult` と `AI総合分析` ボタンは残し、ここに結果を表示する

→ 同ブロック内の「繰り返し現れる課題」「繰り返し指示・継続課題」も削除対象に含める（確認済み）。

#### 5.2.2 AI 評価の読みやすさ改善
- **箇条書きを許可**（現行は「箇条書き禁止」）
- **改行で視覚的な区切り**を入れる
- **重要キーワードを色付きマーカー風にハイライト**（方式 = 2-a）
  - 対象キーワード例: 課題 / 強み / 懸念 / 改善 / 成長 / 停滞 / リスク など
  - 実装方針: AI 応答文中の該当語を正規表現で `<mark class="hl-xxx">` に包む
    - `hl-red`（課題・懸念・停滞・リスク）
    - `hl-green`（強み・改善・成長）
    - `hl-blue`（進行・状態）
    - `hl-gold`（アクション・決定事項）
  - ハイライト語のリストは `js/analyzer.js` 先頭付近で定数化し、追加・調整しやすくする
  - 既存 CSS `--c-red / --c-green / --c-blue / --c-gold` を流用し、`background` を薄く・`color` を濃く

### 5.3 入力
- 変更なし（`content_main` / `tasks_given` / `personal_issues` / `evaluation` / `target` / `sheet_name`）

### 5.4 新しい出力 JSON スキーマ（案）

```json
{
  "ai_review_sections": [
    { "heading": "課題",              "body": ["…", "…"] },
    { "heading": "状態",              "body": "進行中" },
    { "heading": "感情・モチベーション", "body": ["…"] },
    { "heading": "原因と結果",         "body": ["…"] }
  ],
  "ai_status": "進行中 | 停滞中 | 予定",
  "ai_actions_decided": ["…"],
  "ai_actions_pending": ["…"],
  "ai_actions_planned": ["…"]
}
```

- 既存の `ai_review`（単一文字列）は後方互換として併存させるか、`ai_review_sections` を JSON.stringify して `ai_review` に格納するかは実装時に決定
- アクション3種（decided / pending / planned）は現行維持

### 5.5 プロンプト方針
- ロール: 「人材育成の専門家」（現行維持）
- トーン: 端的、冗長さ排除
- **箇条書き可**（各項目は1〜3行 × 最大3〜5点）
- 禁止事項:
  - 前置き・自己紹介文
  - 同じ内容を別項目に繰り返し書くこと
  - 入力テキストの丸写し

### 5.6 単票（`/api/analyze`）と全体（`/api/analyze/person`）の差分
- 構造は同一（同じ `ai_review_sections` スキーマ）
- 全体分析のみ、セクションに「成長の軌跡」「改善傾向」「今後の展望」を追加
- 文量上限: 単票 全体で 600字程度 / 全体分析 900字程度（箇条書きの合計目安）

### 5.7 既存カラムの扱い
- 廃止: なし（DB は現行スキーマ維持）
- 継続: `ai_review` / `ai_status` / `ai_actions_*`
- 新規追加: `ai_review_sections`（JSON 文字列） — Supabase にカラム追加が必要
- 非使用の残存カラム（`ai_summary` / `ai_strengths` / `ai_challenges` / `ai_concerns` / `ai_next_actions` / `ai_person_profile`）は今回触らない

---

## 6. 影響範囲と想定変更ファイル

| 領域 | ファイル | 変更内容の想定 |
|---|---|---|
| API / プロンプト | `server.js`（92〜181 行） | プロンプト文・レスポンスキーの差し替え |
| フロント描画 | `js/analyzer.js`（931〜1260 行付近） | 受け取るキーの変更、表示ロジック、保存カラムの差し替え |
| PDF 出力 | `js/pdf-export.js` | 新キーに応じた章立て変更（必要なら） |
| DB スキーマ | Supabase `meeting_records` | カラム追加 / 廃止（要マイグレーション） |
| ドキュメント | `README.md` | 機能説明の更新 |

## 7. 作業手順

1. `git pull origin main` で最新化
2. ブランチ作成: `git switch -c lc/feature/ai-analysis-v2`
3. 上記 §5 の仕様を確定させ、本指示書を更新
4. `server.js` のプロンプト / レスポンスを差し替え（単票 → 全体の順）
5. `js/analyzer.js` の受け取り・描画・保存を新キーに合わせて修正
6. 必要なら Supabase スキーマに ALTER（確認を取ってから実行）
7. `js/pdf-export.js` / README を追随更新
8. Vercel プレビューデプロイで動作確認 → URL を共有
9. ユーザー承認後に main へ PR マージ

## 8. ブランチ / コミットルール（CLAUDE.md 準拠）

- 作業ブランチ: `lc/feature/ai-analysis-v2`（例）
- コミットメッセージ・コメントは日本語
- main への直 push・force push 禁止
- マージ済みブランチは削除

## 9. 未確定事項 / プレースホルダー

- §5 の全項目（ユーザー記入待ち）
- Supabase スキーマ変更の要否
- 既存レコードの再解析を行うか（バッチ再実行の必要性）

## 10. デプロイ影響

- フロント: Vercel の静的配信のみのため、main マージで自動反映
- API: VM 側 `server.js` の再起動が必要（プロンプト・スキーマ変更時）
- DB: カラム追加の場合、Supabase 側での ALTER と Vercel 環境変数の再確認
