# NEXUS OPS（nexus-ops）

店舗・スタッフ MTG 記録の分析プラットフォーム。Excel / ZIP から MTG 記録を取り込み、スタッフ別・店舗別に分析、PDF レポート出力。White × Neon Cyberpunk テーマ。

## 構成

```
nexus-ops/
├── index.html              # ダッシュボード（モジュール選択画面）
├── meeting-analyzer.html   # MODULE 001: MTG 記録分析
├── css/style.css           # White × Neon Cyberpunk
├── js/
│   ├── analyzer.js         # Excel パース + 分析エンジン
│   └── pdf-export.js       # jsPDF + html2canvas
├── api/                    # Vercel Functions（Supabase 連携）
├── server.js               # Express サーバー（ローカル/旧運用）
├── nexus-ops.db            # SQLite（旧データ、現状未使用想定）
├── docs/
├── package.json
└── vercel.json
```

## 技術スタック

- フロント: Vanilla HTML / CSS / JS
- Excel: SheetJS（XLSX） / ZIP: JSZip / PDF: jsPDF + html2canvas
- バックエンド: Express（`server.js`） + Supabase
- ホスティング: Vercel（フロントは静的、API は Functions）

## 開発コマンド

```bash
# ローカル開発（Doppler 経由）
npm run dev          # node --watch server.js
npm run start        # node server.js（dev config）
npm run start:prod   # 本番 config
```

※ ローカル dev はあまり起動しない方針。Vercel プレビューで確認。

## モジュール

- **MODULE 001 — 店舗 MT 記録分析**: `meeting-analyzer.html`。Excel または ZIP（複数ファイル）をアップロード → 店舗・スタッフ別に分析 → 月次/サマリー PDF 出力

## 注意事項

- **`nexus-ops.db`（SQLite）はリポジトリに残っているが現行は Supabase**: 削除候補だが既存データの参照に使う可能性があるため未削除
- **`server.js` は旧 Express 構成の名残**: 現行は Vercel Functions（`api/`）に寄せている。両方触る前にどちらが本番かを確認
- **Supabase 接続情報は Doppler `nexus-ops`**（`-c dev` / `-c prd`）
- **デザイン**: White × Neon は media-manager の Yellow と別系統。operation-hub の design-spec には準拠**しない**例外
- **iframe 埋め込み**: operation-hub から読まれる前提。CSP `frame-ancestors` を緩めておく

## デプロイ

- 本番: `https://nexus.utinc.dev`
- main マージで Vercel 自動デプロイ

Git / Supabase / Doppler / Vercel 運用はグローバル `~/.claude/CLAUDE.md` に準拠。

## TODO

- `nexus-ops.db` / `server.js` の役割明確化（残すか削除か）
- API ルートを `api/` 配下に統一
