/**
 * NEXUS OPS – PDF Export Engine v2.0
 * html2canvas + jsPDF による日本語対応PDFレポート生成
 *
 * 方式: HTMLを一時DOMに構築 → html2canvas でキャプチャ → jsPDF に貼付
 * 文字化けなし・日本語完全対応
 */

/* ══════════════════════════════════════════════════
   共通: 一時HTMLを画像化してPDF生成
══════════════════════════════════════════════════ */

/**
 * HTML文字列を受け取りPDFとして保存
 * @param {string} htmlContent  - レポートのHTML
 * @param {string} filename     - 保存ファイル名(.pdf)
 */
async function renderHtmlToPDF(htmlContent, filename) {
  const { jsPDF } = window.jspdf;

  // ── 一時コンテナ生成（画面外に配置）──
  const container = document.createElement('div');
  container.style.cssText = [
    'position:fixed',
    'left:-9999px',
    'top:0',
    'width:794px',        // A4 @ 96dpi ≈ 794px
    'background:#ffffff',
    'color:#111111',
    'font-family:"Noto Sans JP",sans-serif',
    'font-size:13px',
    'line-height:1.7',
    'padding:0',
    'margin:0',
    'box-sizing:border-box',
    'z-index:-1',
  ].join(';');
  container.innerHTML = htmlContent;
  document.body.appendChild(container);

  // フォント読み込み待ち
  await document.fonts.ready;
  await new Promise(r => setTimeout(r, 300));

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: 794,
      windowWidth: 794,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const imgW = 210; // A4幅 mm
    const imgH = (canvas.height * imgW) / canvas.width;

    const pageH = 297; // A4高 mm
    const { jsPDF: PDF } = window.jspdf;
    const doc = new PDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    let y = 0;
    let remaining = imgH;
    let page = 0;

    while (remaining > 0) {
      if (page > 0) doc.addPage();

      const sliceH  = Math.min(remaining, pageH);
      const srcY    = (page * pageH * canvas.width) / imgW;
      const srcH    = (sliceH * canvas.width) / imgW;

      // ページ分割のためキャンバスをスライス
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width  = canvas.width;
      sliceCanvas.height = Math.round(srcH);
      const ctx = sliceCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, Math.round(srcY), canvas.width, Math.round(srcH),
                            0, 0, canvas.width, Math.round(srcH));

      const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.92);
      doc.addImage(sliceData, 'JPEG', 0, 0, imgW, sliceH);

      remaining -= pageH;
      page++;
    }

    doc.save(filename);
  } finally {
    document.body.removeChild(container);
  }
}

