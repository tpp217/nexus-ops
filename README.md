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

## ホスティング

GitHub Pages 対応。`main` ブランチを Pages に設定するだけで公開可能。

## ライセンス

Private
