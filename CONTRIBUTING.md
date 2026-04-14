# NEXUS OPS — 共同開発ガイド

## 開発拠点

| 拠点 | 担当 | ブランチプレフィックス |
|------|------|---------------------|
| Genspark VM | AI (Claw) | `gs/` |
| ローカル VSCode | 人間 (tpp217) | `lc/` |

**GitHub が唯一の真実。** push/pull で同期する。

---

## ブランチ命名規則

```
gs/<種別>/<内容>   例: gs/feature/add-monthly-chart
lc/<種別>/<内容>   例: lc/fix/pdf-export-bug
```

| 種別 | 用途 |
|------|------|
| `feature` | 新機能 |
| `fix` | バグ修正 |
| `refactor` | リファクタ |
| `chore` | 設定・依存関係など |
| `docs` | ドキュメント |

---

## 作業フロー

```bash
# 1. 最新を取得
git pull origin main

# 2. ブランチを切る
git checkout -b gs/feature/xxx

# 3. 編集 → コミット
git add .
git commit -m "feat: XXXを追加"

# 4. プッシュ
git push origin gs/feature/xxx

# 5. GitHub で PR を作成 → レビュー → main にマージ
# 6. マージ後ブランチを削除
```

**mainへの直接コミット禁止 / force push 禁止**

---

## アーキテクチャ（ハイブリッド構成）

```
ブラウザ (Vercel 配信)
  │
  ├─ 静的ファイル (HTML/CSS/JS)  ← Vercel CDN
  │
  ├─ /tables/*                   ← Vercel API Routes
  │     └─ api/tables/*.js       （Supabase 直接アクセス）
  │
  └─ /api/analyze*               ← VM サーバー (port 3100)
        └─ server.js             （gsk super_agent 実行）
```

### なぜハイブリッドか

`gsk task` はCLIコマンドの実行が必要なため、Vercelのサーバーレス環境では動かない。
そのため AI分析部分だけ VM に残し、静的ファイルと DB アクセスは Vercel に移行する。

---

## シークレット管理

| 環境 | 管理方法 |
|------|----------|
| VM 開発 | Doppler (`doppler run -- node server.js`) |
| Vercel 本番 | Vercel 環境変数 (Dashboard で設定) |
| ローカル開発 | `.env` (Git 除外) または Doppler |

### 必要な環境変数

| 変数名 | 用途 |
|--------|------|
| `SUPABASE_URL` | Supabase プロジェクト URL |
| `SUPABASE_SERVICE_KEY` | Supabase サービスキー (サーバーサイド専用) |
| `AI_API_URL` | Vercel から VM AI サーバーを指す URL (Vercel 環境変数のみ) |

### Doppler 設定

```bash
# VM で初回設定
doppler login
doppler setup   # project: nexus-ops, config: dev

# シークレット確認
doppler secrets get SUPABASE_URL -p nexus-ops -c dev --plain

# サーバー起動
doppler run -- node server.js
```

---

## URL 設計

| パス | 環境 | 処理 |
|------|------|------|
| `https://zvtfabus.gensparkclaw.com/nexus/*` | VM | Caddy → port 3100 |
| `https://nexus.utinc.dev/*` (予定) | Vercel | 静的 + API Routes |
| `http://localhost:3100/` | ローカル | VM直結 |

---

## フロントエンドの URL 切り替え

`js/analyzer.js` 内の `AI_API_BASE` は自動判定される:

- `localhost` / `127.0.0.1` → `/api`（VM直結）
- それ以外 → `https://zvtfabus.gensparkclaw.com/nexus/api`（本番VM）

`window.NEXUS_AI_API_URL` をセットすれば任意のURLに上書き可能（テスト用途など）。

---

## コミット規約

コミットメッセージ・コメント・変数名説明は**日本語**で書く。

```
feat: 月次チャートを追加
fix: PDFエクスポートの文字化けを修正
refactor: aiAnalyzeRecord を非同期に変更
chore: vercel.json を追加
docs: CONTRIBUTING.md を整備
```

---

## 実装報告フォーマット

PR やコミット説明には以下を含める:

1. **何を変えたか**
2. **なぜ変えたか**
3. **どのファイルを触ったか**
4. **未確定事項やプレースホルダー**
5. **デプロイ影響の有無**

---

## 禁止事項

- main への直接コミット
- force push
- `.env` のコミット
- APIキーのハードコード