/* ══════════════════════════════════════════════════
   レポートHTML生成: 共通スタイル
══════════════════════════════════════════════════ */
function getPDFBaseStyle() {
  return `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Noto Sans JP', sans-serif; font-size: 12px; color: #111; background: #fff; }

    .pdf-header {
      background: #0a1628;
      color: #00d4ff;
      padding: 10px 24px;
      font-size: 10px;
      letter-spacing: 0.15em;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .pdf-header-right { color: #7090b0; font-size: 9px; }

    .pdf-title-block {
      padding: 20px 24px 12px;
      border-bottom: 2px solid #0088cc;
    }
    .pdf-title { font-size: 18px; font-weight: 700; color: #0a1628; margin-bottom: 4px; }
    .pdf-subtitle { font-size: 11px; color: #0066aa; margin-bottom: 10px; }
    .pdf-meta-row {
      display: flex; gap: 24px; flex-wrap: wrap;
      background: #f0f7ff;
      border: 1px solid #c0d8f0;
      padding: 8px 14px;
      font-size: 11px;
    }
    .pdf-meta-item { display: flex; gap: 6px; }
    .pdf-meta-label { color: #666; font-weight: 500; }
    .pdf-meta-value { color: #111; font-weight: 700; }

    .pdf-section {
      margin: 0;
      border-bottom: 1px solid #e8e8e8;
    }
    .pdf-section-title {
      padding: 7px 24px 6px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pdf-section-title.blue  { background: #e8f4ff; color: #0066cc; border-left: 4px solid #0088ee; }
    .pdf-section-title.green { background: #e8fff0; color: #007744; border-left: 4px solid #00aa55; }
    .pdf-section-title.red   { background: #fff0f0; color: #cc2200; border-left: 4px solid #ee3311; }
    .pdf-section-title.gold  { background: #fff8e0; color: #996600; border-left: 4px solid #cc9900; }
    .pdf-section-title.gray  { background: #f4f4f4; color: #555; border-left: 4px solid #aaa; }
    .pdf-section-title.purple{ background: #f4eeff; color: #6622bb; border-left: 4px solid #8844dd; }

    .pdf-section-body { padding: 8px 24px 10px 28px; }

    .pdf-bullet-list { list-style: none; display: flex; flex-direction: column; gap: 5px; }
    .pdf-bullet-item {
      display: flex; gap: 8px; align-items: flex-start;
      font-size: 12px; color: #222; line-height: 1.65;
    }
    .pdf-bullet-dot {
      width: 7px; height: 7px; border-radius: 50%;
      margin-top: 5px; flex-shrink: 0;
    }
    .dot-blue   { background: #0088ee; }
    .dot-green  { background: #00aa55; }
    .dot-red    { background: #ee3311; }
    .dot-gold   { background: #cc9900; }
    .dot-gray   { background: #888; }
    .dot-purple { background: #8844dd; }

    .pdf-text-block {
      font-size: 11.5px; color: #333; line-height: 1.75;
      white-space: pre-wrap; word-break: break-all;
    }

    .pdf-summary-bar {
      margin: 0 24px 10px;
      background: #e8f4ff;
      border: 1px solid #b0d0f0;
      border-left: 4px solid #0088ee;
      padding: 8px 12px;
      font-size: 11px;
      color: #004488;
      line-height: 1.7;
    }
    .pdf-summary-label {
      font-size: 9px; font-weight: 700; letter-spacing: 0.15em;
      color: #0066cc; margin-bottom: 4px;
    }

    .pdf-change-item {
      display: flex; gap: 10px; align-items: flex-start;
      padding: 5px 0; border-bottom: 1px solid #f0f0f0;
      font-size: 11.5px; line-height: 1.6;
    }
    .pdf-change-badge {
      font-size: 9px; font-weight: 700; padding: 2px 7px;
      border-radius: 2px; white-space: nowrap; flex-shrink: 0; margin-top: 2px;
    }
    .badge-improved { background: #d0f0e0; color: #007744; }
    .badge-result   { background: #c8ead8; color: #005533; }
    .badge-progress { background: #d0e8ff; color: #0055aa; }
    .badge-ongoing  { background: #ffecd0; color: #995500; }
    .badge-warning  { background: #ffe0e0; color: #aa2200; }

    .pdf-persist-item {
      display: flex; gap: 10px; align-items: flex-start;
      padding: 4px 0; border-bottom: 1px solid #f4f4f4;
      font-size: 11.5px;
    }
    .pdf-count-badge {
      font-size: 9px; font-weight: 700; padding: 1px 7px;
      border-radius: 2px; white-space: nowrap; flex-shrink: 0; margin-top: 2px;
    }
    .count-green  { background: #d8f0e4; color: #006633; }
    .count-red    { background: #fde0e0; color: #992200; }
    .count-gold   { background: #fff3cc; color: #886600; }

    .pdf-future-item {
      padding: 6px 0 6px 12px;
      border-left: 3px solid #cc9900;
      margin-bottom: 6px;
      font-size: 11.5px; color: #333; line-height: 1.65;
    }
    .pdf-future-heading {
      font-size: 10px; font-weight: 700; color: #886600;
      letter-spacing: 0.1em; margin-bottom: 2px;
    }

    .pdf-month-block {
      padding: 6px 0;
      border-bottom: 1px solid #eee;
    }
    .pdf-month-label {
      font-size: 11px; font-weight: 700; color: #0066cc;
      margin-bottom: 3px;
    }
    .pdf-month-lines { font-size: 11px; color: #444; line-height: 1.65; padding-left: 8px; }

    .pdf-footer {
      background: #f4f4f4;
      border-top: 1px solid #ddd;
      padding: 6px 24px;
      font-size: 9px; color: #888;
      display: flex; justify-content: space-between;
      margin-top: 16px;
    }
  </style>`;
}

