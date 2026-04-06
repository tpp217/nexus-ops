/**
 * NEXUS OPS – Meeting Analyzer Engine v3.0
 * カウンセラー型分析エンジン
 * ─ 過去→最新の変化軌跡
 * ─ 人物特徴・傾向を文章で生成
 * ─ 強み・弱み・懸念・指示を文脈から読み取る
 */

/* ─── Toast ─── */
function showToast(msg, type = 'info', duration = 3500) {
  let c = document.getElementById('toastContainer');
  if (!c) { c = document.createElement('div'); c.id='toastContainer'; c.className='toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg; c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(()=>t.remove(),350); }, duration);
}

/* ─── Parse Excel ─── */
async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try { resolve(XLSX.read(new Uint8Array(e.target.result), { type:'array', cellText:false, cellDates:true })); }
      catch(err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/* ─── Extract from sheet ─── */
function extractMeetingFromSheet(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return null;

  const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:false });
  if (!rows || rows.length < 2) return null;

  /* ──────────────────────────────────────────
     ① 全セルのテキストを「行インデックス付き」で収集
        ・長さ制限なし
        ・重複・空はスキップ
     ────────────────────────────────────────── */
  // セル単位で全テキスト取得（重複除外しない・順序保持）
  const cellTexts = []; // { r, c, text }
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const v = cleanCell(row[c]);
      if (v && v.length >= 1) cellTexts.push({ r, c, text: v });
    }
  }

  /* ──────────────────────────────────────────
     ② ヘッダー情報を全行からスキャン
        ラベルセルの「直後セル」または「同一セル内のコロン以降」
     ────────────────────────────────────────── */
  let dateRaw='', location='', reporter='', target='', duration='';

  // まず全行テキストを結合して日付を検索
  const fullText = cellTexts.map(c => c.text).join('\n');
  const dateMatcher = fullText.match(/(\d{4}[\/.\-年]\s*\d{1,2}[\/.\-月]\s*\d{1,2})/);
  if (dateMatcher) dateRaw = dateMatcher[1];

  // 各行をスキャンしてラベル→値を抽出
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const v = cleanCell(row[c]);
      if (!v) continue;
      // ラベル：場所/会場
      if (!location && /^(場所|会場)[：:＊]?$/.test(v)) {
        location = findNextValue(row, c) || '';
      }
      // ラベル：報告者
      if (!reporter && /^(報告者|作成者|記録者)[：:＊]?$/.test(v)) {
        reporter = findNextValue(row, c) || '';
      }
      // ラベル：対象
      if (!target && /^(対象|対象者|面談相手|氏名|名前)[：:＊]?$/.test(v)) {
        target = findNextValue(row, c) || '';
      }
      // ラベル：所要時間
      if (!duration && /^(所要時間|面談時間|時間)[：:＊]?$/.test(v)) {
        duration = findNextValue(row, c) || '';
      }
      // 「〇〇分」形式
      if (!duration && /^\d+\s*分$/.test(v)) {
        duration = v;
      }
    }
  }

  /* ──────────────────────────────────────────
     ③ セクション分割
        【重要】ラベル行の判定は「セル単体が完全一致」のみ
                本文テキスト内に「課題」「結果」が含まれていてもラベル扱いしない
     ────────────────────────────────────────── */
  // セクションラベル（完全一致または前後スペースのみ許容）
  const SECTION_DETECT = [
    { key: 'tasks',    pat: /^(ミーティング結果|面談結果|MTの結果|取り組んだこと|実施内容)$/ },
    { key: 'personal', pat: /^(その他[、,]?聞取り|その他聞取り|聞取り内容|聞き取り内容|その他|補足|個人的な状況)$/ },
    { key: 'eval',     pat: /^(備考|まとめ|総評|所感|コメント|総括|備考・まとめ|備考\/まとめ)$/ },
    { key: 'main',     pat: /^(ミーティング内容|面談内容|MTの内容|会議内容|議事内容|面談のテーマ|今日の議題)$/ },
  ];

  const sectionBuckets = { main:[], tasks:[], personal:[], eval:[] };
  let currentSection = 'main';

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    // 行内の各セルをチェック
    let sectionSwitched = false;
    for (let c = 0; c < row.length; c++) {
      const v = cleanCell(row[c]);
      if (!v) continue;
      for (const { key, pat } of SECTION_DETECT) {
        if (pat.test(v)) {
          currentSection = key;
          sectionSwitched = true;
          break;
        }
      }
      if (sectionSwitched) break;
    }
    if (sectionSwitched) continue; // ラベル行自体はスキップ

    // 通常の本文行：各セルを収集
    for (let c = 0; c < row.length; c++) {
      const v = cleanCell(row[c]);
      if (!v || v.length < 2) continue;
      // ヘッダー情報ラベルは除外
      if (/^(日付|場所|会場|報告者|作成者|対象|対象者|所要時間|面談時間)[：:＊]?$/.test(v)) continue;
      sectionBuckets[currentSection].push(v);
    }
  }

  /* ──────────────────────────────────────────
     ④ バケツを結合 → 各フィールドへ
     ────────────────────────────────────────── */
  const joinBucket = (arr) => {
    // 重複除外してから改行結合
    const seen = new Set();
    return arr.filter(t => {
      if (seen.has(t)) return false;
      seen.add(t); return true;
    }).join('\n').trim();
  };

  let mainContent    = joinBucket(sectionBuckets.main);
  let tasksGiven     = joinBucket(sectionBuckets.tasks);
  let personalIssues = joinBucket(sectionBuckets.personal);
  let evaluation     = joinBucket(sectionBuckets.eval);

  /* ──────────────────────────────────────────
     ⑤ フォールバック：セクション分類に失敗した場合
        → 全テキストをそのまま mainContent に入れる
     ────────────────────────────────────────── */
  const totalLen = (mainContent + tasksGiven + personalIssues + evaluation).length;
  if (totalLen < 30) {
    // 全セルテキストを強制収集（ヘッダー除く）
    const allText = cellTexts
      .map(c => c.text)
      .filter(t => t.length >= 2 && !/^(日付|場所|会場|報告者|作成者|対象|対象者|所要時間)[：:＊]?$/.test(t))
      .join('\n');
    mainContent = allText;
  }

  // それでも空なら失敗
  if (!mainContent && !tasksGiven && !personalIssues && !evaluation) return null;

  /* ──────────────────────────────────────────
     ⑥ 分析実行
     ────────────────────────────────────────── */
  const analysis = deepAnalyzeV3({
    mainContent, tasksGiven, personalIssues, evaluation,
    extraContent: '', sheetName
  });

  /* ──────────────────────────────────────────
     ⑦ 年月情報を確定
        sheet_name が「1月」「2月」のような月のみ表記の場合、
        date から年を補完して「YYYY年M月」形式に統一
     ────────────────────────────────────────── */
  let yearMonth = '';
  // dateRaw から年・月を抽出
  const ymFromDate = dateRaw ? dateRaw.match(/(\d{4})[\/.\-年]\s*(\d{1,2})[\/.\-月]?/) : null;
  if (ymFromDate) {
    yearMonth = `${ymFromDate[1]}年${parseInt(ymFromDate[2], 10)}月`;
  } else {
    // シート名から年月を取得（例: 「2025年1月」「2024.12」「12月」など）
    const ymFromSheet = sheetName.match(/(\d{4})[年\/.\-]?\s*(\d{1,2})[月]?/)
                     || sheetName.match(/^(\d{1,2})[月]$/);
    if (ymFromSheet) {
      if (ymFromSheet[2]) {
        yearMonth = `${ymFromSheet[1]}年${parseInt(ymFromSheet[2], 10)}月`;
      } else {
        // 月のみ（年不明）: 現在年を使用
        yearMonth = `${new Date().getFullYear()}年${parseInt(ymFromSheet[1], 10)}月`;
      }
    } else {
      yearMonth = sheetName; // そのまま使用
    }
  }

  return {
    sheet_name: sheetName,
    year_month: yearMonth,   // ★ 年月識別フィールド（年をまたぐ識別に使用）
    date: dateRaw || '',
    location: location || '',
    reporter: reporter || '',
    target: target || '',
    duration: duration || '',
    content_main:    mainContent,
    tasks_given:     tasksGiven,
    personal_issues: personalIssues,
    evaluation:      evaluation,
    strengths:       JSON.stringify(analysis.strengths),
    challenges:      JSON.stringify(analysis.challenges),
    concerns:        JSON.stringify(analysis.concerns),
    instructions:    JSON.stringify(analysis.instructions),
    progress:        JSON.stringify(analysis.progress),
    next_actions:    JSON.stringify(analysis.nextActions),
    characteristics: JSON.stringify(analysis.characteristics),
    initiatives:     JSON.stringify(analysis.initiatives),
    relations:       JSON.stringify(analysis.relations),
    growth_signals:  JSON.stringify(analysis.growthSignals),
    manager_actions: JSON.stringify(analysis.managerActions),
    period_summary:  JSON.stringify(analysis.periodSummary),
    raw_data: JSON.stringify({ mainContent, tasksGiven, personalIssues, evaluation })
  };
}

