'use strict';
/* PDF report builder (jsPDF + autotable, runs fully offline in the browser). */
const Report = (() => {
  const NAVY = [30, 58, 95], TEAL = [47, 125, 109], GREY = [102, 112, 133], LIGHT = [244, 246, 249], RED = [180, 35, 24];
  const W = 612, H = 792, M = 40;
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  // Standard PDF fonts only cover Latin-1/WinAnsi; normalize everything else so text never garbles.
  const clean = s => String(s ?? '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, '...')
    .replace(/[\u2013\u2014]/g, '-').replace(/[\u2192]/g, '->').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
  const fmtD = d => clean(fmtDate(d));
  const blobToDataUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });

  let logoCache;
  async function defaultLogo() {
    if (logoCache !== undefined) return logoCache;
    try {
      const b = await (await fetch('assets/atlantic-logo-white.png')).blob();
      const bmp = await createImageBitmap(b);
      logoCache = { data: await blobToDataUrl(b), w: bmp.width, h: bmp.height, fmt: 'PNG' };
    } catch (e) { logoCache = null; }
    return logoCache;
  }
  async function build(insp, ent, settings, prev) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const def = CFG.types[insp.type];
    const isCon = insp.type === 'construction';
    const overall = Core.overall(insp), band = Core.band(overall);
    const actions = Core.actionItems(insp);
    const sample = !!ent.sample;

    /* --- Cover header band --- */
    doc.setFillColor(...NAVY); doc.rect(0, 0, W, 100, 'F');
    doc.setFillColor(...TEAL); doc.rect(0, 100, W, 4, 'F');
    // Logo: a custom upload from Settings wins; otherwise the bundled Atlantic Development logo (white, for the navy band).
    // Kept modest (max 64pt tall) because the source artwork is soft.
    let logoW = 0;
    const logo = settings.logo ? { data: settings.logo, w: settings.logoW || 150, h: settings.logoH || 60, fmt: 'JPEG' } : await defaultLogo();
    if (logo) {
      const r = Math.min(120 / logo.w, 64 / logo.h);
      logoW = logo.w * r; const lh = logo.h * r;
      try { doc.addImage(logo.data, logo.fmt, W - M - logoW, 50 - lh / 2, logoW, lh, 'brandlogo', 'FAST'); } catch (e) { logoW = 0; }
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(clean((settings.company || CFG.company || 'Atlantic Development').toUpperCase()), M, 38, { charSpace: 1 });
    doc.setFontSize(24); doc.text(clean(def.reportTitle), M, 70);

    let y = 140;
    if (sample) {
      doc.setFillColor(...RED); doc.roundedRect(M, 116, W - 2 * M, 20, 4, 4, 'F');
      doc.setFontSize(10); doc.setTextColor(255, 255, 255);
      doc.text('SAMPLE DATA - created for testing, not a real inspection', W / 2, 129.5, { align: 'center' });
      y = 166;
    }
    doc.setTextColor(...NAVY); doc.setFontSize(20); doc.setFont('helvetica', 'bold');
    doc.text(clean(ent.name), M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...GREY);
    const addr = [ent.address, [ent.city, ent.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const sub = [addr, ent.units ? `${ent.units} units` : '', isCon && ent.buildings ? `${ent.buildings} buildings` : ''].filter(Boolean).join('  |  ');
    if (sub) doc.text(clean(sub), M, y + 16);
    y += 34;

    /* --- Score box (left) + key facts (right) --- */
    const boxW = 170, boxH = 112;
    if (isCon) {
      const pc = insp.fields.pctComplete, pp = prev?.fields.pctComplete;
      doc.setFillColor(...NAVY); doc.roundedRect(M, y, boxW, boxH, 8, 8, 'F');
      doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.text('OVERALL % COMPLETE', M + boxW / 2, y + 20, { align: 'center' });
      doc.setFontSize(36); doc.text(pc !== '' && pc != null ? `${pc}%` : '-', M + boxW / 2, y + 60, { align: 'center' });
      doc.setFontSize(9); doc.setFont('helvetica', 'normal');
      doc.text(pp !== '' && pp != null ? clean(`Last visit ${fmtD(prev.fields.date)}: ${pp}%`) : 'No previous visit', M + boxW / 2, y + 80, { align: 'center' });
      if (pp !== '' && pp != null && pc !== '' && pc != null) { const d = pc - pp; doc.setFont('helvetica', 'bold'); doc.text(`${d >= 0 ? '+' : ''}${d} pts since last visit`, M + boxW / 2, y + 96, { align: 'center' }); }
    } else {
      doc.setFillColor(...rgb(band.color)); doc.roundedRect(M, y, boxW, boxH, 8, 8, 'F');
      doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.text('OVERALL SCORE', M + boxW / 2, y + 20, { align: 'center' });
      doc.setFontSize(38); doc.text(overall == null ? '-' : overall.toFixed(1), M + boxW / 2 - 8, y + 62, { align: 'center' });
      doc.setFontSize(12); doc.text('/ 5', M + boxW / 2 + 30, y + 62);
      doc.setFontSize(11); doc.text(band.label, M + boxW / 2, y + 82, { align: 'center' });
      doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');
      const po = prev ? Core.overall(prev) : null;
      doc.text(prev ? clean(`Previous walk ${fmtD(prev.fields.date)}: ${po == null ? '-' : po.toFixed(1)}`) : 'First walk on record', M + boxW / 2, y + 99, { align: 'center' });
    }
    const facts = isCon
      ? [['Visit date', fmtD(insp.fields.date)], ['Inspector', insp.fields.inspector], ['General contractor', insp.fields.gc], ['Superintendent', insp.fields.super],
         ['Manpower on site', insp.fields.manpower], ['Weather', [insp.fields.weather, insp.fields.temp !== '' && insp.fields.temp != null ? insp.fields.temp + '\u00B0F' : ''].filter(Boolean).join(', ')],
         ['Schedule', [insp.fields.schedStatus, insp.fields.daysBehind ? `${insp.fields.daysBehind} days behind` : ''].filter(Boolean).join(' - ')],
         ['Quality / safety score', overall == null ? '-' : `${overall.toFixed(1)} / 5 (${band.label})`]]
      : [['Walk date', fmtD(insp.fields.date)], ['Inspector', insp.fields.inspector], ['Walked with', insp.fields.accompanied],
         ['Weather', [insp.fields.weather, insp.fields.temp !== '' && insp.fields.temp != null ? insp.fields.temp + '\u00B0F' : ''].filter(Boolean).join(', ')],
         ['Occupancy / leased', [insp.fields.occupancy, insp.fields.leased].map(v => (v === '' || v == null ? '-' : v + '%')).join(' / ')],
         ['Units walked', insp.fields.unitsWalked], ['Action items', String(actions.length)],
         ['Items rated', (() => { const p = Core.progress(insp); return `${p.done} of ${p.total}`; })()]];
    doc.autoTable({
      startY: y - 4, margin: { left: M + boxW + 16, right: M }, theme: 'plain', body: facts.map(([k, v]) => [clean(k), clean(v || '-')]),
      styles: { fontSize: 9.5, cellPadding: { top: 2.6, bottom: 2.6, left: 4, right: 4 }, textColor: [27, 36, 48] },
      columnStyles: { 0: { textColor: GREY, cellWidth: 118 }, 1: { fontStyle: 'bold' } },
    });
    y = Math.max(y + boxH, doc.lastAutoTable.finalY) + 22;
    if (settings.distribution) { doc.setFontSize(9); doc.setTextColor(...GREY); doc.text(clean('Distribution: ' + settings.distribution), M, y - 8); y += 6; }

    const heading = (t, yy, need = 120) => {
      if (yy > H - 50 - need) { doc.addPage(); yy = 56; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...NAVY); doc.text(clean(t), M, yy);
      doc.setDrawColor(...TEAL); doc.setLineWidth(1.5); doc.line(M, yy + 5, M + 40, yy + 5);
      return yy + 14;
    };
    const tableBase = { margin: { left: M, right: M, top: 50, bottom: 50 }, theme: 'grid',
      styles: { fontSize: 9, cellPadding: 5, lineColor: [221, 227, 234], lineWidth: 0.5, textColor: [27, 36, 48], overflow: 'linebreak' },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [250, 251, 252] } };
    const prioColor = { High: RED, Medium: rgb('#b7791f'), Low: GREY };

    /* --- Action items (up top) --- */
    y = heading(`Action Items (${actions.length})`, y);
    if (actions.length) {
      doc.autoTable({ ...tableBase, startY: y,
        head: [['Priority', 'Section', 'Item / notes', 'Owner', 'Due']],
        body: actions.map(a => [a.priority, clean(a.section), clean(a.item + (a.notes ? '\n' + a.notes : '') + (a.source === 'Carried from last visit' ? '\n(carried from last visit)' : '')), clean(a.owner || '-'), a.due ? fmtD(a.due) : '-']),
        columnStyles: { 0: { cellWidth: 54, fontStyle: 'bold', halign: 'center' }, 1: { cellWidth: 100 }, 3: { cellWidth: 92 }, 4: { cellWidth: 66 } },
        didParseCell: d => { if (d.section === 'body' && d.column.index === 0) { d.cell.styles.fillColor = prioColor[d.cell.raw] || GREY; d.cell.styles.textColor = 255; } } });
      y = doc.lastAutoTable.finalY + 24;
    } else { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GREY); doc.text('No action items flagged.', M, y + 6); y += 30; }

    /* --- Section scores --- */
    const scored = def.sections.filter(s => s.items);
    y = heading(isCon ? 'Quality, Safety & Site Scores' : 'Section Scores', y);
    doc.autoTable({ ...tableBase, startY: y,
      head: [['Section', 'Items rated', 'Score (1-5)', 'Rating', prev ? `Last (${fmtD(prev.fields.date)})` : 'Last']],
      body: scored.map(s => { const sc = Core.secScore(s, insp), ps = prev ? Core.secScore(s, prev).avg : null;
        return [clean(s.title), `${sc.n} / ${sc.total}`, sc.avg == null ? '-' : sc.avg.toFixed(1), Core.band(sc.avg).label, ps == null ? '-' : ps.toFixed(1)]; })
        .concat([[{ content: 'Overall (average of section scores, N/A excluded)', styles: { fontStyle: 'bold' } }, '', overall == null ? '-' : overall.toFixed(1), band.label, prev && Core.overall(prev) != null ? Core.overall(prev).toFixed(1) : '-']]),
      columnStyles: { 1: { halign: 'center', cellWidth: 70 }, 2: { halign: 'center', cellWidth: 70, fontStyle: 'bold' }, 3: { cellWidth: 95 }, 4: { halign: 'center', cellWidth: 82 } },
      didParseCell: d => { if (d.section === 'body' && d.column.index === 2 && d.cell.raw !== '-') { d.cell.styles.fillColor = rgb(Core.band(Number(d.cell.raw)).color); d.cell.styles.textColor = 255; } } });
    y = doc.lastAutoTable.finalY + 24;

    /* --- Construction: progress by building --- */
    if (isCon) {
      const rows = insp.reps.buildings || [];
      const pr = prev?.reps.buildings || [];
      y = heading('Progress by Building / Phase', y);
      doc.autoTable({ ...tableBase, startY: y,
        head: [['Building / phase', 'Stage (last -> now)', 'Last %', 'Now %', 'Change', 'Notes']],
        body: rows.length ? rows.map(r => { const p = pr.find(x => String(x.name || '').trim().toLowerCase() === String(r.name || '').trim().toLowerCase());
          const d = p && p.pct !== '' && p.pct != null && r.pct !== '' && r.pct != null ? r.pct - p.pct : null;
          return [clean(r.name || '-'), clean(p?.stage && p.stage !== r.stage ? `${p.stage} -> ${r.stage || '-'}` : r.stage || '-'), p?.pct != null && p.pct !== '' ? p.pct + '%' : '-', r.pct !== '' && r.pct != null ? r.pct + '%' : '-', d == null ? '-' : `${d >= 0 ? '+' : ''}${d}`, clean(r.notes || '')]; })
          : [[{ content: 'No buildings entered', colSpan: 6 }]],
        columnStyles: { 0: { cellWidth: 92, fontStyle: 'bold' }, 1: { cellWidth: 120 }, 2: { halign: 'center', cellWidth: 44 }, 3: { halign: 'center', cellWidth: 44, fontStyle: 'bold' }, 4: { halign: 'center', cellWidth: 46 } },
        didParseCell: d => { if (d.section === 'body' && d.column.index === 4 && /^\+[1-9]/.test(d.cell.raw)) d.cell.styles.textColor = rgb('#1f7a4d'); } });
      y = doc.lastAutoTable.finalY + 24;
    }

    /* --- Detailed findings --- */
    y = heading('Detailed Findings', y, 160) + 4;
    for (const sec of def.sections) {
      if (isCon && sec.repeater?.id === 'buildings' && !sec.items && !sec.fields) continue; // already shown on page 1
      const parts = [];
      const sc = Core.secScore(sec, insp);
      if (y > H - 120) { doc.addPage(); y = 56; }
      doc.setFillColor(...LIGHT); doc.rect(M, y, W - 2 * M, 22, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NAVY);
      doc.text(clean(sec.title), M + 8, y + 15);
      if (sec.items) { doc.setTextColor(...rgb(Core.band(sc.avg).color)); doc.text(sc.avg == null ? 'Not rated' : `${sc.avg.toFixed(1)} / 5`, W - M - 8, y + 15, { align: 'right' }); }
      y += 26;
      if (sec.fields) {
        const body = sec.fields.filter(f => insp.fields[f.id] !== '' && insp.fields[f.id] != null).map(f => {
          const last = f.compare && prev ? prev.fields[f.id] : undefined;
          return [clean(f.label), clean(fmtVal(f, insp.fields[f.id])), last === undefined ? '' : clean(fmtVal(f, last))];
        });
        if (body.length) {
          doc.autoTable({ ...tableBase, startY: y, theme: 'plain', head: prev ? [['', 'This visit', 'Last visit']] : undefined,
            headStyles: { textColor: GREY, fontStyle: 'bold', fontSize: 8 }, body,
            columnStyles: { 0: { cellWidth: 170, textColor: GREY }, 2: { cellWidth: 110, textColor: GREY } }, alternateRowStyles: {} });
          y = doc.lastAutoTable.finalY + 8;
        }
      }
      if (sec.items) {
        const rated = sec.items.filter(it => { const a = insp.items[it.id]; return a && (a.rating != null || a.notes); });
        const unr = sec.items.length - sec.items.filter(it => insp.items[it.id]?.rating != null).length;
        if (rated.length) {
          doc.autoTable({ ...tableBase, startY: y, head: [['Item', 'Rating', 'Notes']],
            body: rated.map(it => { const a = insp.items[it.id]; return [clean(it.label) + (a.flag ? '  [ACTION]' : ''), a.rating === 'na' ? 'N/A' : a.rating == null ? '-' : String(a.rating), clean(a.notes || '')]; }),
            columnStyles: { 0: { cellWidth: 190 }, 1: { cellWidth: 46, halign: 'center', fontStyle: 'bold' } },
            didParseCell: d => { if (d.section === 'body' && d.column.index === 1 && /^[1-5]$/.test(d.cell.raw)) { d.cell.styles.textColor = rgb(Core.band(Number(d.cell.raw)).color); } if (d.section === 'body' && d.column.index === 0 && String(d.cell.raw).includes('[ACTION]')) d.cell.styles.textColor = RED; } });
          y = doc.lastAutoTable.finalY + 6;
        }
        if (unr) { doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...GREY); doc.text(`${unr} item${unr === 1 ? '' : 's'} not rated.`, M + 2, y + 8); y += 14; }
      }
      if (sec.repeater && !(isCon && sec.repeater.id === 'buildings')) {
        const rep = sec.repeater, rows = insp.reps[rep.id] || [];
        if (rows.length) {
          const cols = rep.fields;
          doc.autoTable({ ...tableBase, startY: y, head: [cols.map(f => clean(f.label))],
            body: rows.map(r => cols.map(f => clean(f.id === rep.titleField && r.carried ? `${r[f.id] || ''} (carried)` : r[f.id] === '' || r[f.id] == null ? '' : fmtVal(f, r[f.id])))),
            styles: { ...tableBase.styles, fontSize: 8.5 } });
          y = doc.lastAutoTable.finalY + 6;
        } else { doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...GREY); doc.text(`No ${rep.label.toLowerCase()} entered.`, M + 2, y + 8); y += 14; }
      }
      y += 14;
    }

    /* --- Photos --- */
    const ids = [];
    for (const sec of def.sections) {
      for (const it of sec.items || []) for (const p of insp.items[it.id]?.photos || []) ids.push(p);
      if (sec.repeater) for (const r of insp.reps[sec.repeater.id] || []) for (const p of r.photos || []) ids.push(p);
    }
    for (const p of insp.generalPhotos || []) ids.push(p);
    const photos = (await Promise.all(ids.map(id => DB.get('photos', id)))).filter(Boolean);
    if (photos.length) {
      y = heading(`Photos (${photos.length})`, y + 6, 200) + 6;
      const cols = 3, gap = 12, cw = (W - 2 * M - gap * (cols - 1)) / cols, ih = cw * 0.75, ch = ih + 34;
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i], c = i % cols;
        if (c === 0 && i > 0) y += ch + 10;
        if (c === 0 && y + ch > H - 50) { doc.addPage(); y = 56; }
        const x = M + c * (cw + gap);
        doc.setFillColor(236, 239, 243); doc.rect(x, y, cw, ih, 'F');
        const r = Math.min(cw / p.w, ih / p.h), iw = p.w * r, hh = p.h * r;
        doc.addImage(await blobToDataUrl(p.blob), 'JPEG', x + (cw - iw) / 2, y + (ih - hh) / 2, iw, hh, undefined, 'FAST');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...NAVY);
        doc.text(doc.splitTextToSize(clean(`${i + 1}. ${p.label || ''}`), cw).slice(0, 2), x, y + ih + 10);
        const capLine = [p.caption, p.takenAt ? new Date(p.takenAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''].filter(Boolean).join('  |  ');
        if (capLine) { doc.setFont('helvetica', 'normal'); doc.setTextColor(...GREY); doc.text(doc.splitTextToSize(clean(capLine), cw).slice(0, 1), x, y + ih + 28); }
      }
    }

    /* --- Footer on every page --- */
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setDrawColor(221, 227, 234); doc.setLineWidth(0.5); doc.line(M, H - 34, W - M, H - 34);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...NAVY); doc.text(clean(ent.name), M, H - 22);
      const nw = doc.getTextWidth(clean(ent.name));
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...GREY);
      doc.text(clean(`  |  ${def.reportTitle}  |  ${fmtD(insp.fields.date)}  |  Confidential${sample ? '  |  SAMPLE DATA' : ''}`), M + nw, H - 22);
      doc.text(`Page ${i} of ${n}`, W - M, H - 22, { align: 'right' });
      if (i > 1) {
        // Running header: company + site name on every page after the cover.
        const company = settings.company || CFG.company || 'Atlantic Development';
        doc.setFillColor(...NAVY); doc.rect(0, 0, W, 4, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...NAVY);
        doc.text(clean(ent.name), M, 24, { maxWidth: W - 2 * M - 200 });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY);
        doc.text(clean(`${company}  |  ${def.reportTitle}  |  ${fmtD(insp.fields.date)}`), W - M, 24, { align: 'right' });
        doc.setDrawColor(221, 227, 234); doc.line(M, 32, W - M, 32);
      }
    }
    const name = `${fileSafe(ent.name)} - ${def.name} - ${insp.fields.date || 'undated'}.pdf`;
    return { blob: doc.output('blob'), name, doc };
  }
  return { build };
})();