/* ══════════════════════════════════════════════════
   月別レポートHTML生成
══════════════════════════════════════════════════ */
function buildMonthlyReportHTML(record) {
  const ymLabel  = escHtml(record.year_month || record.sheet_name || '--');
  const target   = escHtml(record.target   || '--');
  const reporter = escHtml(record.reporter || '--');
  const location = escHtml(record.location || '--');
  const duration = escHtml(record.duration || '--');
  const dateStr  = escHtml(record.date ? formatDate(record.date) : ymLabel);
  const genDate  = new Date().toLocaleDateString('ja-JP');

  const ps   = tryParse(record.period_summary, []);
  const str  = tryParse(record.strengths, []);
  const cha  = tryParse(record.challenges, []);
  const ins  = tryParse(record.instructions, []);
  const pro  = tryParse(record.progress, []);
  const con  = tryParse(record.concerns, []);
  const nxt  = tryParse(record.next_actions, []);
  const chars= tryParse(record.characteristics, []);

  const bulletList = (items, dotClass) => {
    if (!items || !items.length) return '<p style="color:#aaa;font-size:11px;">— データなし —</p>';
    return `<ul class="pdf-bullet-list">${items.map(i =>
      `<li class="pdf-bullet-item">
        <span class="pdf-bullet-dot ${dotClass}"></span>
        <span>${escHtml(i)}</span>
      </li>`
    ).join('')}</ul>`;
  };

  const section = (title, colorClass, content) => `
    <div class="pdf-section">
      <div class="pdf-section-title ${colorClass}">${title}</div>
      <div class="pdf-section-body">${content}</div>
    </div>`;

  let html = getPDFBaseStyle() + `
  <div class="pdf-header">
    <span>NEXUS OPS // MT REPORT // MODULE 001</span>
    <span class="pdf-header-right">生成日: ${genDate}</span>
  </div>

  <div class="pdf-title-block">
    <div class="pdf-title">${target}　面談レポート</div>
    <div class="pdf-subtitle">${ymLabel}　${dateStr}</div>
    <div class="pdf-meta-row">
      <div class="pdf-meta-item"><span class="pdf-meta-label">面談対象:</span><span class="pdf-meta-value">${target}</span></div>
      <div class="pdf-meta-item"><span class="pdf-meta-label">報告者:</span><span class="pdf-meta-value">${reporter}</span></div>
      <div class="pdf-meta-item"><span class="pdf-meta-label">場所:</span><span class="pdf-meta-value">${location}</span></div>
      <div class="pdf-meta-item"><span class="pdf-meta-label">所要時間:</span><span class="pdf-meta-value">${duration}</span></div>
    </div>
  </div>`;

  // 今月の要点
  if (ps.length) {
    html += `
    <div style="padding:10px 24px 0;">
      <div class="pdf-summary-bar">
        <div class="pdf-summary-label">▶ 今月の要点</div>
        ${ps.map(l => `<div>${escHtml(l)}</div>`).join('')}
      </div>
    </div>`;
  }

  // 特徴・傾向
  if (chars.length) {
    html += section('特徴・傾向', 'blue',
      `<div class="pdf-text-block">${chars.map(c => escHtml(c)).join('\n\n')}</div>`);
  }

  // 強み
  if (str.length) html += section('発揮されている強み', 'green', bulletList(str, 'dot-green'));

  // 課題
  if (cha.length) html += section('課題・改善が必要な点', 'red', bulletList(cha, 'dot-red'));

  // 指示事項
  if (ins.length) html += section('指示・課題事項', 'gold', bulletList(ins, 'dot-gold'));

  // 進捗
  if (pro.length) html += section('進捗・改善状況', 'green', bulletList(pro, 'dot-green'));

  // 懸念事項
  if (con.length) html += section('懸念事項', 'red', bulletList(con, 'dot-red'));

  // 次回アクション
  if (nxt.length) html += section('次回MTまでのアクション', 'purple', bulletList(nxt, 'dot-purple'));

  // 議事内容原文
  if (record.content_main) {
    html += section('議事内容', 'gray',
      `<div class="pdf-text-block">${escHtml(record.content_main)}</div>`);
  }
  if (record.tasks_given) {
    html += section('MTの結果・取り組み', 'blue',
      `<div class="pdf-text-block">${escHtml(record.tasks_given)}</div>`);
  }
  if (record.personal_issues) {
    html += section('その他・聞取り内容', 'gray',
      `<div class="pdf-text-block">${escHtml(record.personal_issues)}</div>`);
  }
  if (record.evaluation) {
    html += section('備考・総評', 'gray',
      `<div class="pdf-text-block">${escHtml(record.evaluation)}</div>`);
  }

  html += `
  <div class="pdf-footer">
    <span>NEXUS OPS MT Report　${ymLabel}　${target}</span>
    <span>CONFIDENTIAL</span>
  </div>`;

  return html;
}