/* ─── 次のセルの値を取得 ─── */
function findNextValue(row, labelIdx) {
  for (let j = labelIdx + 1; j < row.length && j < labelIdx + 6; j++) {
    const v = cleanCell(row[j]);
    if (v && v.length >= 1 && !/^(日付|場所|会場|報告者|作成者|対象|所要時間)[：:]?$/.test(v)) return v;
  }
  return '';
}

/* ─── セル値クリーニング ─── */
function cleanCell(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toLocaleDateString('ja-JP');
  return String(v)
    .replace(/\u3000/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/* ─── ラベル後の値を抽出（後方互換） ─── */
function extractAfterLabel(row, labelPat) {
  for (let i = 0; i < row.length; i++) {
    const v = cleanCell(row[i]);
    if (labelPat.test(v)) {
      // ラベルセルの後のセルを探す
      for (let j = i + 1; j < row.length && j < i + 5; j++) {
        const next = cleanCell(row[j]);
        if (next && next.length >= 1 && !labelPat.test(next)) return next;
      }
      // ラベルと値が同一セルの場合
      const after = v.replace(labelPat, '').replace(/^[：:\s]+/, '').trim();
      if (after.length >= 1) return after;
    }
  }
  return '';
}

function getCellValue(rows, r, c) {
  if (!rows[r]) return null;
  const v = rows[r][c];
  if (v == null) return null;
  if (v instanceof Date) return v.toLocaleDateString('ja-JP');
  return String(v).trim() || null;
}

/* ══════════════════════════════════════════════════
   ★ コア分析エンジン v3.0
   カウンセラー型：文脈から人物像・変化・傾向を読む
══════════════════════════════════════════════════ */
function deepAnalyzeV3({ mainContent, tasksGiven, personalIssues, evaluation, extraContent, sheetName }) {
  const allText = [mainContent, tasksGiven, personalIssues, evaluation, extraContent].filter(Boolean).join('\n');
  const sentences = splitToSentences(allText);

  /* ────── A. 強み（発揮できているポジティブな能力・行動） ────── */
  const strengthPatterns = [
    /粘り強/,
    /接客.{0,20}(良|上手|得意|好評|高い|できて|している)/,
    /クレーム.{0,20}(対応|処理|解決|上手|得意)/,
    /フォロー.{0,20}(上手|得意|丁寧|良|できて)/,
    /(女性|お客|顧客).{0,20}(好かれ|信頼|安心|人気)/,
    /意欲(的|が高い|あり|がある|を持)/,
    /(すぐ|即|早く|すぐに).{0,15}(行動|取り掛か|着手|動い|実行)/,
    /積極(的|に)/,
    /(レベル|スキル|知識|経験|能力).{0,20}(高い|豊富|十分|問題なし|ある|持っ)/,
    /(得意|上手い|うまい).{0,15}(分野|業務|スキル|こと|な)/,
    /(成果|結果|効果).{0,20}(出|見|確認|あり|てきた|できた)/,
    /(素直|真面目|誠実|丁寧|几帳面|きちん)/,
    /(教え|育成|後輩|新人).{0,20}(上手|丁寧|積極|できて|対応)/,
    /写真.{0,20}(上手|技術|得意|成果|うまい|きれい)/,
    /(撮影|加工|編集).{0,20}(技術|問題なし|得意|成果|うまい)/,
    /問い合わせ.{0,15}(増|来た|上がっ)/,
    /(評価|信頼|好評).{0,20}(高い|受け|得|されて)/,
    /コミュニケーション.{0,20}(上手|得意|高い|とれて)/,
    /稼げ(て|るよう|てきた)/,
    /(頑張|努力|取り組).{0,15}(っている|んでいる|んでいた)/,
    /自ら.{0,15}(考え|動い|実行|提案)/,
    /しっかり.{0,15}(できて|やっ|こなし)/,
    /レベル.{0,15}(高い|十分|問題ない)/,
    /知識.{0,15}(十分|豊富|ある|あり)/,
    /経験.{0,15}(十分|豊富|ある|あり)/,
  ];

  /* ────── B. 課題・改善点 ────── */
  const challengePatterns = [
    /ミス.{0,20}(多|続|重|目立|ある|見られ|してしまう|が出|している)/,
    /(小さな|細か|些細な|ちょっとした).{0,10}ミス/,
    /(確認|チェック).{0,25}(不足|怠|漏|忘|できてい|していな|甘い)/,
    /(言葉|口調|言い方|物言い).{0,25}(強|荒|悪|きつい|問題|粗い|気になる)/,
    /(機嫌|気分).{0,25}(悪|左右|態度|出やすい|顔|波がある)/,
    /気分屋/,
    /(文句|愚痴).{0,25}(多|凄|目立|言っ|出る|こぼす|が出る)/,
    /マイペース/,
    /(正確さ|精度|丁寧さ|正確性).{0,25}(欠|低|課題|不足|改善|いまいち)/,
    /(報告|連絡|ホウレンソウ).{0,25}(遅|不足|忘|抜け|できてい|しない)/,
    /(口癖|癖|クセ).{0,25}(強|目立|気になる|直らない)/,
    /(場の雰囲気|空気|職場).{0,25}(悪|壊|影響|下げ|乱す)/,
    /(不満|摩擦|確執|軋轢)/,
    /(接客後|客電|電話後).{0,25}(文句|愚痴)/,
    /感情.{0,20}(コントロール|出やすい|態度|影響|抑えられ)/,
    /(できてい|できていな|不十分|不足している)/,
    /まだ.{0,15}(できてい|甘い|課題|直っていな)/,
    /直っていない|治っていない/,
    /(注意|指摘).{0,15}(しても|しているが|しているのに).{0,20}(直らない|変わらない|できない)/,
  ];

  /* ────── C. 懸念事項 ────── */
  const concernPatterns = [
    /(早番|遅番|スタッフ|同僚|メンバー).{0,25}(確執|摩擦|問題|関係|トラブル|険悪)/,
    /(先輩|同僚|上司|他のスタッフ).{0,25}(不満|問題|悪口|言っている|愚痴)/,
    /(口の利き方|口調|言葉|態度|物言い).{0,25}(問題|不満|気になる|荒い|強い|きつい)/,
    /周囲.{0,25}(影響|雰囲気|迷惑|悪影響|巻き込む)/,
    /ストレス.{0,25}(溜|発散|影響|状態|溜まっ)/,
    /(愚痴|不満|悪口).{0,25}(漏らす|出る|多い|言う|こぼす)/,
    /業務.{0,20}(負荷|偏り|集中|多い|片寄)/,
    /メンタル.{0,20}(不安|懸念|心配|状態|面)/,
    /懸念.{0,15}(あり|点|事項|される)/,
    /(周りへの|周囲への).{0,15}(影響|迷惑)/,
  ];

  /* ────── D. 指示事項 ────── */
  const instructionPatterns = [
    /テンプレ.{0,25}(作成|変更|改良|直し|作り|修正|作ってもらう)/,
    /写真.{0,25}(撮り直し|撮影|変更|改善|修正|見直し|撮って)/,
    /リスト.{0,25}(作成|作り|ピックアップ|出す)/,
    /(オファー|スカウト).{0,25}(テンプレ|文面|作成|修正|見直し)/,
    /宣材写真.{0,20}(撮り直し|変更|改善|作成|撮って)/,
    /(掘り起こし|休眠).{0,25}(連絡|対応|実施|してもらう)/,
    /遅番.{0,20}(業務|経験|入れ|対応|担当|させる|入らせ)/,
    /(報告|確認).{0,25}(徹底|習慣|意識|フロー|させる|するよう)/,
    /(面接|新人|採用).{0,25}(育成|対応|担当|同席|させ|任せ)/,
    /(課題|ミッション|宿題).{0,25}(与|設定|継続|実施|出した|渡した)/,
    /(意識付け|習慣化|癖付け).{0,25}(徹底|させ|続け|実施|していく)/,
    /(教育|指導|教え).{0,25}(展開|実施|担当|継続|させ|していく)/,
    /させていく|させている|やらせて/,
    /してもらうよう|してもらいたい|してほしい/,
    /するよう(に|伝え|指示|促)/,
    /引き続き.{0,15}(やらせ|させ|継続)/,
  ];

  /* ────── E. 進捗・改善状況 ────── */
  const progressPatterns = [
    /(改善|向上|良化).{0,25}(見られ|確認|している|てきた|した)/,
    /(多少|少し|徐々に|だいぶ|かなり|大分).{0,20}(改善|良くなっ|減っ|変わっ|できてきた)/,
    /(成果|結果|効果).{0,25}(出|見えて|確認|出てきた|が出た)/,
    /(ミス.{0,10}減|ミス.*少なく|ミス.*なくなっ)/,
    /問い合わせ.{0,20}(増|来た|上がっ|増えて|増加)/,
    /(稼げ|売上|収入|稼働).{0,20}(増|上がっ|伸び|増えた)/,
    /(意識|行動|姿勢).{0,20}(変わ|変化|改善|できてきた)/,
    /(以前より|前回より|前より|以前に比べ).{0,25}(良|改善|向上|できて|減っ)/,
    /(技術|スキル|能力).{0,25}(問題なし|向上|伸び|高まっ|上がっ)/,
    /継続.{0,20}(成果|結果|実施|できて|している)/,
    /できるよう(になっ|になってきた)/,
    /(写真|テンプレ|業務).{0,20}(効果|成果|結果).{0,15}(出|見え|あり)/,
    /上手(く|に).{0,15}(なっ|いっ|できて)/,
  ];

  /* ────── F. 成長の兆し・変化 ────── */
  const growthPatterns = [
    /(大分|かなり|随分).{0,25}(進|良くなっ|できて|成長|変わっ)/,
    /(多少|少し|徐々に).{0,25}(改善|変化|良くなっ|成長)/,
    /成果.{0,20}(出|見え|確認|てきた|が出た)/,
    /(以前|前回|前).{0,10}(より|に比べ).{0,25}(良|改善|成長|できて)/,
    /問い合わせ.{0,20}(増えて|増加|来るよう)/,
    /写真.{0,20}(変えて|撮り直し).{0,25}(成果|効果|出た|出てきた)/,
    /(伸び|成長|向上).{0,15}(てきた|している|が見られ|確認)/,
    /できるよう.{0,15}(になっ|なってきた)/,
    /(頑張|努力|取り組).{0,20}(の結果|って|んで).{0,10}(成果|改善|良くなっ)/,
  ];

  /* ────── G. 取り組み ────── */
  const initiativePatterns = [
    /テンプレ.{0,25}(作成|変更|改良|作り直し|修正|作った|変えた)/,
    /写真.{0,25}(撮り直し|撮影|変更|改善|した|撮った|変えた)/,
    /リスト.{0,25}(作成|作り|ピックアップ|作った)/,
    /(オファー|スカウト).{0,25}(テンプレ|文面|変更|作成|した|変えた)/,
    /宣材写真.{0,25}(撮り直し|変更|撮った)/,
    /(掘り起こし|休眠).{0,25}(連絡|対応|実施|した|している)/,
    /遅番.{0,20}(業務|経験|入れ|対応|入った|している)/,
    /(報告|確認).{0,25}(習慣|意識|徹底|するよう|できている)/,
    /(面接|新人|採用).{0,25}(育成|対応|担当|した|している)/,
    /(動画|加工|修正|編集).{0,25}(作成|実施|した|している)/,
    /(実施|取り組|対応|実行|やって).{0,15}(した|している|できた|きた)/,
  ];

  /* ────── H. 対人関係 ────── */
  const relationPatterns = [
    /(早番|遅番|スタッフ|同僚|メンバー).{0,30}(確執|摩擦|関係|問題|トラブル|揉め)/,
    /(先輩|同僚|メンバー).{0,30}(不満|問題|言っている|愚痴|悪口)/,
    /(関係|雰囲気|仲).{0,25}(改善|解消|良くなっ|修復|落ち着い)/,
    /(本音|悩み|困り|不安).{0,25}(話|聞|引き出|してくれた)/,
    /言いづら.{0,20}(聞き出|引き出|確認)/,
    /(一緒に|協力|うまく).{0,20}(働い|やっ|いっ)/,
  ];

  /* ────── I. 管理者の対応・指示 ────── */
  const managerPatterns = [
    /私が.{0,25}(確認|チェック|手伝|作り直|指示|伝え|フォロー)/,
    /(注意|フィードバック|指摘).{0,25}(伝|話|した|しました|している)/,
    /(経験|仕事|業務|機会).{0,25}(させ|振り|与え|作っ)/,
    /(今後|これから).{0,25}(指導|育成|進め|確認|フォロー)/,
    /(確認|報告).{0,25}(させ|徹底|義務|するよう)/,
    /(癖付け|習慣|意識付け).{0,25}(徹底|させ|させていく|していく)/,
    /声かけ.{0,20}(する|して|継続|していく|していきたい)/,
    /引き続き.{0,20}(確認|フォロー|見て|支援|様子を)/,
    /私から.{0,20}(伝え|指示|フォロー|確認)/,
  ];

  /* ────── J. 次回アクション ────── */
  const actionPatterns = [
    /引き続き.{0,25}(やらせ|継続|実施|確認|観察|フォロー|させ)/,
    /今後.{0,25}(指導|育成|経験させ|確認|進め|フォロー|させていく)/,
    /(ミッション|課題|宿題|タスク).{0,25}(継続|続け|実施|与え|出す)/,
    /(意識付け|習慣).{0,25}(徹底|させ|続け|していく|促す)/,
    /(振り分け|仕事|業務|担当).{0,25}(必要|検討|増やす|任せる)/,
    /(教え|底上げ|指導|育成).{0,25}(必要|していく|続け|強化)/,
    /(次回|今後|次のMT).{0,25}(確認|チェック|見て|フォロー|話す)/,
    /(修正|改良|見直し).{0,20}(加え|して|する|いく)/,
    /(伸ばし|強化|磨い).{0,20}(ていき|たい|いく|いきたい)/,
    /継続して.{0,20}(観察|確認|フォロー|様子を)/,
    /(引き受け|担当|任せ).{0,20}(てもらう|させる|予定)/,
  ];

  // マッチング実行（取得上限を増やす）
  const strengths      = matchSentences(sentences, strengthPatterns, 8);
  const challenges     = matchSentences(sentences, challengePatterns, 8);
  const concerns       = matchSentences(sentences, concernPatterns, 6);
  const instructions   = matchSentences(sentences, instructionPatterns, 8);
  const progress       = matchSentences(sentences, progressPatterns, 6);
  const initiatives    = matchSentences(sentences, initiativePatterns, 6);
  const relations      = matchSentences(sentences, relationPatterns, 4);
  const managerActions = matchSentences(sentences, managerPatterns, 5);
  const growthSignals  = matchSentences(sentences, growthPatterns, 5);
  const nextActions    = matchSentences(sentences, actionPatterns, 6);

  // 特徴・傾向サマリー（文章）
  const characteristics = buildCharacteristicsV3(allText, { strengths, challenges, concerns, growthSignals, initiatives });

  // この月のサマリー文（3行程度）
  const periodSummary = buildPeriodSummary(allText, { strengths, challenges, progress, instructions });

  return {
    strengths, challenges, concerns, instructions, progress,
    initiatives, relations, managerActions, growthSignals,
    characteristics, nextActions, periodSummary
  };
}

/* ─── 文分割 ─── */
function splitToSentences(text) {
  if (!text) return [];
  // 改行・句点・読点で分割
  const raw = text
    .split(/[\n。！？、]/)
    .map(s => s.replace(/^[・\s　▲▼→■□●◆◇※\-・＊✓✔◉①②③④⑤]+/, '').trim())
    .filter(s => s.length >= 5 && s.length <= 300);

  // 短すぎる断片は前後の文と結合して文脈を保持
  const merged = [];
  let buf = '';
  for (const s of raw) {
    if (s.length < 10 && buf) {
      buf += '、' + s;
    } else {
      if (buf) merged.push(buf);
      buf = s;
    }
  }
  if (buf) merged.push(buf);
  return merged.filter(s => s.length >= 5);
}

/* ─── パターンマッチして文を抽出（重複排除） ─── */
function matchSentences(sentences, patterns, max) {
  const results = [];
  const seen = new Set();
  for (const s of sentences) {
    if (results.length >= max) break;
    for (const pat of patterns) {
      if (pat.test(s)) {
        const key = s.substring(0, 40);
        if (!seen.has(key)) {
          seen.add(key);
          results.push(s.length > 160 ? s.substring(0, 158) + '…' : s);
        }
        break;
      }
    }
  }
  return results;
}

/* ─── 特徴・傾向の文章サマリーを生成（カウンセラー視点） ─── */
function buildCharacteristicsV3(text, { strengths, challenges, concerns, growthSignals, initiatives }) {
  const lines = [];

  // ──── 仕事への姿勢・行動特性 ────
  if (/すぐ(行動|取り掛か|着手)|積極(的|に)/.test(text))
    lines.push('指示に対して素早く行動に移せるタイプ。取り掛かりの速さと実行力が特長で、課題を与えられると動き出しが早い。');
  else if (/黙々|コツコツ|地道/.test(text))
    lines.push('目立たなくても黙々と業務をこなすタイプ。継続力があり、長期的な取り組みに強みを発揮する。');

  if (/意欲(的|が高い|あり)|やる気/.test(text))
    lines.push('業務への取り組み姿勢が意欲的で、成果が出るとさらに積極性が増す傾向がある。具体的なミッションを渡した時に力を発揮しやすい。');

  // ──── 対人スキル ────
  if (/接客.{0,15}(良|上手|得意)|クレーム対応/.test(text))
    lines.push('対人スキルが高く、特に接客・クレーム対応において安定した強みを発揮している。対外対応においては信頼を得ている。');

  if (/(女性|お客).{0,15}(好かれ|信頼)|フォロー.{0,15}(上手|得意)/.test(text))
    lines.push('女性顧客や相手への丁寧なフォローが得意で、関係構築力が高い。現場での対人評価が安定している。');

  // ──── 専門スキル ────
  if (/写真|撮影|加工/.test(text))
    lines.push('写真撮影・加工などビジュアル系の業務を得意とし、実際の成果（問い合わせ増加など）に直結している専門性を持つ。');

  if (/テンプレ|オファー文面/.test(text))
    lines.push('求人テンプレート・オファー文面の作成・改良を積極的に実施し、業務改善に貢献している。');

  // ──── 課題の傾向 ────
  if (/ミス.{0,10}(多|続|重)|小さな.*ミス/.test(text))
    lines.push('細かいミスが継続的な課題として挙がっている。スピードと実行力がある反面、正確さより先に動いてしまう傾向があり、確認作業の仕組み化が改善の鍵となる。');

  if (/(言葉|口調).{0,15}(強|きつい)|(口癖|癖).{0,15}(強|目立)/.test(text))
    lines.push('発言の口調・言葉の強さが周囲の雰囲気に影響を与えることがある。対外対応では信頼を得ているだけに、内部コミュニケーションの粗さがギャップとして残っている。');

  if (/(機嫌|気分).{0,15}(悪|左右)|感情.{0,10}出やすい/.test(text))
    lines.push('感情が態度に出やすい面があり、職場の雰囲気への影響が懸念される。ストレス発散の仕方にも課題があり、安定したパフォーマンスを発揮するためのコンディション管理が重要。');

  // ──── 成長・変化 ────
  if (growthSignals.length > 0)
    lines.push('前回・過去との比較で改善・成長が確認できる部分がある。継続的な意識付けとフォローが変化を後押ししている。');

  // ──── 取り組み ────
  if (initiatives.length >= 2)
    lines.push(`複数の具体的な取り組み（${initiatives.length}件）を主体的に実施しており、指示を受けてからの行動力は高い。`);

  // フォールバック
  if (lines.length === 0)
    lines.push('議事録のテキストから特徴・傾向を抽出しています。複数回分のMTデータが揃うとより詳細な分析が可能になります。');

  return lines;
}

/* ─── この月のサマリー文（要約）─── */
function buildPeriodSummary(text, { strengths, challenges, progress, instructions }) {
  const lines = [];

  // ── 強みから抽出（先頭1件）
  if (strengths.length > 0) {
    const s = strengths[0];
    lines.push(`【強み】${s.length > 60 ? s.substring(0, 58) + '…' : s}`);
  }

  // ── 指示・課題から抽出（先頭1件）
  if (instructions.length > 0) {
    const i = instructions[0];
    lines.push(`【指示】${i.length > 60 ? i.substring(0, 58) + '…' : i}`);
  }

  // ── 進捗から抽出（先頭1件）
  if (progress.length > 0) {
    const p = progress[0];
    lines.push(`【進捗】${p.length > 60 ? p.substring(0, 58) + '…' : p}`);
  }

  // ── 課題から抽出（先頭1件）
  if (challenges.length > 0) {
    const c = challenges[0];
    lines.push(`【課題】${c.length > 60 ? c.substring(0, 58) + '…' : c}`);
  }

  // ── キーワードベースの補足
  if (lines.length < 2) {
    if (/宣材写真|撮り直し/.test(text))   lines.push('宣材写真の撮り直し・改善が主要テーマとして取り組まれた。');
    if (/テンプレ|オファー文面/.test(text)) lines.push('オファー・スカウトのテンプレート作成・改良が実施された。');
    if (/報告.*確認|確認.*習慣/.test(text)) lines.push('報告前確認の習慣化が指導・意識付けされている。');
    if (/遅番/.test(text))                 lines.push('遅番業務の経験・習得が課題として設定された。');
    if (/(面接|新人).*(育成|対応)/.test(text)) lines.push('面接対応・新人育成への関与が進んでいる。');
    if (/(多少|少し|だいぶ).*改善|成果.*出/.test(text)) lines.push('取り組みの成果・改善の兆しが確認された。');
    if (/ミス|確認.*不足/.test(text))      lines.push('ミス・確認不足が継続課題として残っている。');
  }

  // フォールバック（それでも空なら汎用文）
  if (lines.length === 0)
    lines.push('面談にて現状確認と次回アクションの設定が行われた。');

  return lines.slice(0, 4);
}

/* ══════════════════════════════════════════════════
   ★ 複数MT横断レポート（個人全体サマリー）
   過去 → 最新の変化軌跡、特徴の一貫性、継続課題
══════════════════════════════════════════════════ */
function buildPersonReport(records) {
  if (!records || records.length === 0) return null;

  const allData = records.map(r => ({
    sheet:    r.sheet_name || '--',
    date:     r.date || '',
    str:      tryParse(r.strengths, []),
    cha:      tryParse(r.challenges, []),
    con:      tryParse(r.concerns, []),
    ins:      tryParse(r.instructions, []),
    pro:      tryParse(r.progress, []),
    ini:      tryParse(r.initiatives, []),
    gro:      tryParse(r.growth_signals, []),
    mgr:      tryParse(r.manager_actions, []),
    chars:    tryParse(r.characteristics, []),
    acts:     tryParse(r.next_actions, []),
    summary:  tryParse(r.period_summary, []),
    content:  [r.content_main, r.tasks_given, r.personal_issues, r.evaluation].filter(Boolean).join(' ')
  }));

  // 期間ラベル
  const firstDate = allData[0]?.sheet;
  const lastDate  = allData[allData.length - 1]?.sheet;

  // ── 継続して発揮されている特徴・強み ──
  const persistentStrengths = findPersistentItems(allData.map(d => d.str), 2);

  // ── 継続している課題 ──
  const persistentChallenges = findPersistentItems(allData.map(d => d.cha), 2);

  // ── 繰り返し指示されている事項 ──
  const repeatedInstructions = findPersistentItems(allData.map(d => d.ins), 2);

  // ── 継続している取り組み ──
  const ongoingInitiatives = findPersistentItems(allData.map(d => d.ini), 2);

  // ── 変化の軌跡（過去→最新） ──
  const changeTrack = buildChangeTrackV3(allData);

  // ── 総合的な人物評価 ──
  const personProfile = buildPersonProfile(allData, {
    persistentStrengths, persistentChallenges, changeTrack, repeatedInstructions
  });

  // ── これからどうしていくか（今後の方針） ──
  const futureDirection = buildFutureDirection(allData, { persistentStrengths, persistentChallenges, changeTrack });

  return {
    firstDate, lastDate,
    totalRecords: records.length,
    persistentStrengths, persistentChallenges,
    repeatedInstructions, ongoingInitiatives,
    changeTrack, personProfile, futureDirection
  };
}

/* ─── 共通項目を抽出（minCount回以上出現） ─── */
function findPersistentItems(arraysOfItems, minCount = 2) {
  const keyMap = new Map();
  const kwExtract = str => str.replace(/[。、\s]/g, '').substring(0, 18);

  arraysOfItems.forEach((items, idx) => {
    (items || []).forEach(item => {
      const kw = kwExtract(item);
      if (!keyMap.has(kw)) keyMap.set(kw, { text: item, count: 0, idxs: [] });
      const entry = keyMap.get(kw);
      if (!entry.idxs.includes(idx)) { entry.count++; entry.idxs.push(idx); }
    });
  });

  return [...keyMap.values()]
    .filter(e => e.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map(e => ({ text: e.text, count: e.count }));
}

/* ─── 変化の軌跡を構築（過去→最新の時系列） ─── */
function buildChangeTrackV3(allData) {
  const track = [];
  if (allData.length < 2) return track;

  const first = allData[0];
  const last  = allData[allData.length - 1];

  // 全期間通した変化
  const firstText = first.content;
  const lastText  = last.content;

  // ミスの変化
  if (/ミス.{0,10}(多|続|重)|小さな.*ミス/.test(firstText)) {
    if (/(ミス|ミス).{0,10}(減|少なくなっ|改善)/.test(lastText) || /(多少|少し).*改善/.test(lastText))
      track.push({ type:'improved', text:'細かいミスの頻度が減少傾向にある。継続的な意識付けの成果が見られる。', from: first.sheet, to: last.sheet });
    else
      track.push({ type:'ongoing', text:'細かいミスは継続課題として残っている。仕組みによる改善が引き続き必要。', from: first.sheet, to: last.sheet });
  }

  // 関係性の変化
  if (/(確執|摩擦)/.test(firstText)) {
    if (/(解消|改善|良くなっ|上手くやっ)/.test(lastText))
      track.push({ type:'improved', text:'スタッフ間の確執・摩擦が解消方向に改善された。', from: first.sheet, to: last.sheet });
    else
      track.push({ type:'ongoing', text:'スタッフ間の関係性については引き続き注意が必要。', from: first.sheet, to: last.sheet });
  }

  // 取り組みの成果
  if (/(テンプレ.*作成|写真.*撮り直し)/.test(firstText) && /(問い合わせ.*増|成果|稼げ)/.test(lastText))
    track.push({ type:'result', text:'取り組み（テンプレ改善・写真撮り直し等）が実際の成果（問い合わせ増加・稼働向上）につながった。', from: first.sheet, to: last.sheet });

  // 各MT間の変化を追跡
  for (let i = 1; i < allData.length; i++) {
    const prev = allData[i - 1];
    const curr = allData[i];
    const prevText = prev.content;
    const currText = curr.content;

    if (/(大分|かなり).*進/.test(currText) && /写真|撮り直し/.test(currText))
      track.push({ type:'progress', text:`写真撮り直しが大幅に進捗し、具体的な成果が現れ始めた。`, from: prev.sheet, to: curr.sheet });

    if (/(報告.*確認|確認.*習慣)/.test(currText) && /(多少|改善.*見られ)/.test(currText))
      track.push({ type:'improved', text:`報告・確認の習慣に改善の兆しが見られた。`, from: prev.sheet, to: curr.sheet });

    if (/(問い合わせ.*増|稼げ.*増)/.test(currText) && !/(問い合わせ.*増|稼げ.*増)/.test(prevText))
      track.push({ type:'result', text:`具体的な成果（問い合わせ増・稼働向上）が初めて確認された期間。`, from: prev.sheet, to: curr.sheet });

    if (/言葉.{0,10}強/.test(prevText) && !(/言葉.{0,10}強/.test(currText)))
      track.push({ type:'improved', text:`言葉の強さに関する指摘が減少、改善が見られた。`, from: prev.sheet, to: curr.sheet });
  }

  // 重複を除いてスライス
  const seen = new Set();
  return track.filter(t => {
    const key = t.text.substring(0, 30);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 7);
}

/* ─── 総合的な人物評価（カウンセラー視点の文章） ─── */
function buildPersonProfile(allData, { persistentStrengths, persistentChallenges, changeTrack, repeatedInstructions }) {
  const allContent = allData.map(d => d.content).join(' ');
  const lines = [];

  // 人物タイプ
  const actionable = /(すぐ行動|積極的|即.*着手)/.test(allContent);
  const steady     = /(黙々|コツコツ|地道)/.test(allContent);
  const motivated  = /(意欲的|やる気|熱心)/.test(allContent);

  if (actionable && motivated)
    lines.push('意欲が高く、課題を与えられるとすぐ行動に移せる実務型の人材。具体的なミッションを渡した時に最も力を発揮するタイプ。');
  else if (steady)
    lines.push('目立たなくても地道に業務をこなすタイプ。継続力があり、長期的な取り組みを任せられる安定感がある。');

  // 対外 vs 対内のギャップ
  const goodExternal = /(接客|クレーム対応|女性.*信頼)/.test(allContent);
  const poorInternal = /(言葉.*強|文句.*多|愚痴|不満.*態度)/.test(allContent);
  if (goodExternal && poorInternal)
    lines.push('対外対応（接客・クレーム対応）では高い信頼を得ているが、内部コミュニケーションでは言葉の強さや不満の出し方に粗さが残る。このギャップが今後の評価を左右するポイント。');
  else if (goodExternal)
    lines.push('対人スキルが高く、接客・クレーム対応・女性フォローにおいて安定した成果を出している。現場での信頼度が高い。');

  // 専門性
  if (/写真|撮影|加工/.test(allContent))
    lines.push('写真撮影・加工分野での専門性が高く、実際の成果（問い合わせ増加等）に直結する具体的な強みとして機能している。');

  // 成長フェーズの判断
  const improved = changeTrack.filter(t => t.type === 'improved' || t.type === 'result');
  const ongoing  = changeTrack.filter(t => t.type === 'ongoing');
  if (improved.length > 0 && allData.length >= 3)
    lines.push(`全${allData.length}回の面談を通じて、「課題を与えられる段階」から「実行して成果を出し始める段階」へ明確に進んでいる。今後は安定性と周囲への波及力が問われる段階。`);

  if (ongoing.length > 0)
    lines.push(`一方で、${ongoing.length}件の課題は継続中。気合いによる改善より、仕組みによる定着が効果的。`);

  // 繰り返し指示
  if (repeatedInstructions.length > 0)
    lines.push(`「${repeatedInstructions[0]?.text?.substring(0, 25)}」など、複数回にわたって同様の指示が出ており、定着に時間がかかっている部分がある。`);

  if (lines.length === 0)
    lines.push('複数回の面談データを元に、個人の特徴・傾向・成長変化を総合的に分析しています。');

  return lines;
}

/* ─── これからどうしていくか（今後の方針） ─── */
function buildFutureDirection(allData, { persistentStrengths, persistentChallenges, changeTrack }) {
  const allContent = allData.map(d => d.content).join(' ');
  const lines = [];

  if (/写真|撮影|加工|接客|クレーム/.test(allContent))
    lines.push('【強みを武器に】写真撮影・加工や接客対応など、すでに成果が出ている分野をさらに明確な「主戦力領域」として位置づけ、本人の自信と役割定義につなげる。');

  if (/(ミス|確認不足|報告.*不足)/.test(allContent))
    lines.push('【弱みは仕組みで潰す】ミスや確認不足は気合いではなく、報告前チェック項目・完了報告テンプレ・確認フローの固定化など、本人の意識に頼らない仕組みで対処する。');

  if (/(言葉.*強|文句.*多|愚痴|不満.*態度)/.test(allContent))
    lines.push('【コミュニケーション面は早めに矯正】能力が高い人ほど言葉の強さや不満の出し方が組織に影響しやすい。今後、他スタッフへ教える立場を見据えるなら、対外対応の良さを内向きにも再現できるかが重要。');

  if (/(面接|育成|教育|後輩)/.test(allContent))
    lines.push('【任せる範囲を広げるなら精度と再現性をセット】すでに面接・新人育成に関与しているため、今後は仕事量を増やすだけでなく、安定して回せるか・他者に教えられるかを評価軸にする。');

  if (lines.length < 2)
    lines.push('【継続的な意識付け】現状の取り組みを継続し、定期的なフォローアップを通じて成長を後押しする。');

  return lines;
}

/* ─── API CRUD ─── */
async function saveMeetingRecord(record) {
  try {
    const res0 = await fetch('tables/meeting_records?limit=200');
    if (res0.ok) {
      const d = await res0.json();
      const existing = (d.data || []).find(r =>
        r.sheet_name === record.sheet_name && r.source_file === record.source_file
      );
      if (existing) {
        const r = await fetch(`tables/meeting_records/${existing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record)
        });
        return await r.json();
      }
    }
    const r = await fetch('tables/meeting_records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record)
    });
    return await r.json();
  } catch(e) { console.error(e); return null; }
}

async function loadMeetingRecords() {
  try {
    const r = await fetch('tables/meeting_records?limit=300');
    if (!r.ok) return [];
    const d = await r.json();
    return (d.data || []).sort((a, b) => {
      // year_month（例:「2025年1月」）があればそれで比較、なければ date → sheet_name
      const parseYM = rec => {
        if (rec.year_month) {
          const m = rec.year_month.match(/(\d{4})年(\d{1,2})月/);
          if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, 1).getTime();
        }
        const s = String(rec.date || rec.sheet_name || '0').replace(/年/g,'-').replace(/月/g,'-').replace(/日/g,'').replace(/\//g,'-');
        const d = new Date(s);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };
      return parseYM(a) - parseYM(b);
    });
  } catch { return []; }
}

async function deleteMeetingRecord(id) {
  try { await fetch(`tables/meeting_records/${id}`, { method: 'DELETE' }); } catch {}
}

/* ─── formatDate ─── */
function formatDate(s) {
  if (!s) return '--';
  try {
    const d = new Date(String(s).replace(/\//g, '-'));
    if (isNaN(d.getTime())) return s;
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  } catch { return s; }
}

/* ─── renderTimelineCard（月別カード） ─── */
function renderTimelineCard(record, index) {
  const strengths      = tryParse(record.strengths, []);
  const challenges     = tryParse(record.challenges, []);
  const concerns       = tryParse(record.concerns, []);
  const instructions   = tryParse(record.instructions, []);
  const progress       = tryParse(record.progress, []);
  const initiatives    = tryParse(record.initiatives, []);
  const relations      = tryParse(record.relations, []);
  const managerActions = tryParse(record.manager_actions, []);
  const growthSignals  = tryParse(record.growth_signals, []);
  const characteristics= tryParse(record.characteristics, []);
  const nextActions    = tryParse(record.next_actions, []);
  const periodSummary  = tryParse(record.period_summary, []);

  const colorClass = ['c0','c1','c2'][index % 3];
  const colorName  = ['blue','green','gold'][index % 3];

  const src = record.source_file
    ? `<span class="tc-source-file"><i class="fa-solid fa-file"></i> ${escHtml(record.source_file)}</span>` : '';

  const hasAnalysis = strengths.length || challenges.length || concerns.length || growthSignals.length;
  const hasTask     = instructions.length || progress.length || initiatives.length;
  const hasContext  = relations.length || managerActions.length || record.personal_issues;
  const hasAction   = nextActions.length;

  // 年月バッジ: year_month があればそれを優先、なければ sheet_name
  const ymLabel = record.year_month || record.sheet_name || '--';

  // AI分析フィールド
  const aiReview          = record.ai_review || '';
  const aiStatus          = record.ai_status || '';
  const aiActionsDecided  = tryParse(record.ai_actions_decided, []);
  const aiActionsPending  = tryParse(record.ai_actions_pending, []);
  const aiActionsPlanned  = tryParse(record.ai_actions_planned, []);
  const aiSummary         = record.ai_summary || '';
  const aiStrengths       = tryParse(record.ai_strengths, []);
  const aiChallenges      = tryParse(record.ai_challenges, []);
  const aiConcerns        = tryParse(record.ai_concerns, []);
  const aiNextActions     = tryParse(record.ai_next_actions, []);
  const aiProfile         = record.ai_person_profile || '';
  const hasAiData         = !!(aiReview || aiSummary || aiStrengths.length);

  return `
  <div class="tc-card hud-panel ${colorName} anim-fade-in" style="animation-delay:${index * 0.05}s" data-id="${record.id || ''}" data-record="${encodeURIComponent(JSON.stringify({content_main:record.content_main||'',tasks_given:record.tasks_given||'',personal_issues:record.personal_issues||'',evaluation:record.evaluation||'',target:record.target||'',sheet_name:record.sheet_name||''}))}">
    <div class="tc-card-header">
      <div class="tc-header-left">
        <span class="tc-sheet-badge ${colorClass}">${escHtml(ymLabel)}</span>
        <span class="tc-date-info"><i class="fa-solid fa-calendar-days"></i> ${formatDate(record.date)}</span>
        <div class="tc-persons">
          <i class="fa-solid fa-user-tie"></i>${escHtml(record.reporter || '--')}
          <span class="tc-person-sep">→</span>
          <i class="fa-solid fa-user"></i>${escHtml(record.target || '--')}
        </div>
        ${record.duration ? `<span class="tc-duration"><i class="fa-solid fa-clock"></i>${escHtml(record.duration)}</span>` : ''}
        ${src}
      </div>
      <div class="tc-header-right">
        <button class="btn-icon tc-delete-btn" data-id="${record.id || ''}" title="削除" onclick="event.stopPropagation()">
          <i class="fa-solid fa-xmark"></i>
        </button>
        <i class="fa-solid fa-chevron-down tc-toggle-icon"></i>
      </div>
    </div>

    <div class="tc-body">
      <!-- 今月の要点（3行サマリー） -->
      ${periodSummary.length ? `
      <div class="period-summary-bar">
        <span class="psb-label"><i class="fa-solid fa-bolt"></i> 今月の要点</span>
        <div class="psb-lines">
          ${periodSummary.map(l => `<span class="psb-line">${escHtml(l)}</span>`).join('')}
        </div>
      </div>` : ''}

      <div class="tc-tabs">
        <button class="tc-tab active" data-tab="content">📋 議事内容</button>
        ${hasAnalysis ? `<button class="tc-tab" data-tab="analysis">🔍 傾向分析</button>` : ''}
        ${hasTask     ? `<button class="tc-tab" data-tab="tasks">📌 指示・進捗</button>` : ''}
        ${hasContext  ? `<button class="tc-tab" data-tab="context">🧩 背景・対応</button>` : ''}
        ${hasAction   ? `<button class="tc-tab" data-tab="actions">▶ 次回アクション</button>` : ''}
        <button class="tc-tab" data-tab="ai">✨ AI分析</button>
      </div>

      <!-- 議事内容 -->
      <div class="tc-tab-panel active" data-panel="content">
        ${record.content_main ? `
        <div class="tc-section">
          <div class="section-title blue"><i class="fa-solid fa-file-lines"></i> ミーティング内容</div>
          <div class="tc-text">${formatBullets(record.content_main)}</div>
        </div>` : ''}
        ${record.tasks_given ? `
        <div class="tc-section">
          <div class="section-title gold"><i class="fa-solid fa-list-check"></i> ミーティング結果・取り組み</div>
          <div class="tc-text">${formatBullets(record.tasks_given)}</div>
        </div>` : ''}
        ${record.personal_issues ? `
        <div class="tc-section">
          <div class="section-title green"><i class="fa-solid fa-comments"></i> その他・聞取り内容</div>
          <div class="tc-text">${formatBullets(record.personal_issues)}</div>
        </div>` : ''}
        ${record.evaluation ? `
        <div class="tc-section">
          <div class="section-title blue"><i class="fa-solid fa-star-half-stroke"></i> 備考・総評</div>
          <div class="tc-text">${formatBullets(record.evaluation)}</div>
        </div>` : ''}
        ${!record.content_main && !record.tasks_given && !record.personal_issues && !record.evaluation
          ? `<div class="tc-empty">// テキストデータなし（再読み込みしてください）</div>` : ''}
      </div>

      <!-- 傾向分析 -->
      ${hasAnalysis ? `
      <div class="tc-tab-panel" data-panel="analysis">
        ${characteristics.length ? `
        <div class="tc-section">
          <div class="section-title blue"><i class="fa-solid fa-fingerprint"></i> 特徴・傾向</div>
          <div class="analysis-prose">
            ${characteristics.map(c => `<div class="prose-item prose-blue">${escHtml(c)}</div>`).join('')}
          </div>
        </div>` : ''}
        ${strengths.length ? `
        <div class="tc-section">
          <div class="section-title green"><i class="fa-solid fa-arrow-trend-up"></i> 発揮されている強み</div>
          <div class="analysis-list">
            ${strengths.map(s => `<div class="al-item al-green"><i class="fa-solid fa-circle-check"></i><span>${escHtml(s)}</span></div>`).join('')}
          </div>
        </div>` : ''}
        ${challenges.length ? `
        <div class="tc-section">
          <div class="section-title red"><i class="fa-solid fa-circle-exclamation"></i> 課題・改善が必要な点</div>
          <div class="analysis-list">
            ${challenges.map(c => `<div class="al-item al-red"><i class="fa-solid fa-triangle-exclamation"></i><span>${escHtml(c)}</span></div>`).join('')}
          </div>
        </div>` : ''}
        ${concerns.length ? `
        <div class="tc-section">
          <div class="section-title red"><i class="fa-solid fa-shield-exclamation"></i> 懸念事項</div>
          <div class="analysis-list">
            ${concerns.map(c => `<div class="al-item al-red"><i class="fa-solid fa-eye"></i><span>${escHtml(c)}</span></div>`).join('')}
          </div>
        </div>` : ''}
        ${growthSignals.length ? `
        <div class="tc-section">
          <div class="section-title green"><i class="fa-solid fa-seedling"></i> 成長・変化の兆し</div>
          <div class="analysis-list">
            ${growthSignals.map(g => `<div class="al-item al-green"><i class="fa-solid fa-sparkles"></i><span>${escHtml(g)}</span></div>`).join('')}
          </div>
        </div>` : ''}
      </div>` : ''}

      <!-- 指示・進捗 -->
      ${hasTask ? `
      <div class="tc-tab-panel" data-panel="tasks">
        ${instructions.length ? `
        <div class="tc-section">
          <div class="section-title gold"><i class="fa-solid fa-list-check"></i> 指示・課題事項</div>
          <div class="analysis-list">
            ${instructions.map((ins, i) => `<div class="al-item al-gold"><span class="al-num">${i + 1}</span><span>${escHtml(ins)}</span></div>`).join('')}
          </div>
        </div>` : ''}
        ${record.tasks_given ? `
        <div class="tc-section">
          <div class="section-title gold"><i class="fa-solid fa-clipboard-list"></i> 指示原文</div>
          <div class="tc-text">${formatBullets(record.tasks_given)}</div>
        </div>` : ''}
        ${progress.length ? `
        <div class="tc-section">
          <div class="section-title green"><i class="fa-solid fa-chart-line"></i> 進捗・改善状況</div>
          <div class="analysis-list">
            ${progress.map(p => `<div class="al-item al-green"><i class="fa-solid fa-circle-check"></i><span>${escHtml(p)}</span></div>`).join('')}
          </div>
        </div>` : ''}
        ${initiatives.length ? `
        <div class="tc-section">
          <div class="section-title blue"><i class="fa-solid fa-rocket"></i> 具体的な取り組み</div>
          <div class="analysis-list">
            ${initiatives.map(ini => `<div class="al-item al-blue"><i class="fa-solid fa-check"></i><span>${escHtml(ini)}</span></div>`).join('')}
          </div>
        </div>` : ''}
      </div>` : ''}

      <!-- 背景・対応 -->
      ${hasContext ? `
      <div class="tc-tab-panel" data-panel="context">
        ${relations.length ? `
        <div class="tc-section">
          <div class="section-title red"><i class="fa-solid fa-people-arrows"></i> 対人関係・職場環境</div>
          <div class="analysis-list">
            ${relations.map(r => `<div class="al-item al-red"><i class="fa-solid fa-users"></i><span>${escHtml(r)}</span></div>`).join('')}
          </div>
        </div>` : ''}
        ${managerActions.length ? `
        <div class="tc-section">
          <div class="section-title blue"><i class="fa-solid fa-user-gear"></i> 管理者の対応・指示</div>
          <div class="analysis-list">
            ${managerActions.map(m => `<div class="al-item al-blue"><i class="fa-solid fa-arrow-right"></i><span>${escHtml(m)}</span></div>`).join('')}
          </div>
        </div>` : ''}
        ${record.personal_issues ? `
        <div class="tc-section">
          <div class="section-title white"><i class="fa-solid fa-comment-dots"></i> 個人的な状況・本音</div>
          <div class="tc-text">${formatBullets(record.personal_issues)}</div>
        </div>` : ''}
      </div>` : ''}

      <!-- 次回アクション -->
      ${hasAction ? `
      <div class="tc-tab-panel" data-panel="actions">
        <div class="tc-section">
          <div class="section-title gold"><i class="fa-solid fa-bullseye"></i> 次回MTまでのアクション</div>
          <div class="analysis-list">
            ${nextActions.map((a, i) => `<div class="al-item al-gold"><span class="al-num">${i + 1}</span><span>${escHtml(a)}</span></div>`).join('')}
          </div>
        </div>
      </div>` : ''}
      <!-- AI分析パネル -->
      <div class="tc-tab-panel" data-panel="ai">
        <div id="ai-panel-${record.id || index}" class="ai-card-panel">
          ${hasAiData ? renderAiResult({
            ai_review: aiReview,
            ai_status: aiStatus,
            ai_actions_decided: aiActionsDecided,
            ai_actions_pending: aiActionsPending,
            ai_actions_planned: aiActionsPlanned,
            // 後方互換
            ai_summary: aiSummary,
            ai_strengths: aiStrengths,
            ai_challenges: aiChallenges,
            ai_concerns: aiConcerns,
            ai_next_actions: aiNextActions,
            ai_person_profile: aiProfile
          }) : `
          <div style="padding:8px 0;">
            <button class="btn-ai-analyze" onclick="triggerAiCard(this, '${record.id || index}')">
              <i class="fa-solid fa-wand-magic-sparkles"></i> AI総評を生成（Genspark）
            </button>
          </div>`}
          <div id="ai-result-${record.id || index}"></div>
          ${hasAiData ? `
          <div style="margin-top:8px; text-align:right;">
            <button class="btn-ai-analyze" style="font-size:0.65rem;opacity:0.6;" onclick="triggerAiCard(this, '${record.id || index}')">
              <i class="fa-solid fa-rotate-right"></i> 再生成
            </button>
          </div>` : ''}
        </div>
      </div>

    </div>
  </div>`;
}

/* ─── Helpers ─── */
function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function formatBullets(text) {
  if (!text) return '';
  return text.split('\n').map(l => l.trim()).filter(l => l.length)
    .map(l => `<p class="tc-line">${escHtml(l)}</p>`).join('');
}
function tryParse(v, fallback) {
  if (Array.isArray(v)) return v;
  if (!v) return fallback;
  try { const r = JSON.parse(v); return Array.isArray(r) ? r : fallback; } catch { return fallback; }
}

/* ══════════════════════════════════════════════════
   ★ AI分析エンジン（Gemini 2.5 Flash）
   VMバックエンド経由でGemini APIを呼び出す
══════════════════════════════════════════════════ */
const AI_API_BASE = 'https://zvtfabus.gensparkclaw.com/nexus/api';

/* ─── 単票AI分析 ─── */
async function aiAnalyzeRecord(record) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000); // 2分
  try {
    const resp = await fetch(`${AI_API_BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content_main:    record.content_main    || '',
        tasks_given:     record.tasks_given     || '',
        personal_issues: record.personal_issues || '',
        evaluation:      record.evaluation      || '',
        target:          record.target          || '',
        sheet_name:      record.sheet_name      || ''
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    return resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ─── 個人全体AI分析 ─── */
async function aiAnalyzePerson(records, personName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000); // 3分
  try {
    const resp = await fetch(`${AI_API_BASE}/analyze/person`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records, target: personName }),
      signal: controller.signal
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    return resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ─── AI総評レンダリング（単票） ─── */
function renderAiResult(result) {
  if (!result) return '';

  const statusColor = {
    '進行中': 'var(--c-green)',
    '停滞中': 'var(--c-red)',
    '予定':   'var(--c-gold)'
  }[result.ai_status] || 'var(--c-blue)';

  const actionItems = (arr, icon, color) => Array.isArray(arr) && arr.length
    ? arr.map(s => `<div class="al-item" style="border-left-color:${color}"><i class="fa-solid fa-${icon}" style="color:${color}"></i><span>${escHtml(s)}</span></div>`).join('')
    : '';

  // 新形式（総評）
  if (result.ai_review) {
    return `
    <div class="ai-result-block">
      <div class="ai-result-header">
        <i class="fa-solid fa-wand-magic-sparkles"></i> AI 総評
        ${result.ai_status ? `<span style="margin-left:auto;font-size:0.7rem;font-weight:700;color:${statusColor};border:1px solid ${statusColor};padding:2px 8px;border-radius:4px;">${escHtml(result.ai_status)}</span>` : ''}
      </div>

      <div class="tc-section">
        <div class="ai-review-text">${escHtml(result.ai_review).replace(/\n/g, '<br>')}</div>
      </div>

      ${(result.ai_actions_decided?.length || result.ai_actions_pending?.length || result.ai_actions_planned?.length) ? `
      <div class="tc-section" style="margin-top:14px;">
        <div class="section-title gold"><i class="fa-solid fa-list-check"></i> アクション整理</div>
        ${result.ai_actions_decided?.length ? `
        <div style="margin-bottom:8px;">
          <div style="font-size:0.68rem;font-weight:700;color:var(--c-green);margin-bottom:4px;letter-spacing:.04em;">✅ 決定事項</div>
          <div class="analysis-list">${actionItems(result.ai_actions_decided, 'circle-check', 'var(--c-green)')}</div>
        </div>` : ''}
        ${result.ai_actions_pending?.length ? `
        <div style="margin-bottom:8px;">
          <div style="font-size:0.68rem;font-weight:700;color:var(--c-gold);margin-bottom:4px;letter-spacing:.04em;">⏸ 保留事項</div>
          <div class="analysis-list">${actionItems(result.ai_actions_pending, 'clock', 'var(--c-gold)')}</div>
        </div>` : ''}
        ${result.ai_actions_planned?.length ? `
        <div>
          <div style="font-size:0.68rem;font-weight:700;color:var(--c-blue);margin-bottom:4px;letter-spacing:.04em;">📅 予定事項</div>
          <div class="analysis-list">${actionItems(result.ai_actions_planned, 'calendar-days', 'var(--c-blue)')}</div>
        </div>` : ''}
      </div>` : ''}
    </div>`;
  }

  // 旧形式フォールバック（後方互換）
  const items = (arr) => Array.isArray(arr)
    ? arr.map(s => `<div class="al-item al-blue"><i class="fa-solid fa-robot"></i><span>${escHtml(s)}</span></div>`).join('')
    : '';
  return `
  <div class="ai-result-block">
    <div class="ai-result-header"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 分析</div>
    ${result.ai_summary ? `<div class="tc-section"><div class="prose-item prose-blue">${escHtml(result.ai_summary)}</div></div>` : ''}
    ${result.ai_strengths?.length ? `<div class="tc-section"><div class="section-title green"><i class="fa-solid fa-arrow-trend-up"></i> 強み</div><div class="analysis-list">${items(result.ai_strengths)}</div></div>` : ''}
    ${result.ai_challenges?.length ? `<div class="tc-section"><div class="section-title red"><i class="fa-solid fa-circle-exclamation"></i> 課題</div><div class="analysis-list">${items(result.ai_challenges)}</div></div>` : ''}
    ${result.ai_next_actions?.length ? `<div class="tc-section"><div class="section-title gold"><i class="fa-solid fa-list-check"></i> アクション</div><div class="analysis-list">${items(result.ai_next_actions)}</div></div>` : ''}
  </div>`;
}

/* ─── AI結果HTMLレンダリング（個人全体） ─── */
function renderAiPersonResult(result) {
  if (!result) return '';
  const items = (arr) => Array.isArray(arr)
    ? arr.map(s => `<div class="al-item al-blue"><i class="fa-solid fa-robot"></i><span>${escHtml(s)}</span></div>`).join('')
    : '';
  return `
  <div class="ai-result-block ai-person-block">
    <div class="ai-result-header"><i class="fa-solid fa-wand-magic-sparkles"></i> Gemini AI 総合評価</div>
    ${result.ai_overall_summary ? `
    <div class="tc-section">
      <div class="section-title" style="color:var(--c-blue)"><i class="fa-solid fa-comment-dots"></i> 総合評価</div>
      <div class="prose-item prose-blue">${escHtml(result.ai_overall_summary)}</div>
    </div>` : ''}
    ${result.ai_risk_assessment ? `
    <div class="tc-section">
      <div class="section-title red"><i class="fa-solid fa-radar"></i> リスク＆機会</div>
      <div class="prose-item prose-blue">${escHtml(result.ai_risk_assessment)}</div>
    </div>` : ''}
    ${result.ai_persistent_strengths?.length ? `
    <div class="tc-section">
      <div class="section-title green"><i class="fa-solid fa-medal"></i> 一貫した強み</div>
      <div class="analysis-list">${items(result.ai_persistent_strengths)}</div>
    </div>` : ''}
    ${result.ai_persistent_challenges?.length ? `
    <div class="tc-section">
      <div class="section-title red"><i class="fa-solid fa-repeat"></i> 継続課題</div>
      <div class="analysis-list">${items(result.ai_persistent_challenges)}</div>
    </div>` : ''}
    ${result.ai_growth_track?.length ? `
    <div class="tc-section">
      <div class="section-title" style="color:var(--c-blue)"><i class="fa-solid fa-timeline"></i> 成長の軌跡</div>
      <div class="analysis-list">${items(result.ai_growth_track)}</div>
    </div>` : ''}
    ${result.ai_future_direction?.length ? `
    <div class="tc-section">
      <div class="section-title gold"><i class="fa-solid fa-compass"></i> 育成方針（AI提案）</div>
      <div class="analysis-list">${items(result.ai_future_direction)}</div>
    </div>` : ''}
  </div>`;
}
