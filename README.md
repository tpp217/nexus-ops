# NEXUS OPS

> 業務効率化システム — 店舗・スタッフ分析プラットフォーム

## 概要

NEXUS OPS は、店舗・スタッフの MTG（ミーティング）記録を Excel / ZIP ファイルからインポートし、AI で分析・可視化するウェブアプリです。

## 機能

- **MODULE 001 - 店舗 MT 記録分析**: Excel (.xlsx / .xls) または ZIP ファイルから MTG 記録を読み込み、スタッフ別・店舗別に分析
- **PDF エクスポート**: 月次レポートおよび総合サマリーレポートを PDF で出力
- **マルチパーソン対応**: 複数スタッフのデータを一括管理・比較

## ファイル構成

```
nexus-ops/
├── index.html              # ダッシュボード（モジュール選択画面）
├── meeting-analyzer.html   # MODULE 001: MTG 記録分析
├── css/
│   └── style.css           # 共通スタイル（White × Neon Cyberpunk テーマ）
└── js/
    ├── analyzer.js         # 分析エンジン（Excel パース・AI 分析）
    └── pdf-export.js       # PDF エクスポートエンジン
```

## 使い方

1. `index.html` をブラウザで開く
2. **MODULE 001 - 店舗 MT 記録分析** をクリック
3. Excel ファイル (.xlsx / .xls) または複数ファイルを含む ZIP をアップロード
4. **分析実行** ボタンをクリック
5. 店舗・スタッフ別の分析結果を確認

## 技術スタック

- **フロントエンド**: Vanilla HTML / CSS / JavaScript（フレームワーク不使用）
- **Excel 読み込み**: [SheetJS (XLSX)](https://sheetjs.com/)
- **ZIP 操作**: [JSZip](https://stuk.github.io/jszip/)
- **PDF 生成**: [jsPDF](https://parall.ax/products/jspdf/) + [html2canvas](https://html2canvas.hertzen.com/)
- **UI テーマ**: White × Neon Cyberpunk（カスタム CSS）

## 動作モード（プラットフォーム版 / 単体販売版）

env フラグ `STANDALONE` 1 本で 2 モードを住み分ける。**`STANDALONE` 未設定＝現状のプラットフォーム挙動を一切変えない**（完全後方互換）。

| 観点 | プラットフォーム版（既定・`STANDALONE` 未設定） | 単体版（`STANDALONE=true`） |
|---|---|---|
| ログイン | workspace-hub の SSO（LINE 統一） | アプリ自前ログイン（wh SSO へ飛ばさない）※ **未整備＝要実装** |
| 認証ゲート | wh JWT を JWKS 検証（監視 / enforce） | wh ゲートをスキップ（自前認証に委ねる） |
| データ範囲 | wh の所属（tenant_id クレーム） | 単一顧客＝固定テナント `STANDALONE_TENANT_ID` |

- 単体版では `api/_lib/auth-gate.js` の `evaluateAuth()` が wh JWT 検証をスキップし、`resolveTenant()` が `STANDALONE_TENANT_ID` を全データのスコープに使う（未設定だと fail-closed）。
- **重要**: nexus の単体版「自前ログイン UI」は現状未整備（要実装）。現フラグ ON で有効なのは「ゲートスキップ＋テナント固定＋再ログイン/ログアウト アイコン」まで。実際の単体運用にはログイン画面の実装が別途必要。
- 環境変数の詳細は `.env.example` を参照。

## ホスティング

GitHub Pages 対応。`main` ブランチを Pages に設定するだけで公開可能。

## ライセンス

Private