/* ══════════════════════════════════════════════════
   個人全期間サマリーHTML生成
══════════════════════════════════════════════════ */
function buildSummaryReportHTML(personName, records) {
  const sorted = [...records].sort((a, b) => parseYMTime(a) - parseYMTime(b));
  const first  = sorted[0];
  const last   = sorted[sorted.length - 1];
  const period = records.length > 1
    ? `${first.year_month || first.sheet_name} → ${last.year_month || last.sheet_name}`
    : (first.year_month || first.sheet_name);
  const reporter = escHtml(first.reporter || '--');
  const genDate  = new Date().toLocaleDateString('ja-JP');
  const report   = buildPersonReport(records);

  const section = (title, colorClass, content) => `
    <div class="pdf-section">
      <div class="pdf-section-title ${colorClass}">${title}</div>
      <div class="pdf-section-body">${content}</div>
    </div>`;

  const bulletList = (items, dotClass) => {
    if (!items || !items.length) return '<p style="color:#aaa;font-size:11px;">— データなし —</p>';
    return `<ul class="pdf-bullet-list">${items.map(i =>
      `<li class="pdf-bullet-item">
        <span class="pdf-bullet-dot ${dotClass}"></span>
        <span>${escHtml(typeof i === 'object' ? i.text : i)}</span>
      </li>`
    ).join('')}</ul>`;
  };

  let html = getPDFBaseStyle() + `
  <div class="pdf-header">
    <span>NEXUS OPS // MT SUMMARY REPORT // MODULE 001</span>
    <span class="pdf-header-right">生成日: ${genDate}</span>
  </div>

  <div class="pdf-title-block">
    <div class="pdf-title">${escHtml(personName)}　全期間サマリーレポート</div>
    <div class="pdf-subtitle">対象期間: ${escHtml(period)}</div>
    <div class="pdf-meta-row">
      <div class="pdf-meta-item"><span class="pdf-meta-label">対象者:</span><span class="pdf-meta-value">${escHtml(personName)}</span></div>
      <div class="pdf-meta-item"><span class="pdf-meta-label">報告者:</span><span class="pdf-meta-value">${reporter}</span></div>
      <div class="pdf-meta-item"><span class="pdf-meta-label">対象期間:</span><span class="pdf-meta-value">${escHtml(period)}</span></div>
    </div>
  </div>`;

  // 人物評価
  if (report && report.personProfile && report.personProfile.length) {
    html += section('人物評価・総合的な特徴', 'blue',
      `<div class="pdf-text-block">${report.personProfile.map(l => escHtml(l)).join('\n\n')}</div>`);
  }

  // 変化の軌跡
  if (report && report.changeTrack && report.changeTrack.length) {
    const typeLabel = { improved:'改善', result:'成果', progress:'進捗中', ongoing:'継続課題', warning:'懸念' };
    const typeBadge = { improved:'badge-improved', result:'badge-result', progress:'badge-progress', ongoing:'badge-ongoing', warning:'badge-warning' };
    const changeHTML = report.changeTrack.map(ct => `
      <div class="pdf-change-item">
        <span class="pdf-change-badge ${typeBadge[ct.type]||'badge-progress'}">${typeLabel[ct.type]||ct.type}</span>
        <div>
          <div>${escHtml(ct.text)}</div>
          ${ct.from ? `<div style="font-size:10px;color:#888;margin-top:2px;">${escHtml(ct.from)} → ${escHtml(ct.to)}</div>` : ''}
        </div>
      </div>`).join('');
    html += section('変化・改善の軌跡', 'blue', changeHTML);
  }

  // 継続して発揮されている強み
  if (report && report.persistentStrengths && report.persistentStrengths.length) {
    const itemsHTML = report.persistentStrengths.map(p => `
      <div class="pdf-persist-item">
        <span class="pdf-count-badge count-green">${p.count}回確認</span>
        <span>${escHtml(p.text)}</span>
      </div>`).join('');
    html += section('継続して発揮されている強み', 'green', itemsHTML);
  }

  // 繰り返し現れる課題
  if (report && report.persistentChallenges && report.persistentChallenges.length) {
    const itemsHTML = report.persistentChallenges.map(p => `
      <div class="pdf-persist-item">
        <span class="pdf-count-badge count-red">${p.count}回確認</span>
        <span>${escHtml(p.text)}</span>
      </div>`).join('');
    html += section('繰り返し現れる課題', 'red', itemsHTML);
  }

  // 繰り返し指示
  if (report && report.repeatedInstructions && report.repeatedInstructions.length) {
    const itemsHTML = report.repeatedInstructions.map(p => `
      <div class="pdf-persist-item">
        <span class="pdf-count-badge count-gold">${p.count}回指示</span>
        <span>${escHtml(p.text)}</span>
      </div>`).join('');
    html += section('繰り返し指示・継続課題', 'gold', itemsHTML);
  }

  // 今後の方針
  if (report && report.futureDirection && report.futureDirection.length) {
    const futureHTML = report.futureDirection.map(f => {
      const m = f.match(/^【([^】]+)】(.*)$/s);
      if (m) return `<div class="pdf-future-item"><div class="pdf-future-heading">${escHtml(m[1])}</div><div>${escHtml(m[2].trim())}</div></div>`;
      return `<div class="pdf-future-item">${escHtml(f)}</div>`;
    }).join('');
    html += section('今後の方針・育成方向性', 'gold', futureHTML);
  }

  // 月別サマリー一覧
  const monthsHTML = sorted.map(rec => {
    const lbl = escHtml(rec.year_month || rec.sheet_name || '--');
    const ps  = tryParse(rec.period_summary, []);
    return `<div class="pdf-month-block">
      <div class="pdf-month-label">▶ ${lbl}</div>
      <div class="pdf-month-lines">${ps.length
        ? ps.map(l => escHtml(l)).join('<br>')
        : '<span style="color:#aaa;">データなし</span>'
      }</div>
    </div>`;
  }).join('');
  html += section('月別 MT サマリー', 'blue', monthsHTML);

  html += `
  <div class="pdf-footer">
    <span>NEXUS OPS MT Summary Report　${escHtml(personName)}　${escHtml(period)}</span>
    <span>CONFIDENTIAL</span>
  </div>`;

  return html;
}

/* ══════════════════════════════════════════════════
   公開API: 一括ダウンロード（ZIP）
   filter: { year, month, store, person } すべて '__ALL__' で全件
══════════════════════════════════════════════════ */
async function generateBulkPDF(allRecords, storeMap, filter = {}) {
  const JSZipLib = window.JSZip;
  if (!JSZipLib) { showToast('JSZipが読み込まれていません', 'error'); return; }
  if (!window.html2canvas) { showToast('html2canvasが読み込まれていません', 'error'); return; }

  showToast('PDF生成中... しばらくお待ちください', 'info', 10000);

  // ── フィルタリング ──
  let filtered = [...allRecords];

  if (filter.store && filter.store !== '__ALL__') {
    const persons = storeMap[filter.store] ? Object.keys(storeMap[filter.store]) : [];
    filtered = filtered.filter(r => persons.includes((r.target || r.reporter || '').trim()));
  }
  if (filter.person && filter.person !== '__ALL__') {
    filtered = filtered.filter(r => (r.target || r.reporter || '').trim() === filter.person);
  }
  if (filter.year && filter.year !== '__ALL__') {
    filtered = filtered.filter(r => (r.year_month || r.sheet_name || r.date || '').includes(filter.year));
  }
  if (filter.month && filter.month !== '__ALL__') {
    const mn = parseInt(filter.month, 10);
    filtered = filtered.filter(r => {
      const ym = r.year_month || r.sheet_name || r.date || '';
      const m  = ym.match(/(\d{1,2})月/) || ym.match(/[\/.\-](\d{1,2})[\/.\-]/);
      return m && parseInt(m[1], 10) === mn;
    });
  }

  if (!filtered.length) { showToast('条件に合うレコードがありません。', 'warn'); return; }

  // ── 個人ごとにグルーピング ──
  const personGroups = {};
  for (const r of filtered) {
    const p = (r.target || r.reporter || 'UNKNOWN').trim();
    if (!personGroups[p]) personGroups[p] = [];
    personGroups[p].push(r);
  }

  const zip = new JSZipLib();
  let pdfCount = 0;

  for (const [personName, recs] of Object.entries(personGroups)) {
    const sorted = [...recs].sort((a, b) => parseYMTime(a) - parseYMTime(b));

    // 月別PDF
    for (const rec of sorted) {
      const htmlContent = buildMonthlyReportHTML(rec);
      const pdfBlob = await htmlToPDFBlob(htmlContent);
      const ymSafe  = (rec.year_month || rec.sheet_name || 'unknown').replace(/[\/\\\s]/g, '_');
      zip.file(`${personName}/${ymSafe}_${personName}_MT.pdf`, pdfBlob);
      pdfCount++;
    }

    // 全期間サマリーPDF（2件以上）
    if (recs.length >= 2) {
      const htmlContent = buildSummaryReportHTML(personName, sorted);
      const pdfBlob = await htmlToPDFBlob(htmlContent);
      zip.file(`${personName}/${personName}_全期間サマリー.pdf`, pdfBlob);
      pdfCount++;
    }
  }

  if (!pdfCount) { showToast('PDFが生成できませんでした。', 'warn'); return; }

  const filterDesc = [
    filter.year   !== '__ALL__' ? filter.year + '年'  : '',
    filter.month  !== '__ALL__' ? filter.month + '月' : '',
    filter.store  !== '__ALL__' ? filter.store        : '',
    filter.person !== '__ALL__' ? filter.person       : '',
  ].filter(Boolean).join('_') || '全件';

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = `MTレポート_${filterDesc}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  showToast(`${pdfCount}件のPDFをZIPでダウンロードしました。`, 'success');
}

/* ══════════════════════════════════════════════════
   内部: HTMLをPDF Blob に変換
══════════════════════════════════════════════════ */
async function htmlToPDFBlob(htmlContent) {
  const { jsPDF } = window.jspdf;

  const container = document.createElement('div');
  container.style.cssText = [
    'position:fixed', 'left:-9999px', 'top:0',
    'width:794px', 'background:#ffffff', 'color:#111',
    'font-family:"Noto Sans JP",sans-serif',
    'padding:0', 'margin:0', 'box-sizing:border-box', 'z-index:-1',
  ].join(';');
  container.innerHTML = htmlContent;
  document.body.appendChild(container);

  await document.fonts.ready;
  await new Promise(r => setTimeout(r, 200));

  try {
    const canvas = await html2canvas(container, {
      scale: 2, useCORS: true, allowTaint: true,
      backgroundColor: '#ffffff', logging: false,
      width: 794, windowWidth: 794,
    });

    const imgW  = 210;
    const imgH  = (canvas.height * imgW) / canvas.width;
    const pageH = 297;
    const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    let page = 0;
    let remaining = imgH;

    while (remaining > 0) {
      if (page > 0) doc.addPage();
      const sliceH  = Math.min(remaining, pageH);
      const srcY    = (page * pageH * canvas.width) / imgW;
      const srcH    = (sliceH * canvas.width) / imgW;

      const sc = document.createElement('canvas');
      sc.width  = canvas.width;
      sc.height = Math.round(srcH);
      sc.getContext('2d').drawImage(
        canvas, 0, Math.round(srcY), canvas.width, Math.round(srcH),
        0, 0, canvas.width, Math.round(srcH)
      );
      doc.addImage(sc.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, imgW, sliceH);
      remaining -= pageH;
      page++;
    }

    return doc.output('arraybuffer');
  } finally {
    document.body.removeChild(container);
  }
}

/* ── ユーティリティ ── */
function parseYMTime(rec) {
  if (rec.year_month) {
    const m = rec.year_month.match(/(\d{4})年(\d{1,2})月/);
    if (m) return new Date(+m[1], +m[2] - 1, 1).getTime();
  }
  const s = String(rec.date || rec.sheet_name || '0')
    .replace(/年/g,'-').replace(/月/g,'-').replace(/日/g,'').replace(/\//g,'-');
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
