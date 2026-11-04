'use strict';
/* Bulk photo sorting: pick many photos (camera roll / Meta glasses), sort by capture time, assign to checklist items.
   Queued photos are compressed and stored right away (same as normal photos) and listed in insp.bulkQueue,
   so the queue survives closing the app. Assigning moves a photo id from the queue onto an item. */

// Minimal EXIF reader: DateTimeOriginal (0x9003), falling back to DateTime (0x0132). JPEG only.
async function exifTime(file) {
  try {
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o < v.byteLength - 10) {
      const m = v.getUint16(o); if ((m & 0xFF00) !== 0xFF00 || m === 0xFFDA) break;
      const len = v.getUint16(o + 2);
      if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const g16 = p => v.getUint16(p, le), g32 = p => v.getUint32(p, le);
        const str = e => { const n = g32(e + 4), off = n > 4 ? t + g32(e + 8) : e + 8; let s = ''; for (let i = 0; i < n - 1 && off + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(off + i)); return s; };
        const ifd = (p, cb) => { const n = g16(p); for (let i = 0; i < n; i++) cb(g16(p + 2 + i * 12), p + 2 + i * 12); };
        let dt = null, dto = null, ex = null;
        ifd(t + g32(t + 4), (tag, e) => { if (tag === 0x0132) dt = str(e); if (tag === 0x8769) ex = t + g32(e + 8); });
        if (ex) ifd(ex, (tag, e) => { if (tag === 0x9003) dto = str(e); });
        const mm = (dto || dt || '').match(/(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
        return mm ? new Date(+mm[1], mm[2] - 1, +mm[3], +mm[4], +mm[5], +mm[6]).getTime() : null;
      }
      o += 2 + len;
    }
  } catch (e) { /* unreadable metadata -> fall back */ }
  return null;
}

// Every place a photo can go, grouped by section. Repeater rows (units, buildings, open items) are targets too.
function bulkTargets(insp) {
  const out = [{ key: 'general', group: 'General', label: 'General / unassigned', path: 'General' }];
  for (const sec of CFG.types[insp.type].sections) {
    for (const it of sec.items || []) out.push({ key: 'item:' + it.id, group: sec.title, secId: sec.id, label: it.label, path: `${sec.title} — ${it.label}` });
    if (sec.repeater) (insp.reps[sec.repeater.id] || []).forEach(r => {
      const nm = r[sec.repeater.titleField]; if (!nm) return;
      out.push({ key: `rep:${sec.repeater.id}:${r._id}`, group: sec.title, secId: sec.id, label: `${sec.repeater.label}: ${nm}`, path: `${sec.title} — ${nm}` });
    });
  }
  return out;
}
function targetArray(insp, key) {
  if (key === 'general') return (insp.generalPhotos ||= []);
  if (key.startsWith('item:')) { const id = key.slice(5); const a = (insp.items[id] ||= { rating: null, notes: '', photos: [], flag: false }); return (a.photos ||= []); }
  const [, repId, rowId] = key.split(':'); const row = (insp.reps[repId] || []).find(r => r._id === rowId);
  return row ? (row.photos ||= []) : null;
}

async function viewBulk(id) {
  const insp = await DB.get('inspections', id); if (!insp) { location.hash = '#/'; return; }
  const ent = await DB.get('entities', insp.entityId);
  S.insp = insp; S.prev = null; S.refresh = () => {};
  insp.bulkQueue ||= [];
  setBar('Sort photos', ent.name, '#/i/' + insp.id);
  const targets = bulkTargets(insp);
  const tByKey = Object.fromEntries(targets.map(t => [t.key, t]));
  let lastKey = insp.bulkLast && tByKey[insp.bulkLast] ? insp.bulkLast : null;
  const selected = new Set();
  const photos = new Map(); // id -> record

  const info = h('div', { class: 'small muted', style: 'margin:0 4px 10px' });
  const prog = h('div', { class: 'small', style: 'margin:6px 4px;font-weight:600', hidden: true });
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, id: 'bulkInput', onchange: async e => {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    prog.hidden = false;
    let i = 0;
    for (const f of files) {
      prog.textContent = `Preparing photo ${++i} of ${files.length}…`;
      try {
        const exif = await exifTime(f);
        const { blob, w, h: hh } = await compressImage(f);
        const p = { id: uid(), inspectionId: insp.id, blob, w, h: hh, caption: '', label: 'Unsorted', pending: true,
          takenAt: exif || f.lastModified || Date.now(), takenSrc: exif ? 'exif' : 'file', fileName: f.name, createdAt: Date.now() };
        await DB.put('photos', p); insp.bulkQueue.push(p.id); photos.set(p.id, p);
        if (i % 5 === 0) await saveNow();
      } catch (err) { toast(`${f.name}: ${err.message}`); }
    }
    await saveNow(); prog.hidden = true; draw();
  } });
  $view.append(file,
    h('div', { class: 'card' },
      h('div', { style: 'font-weight:700;font-size:17px' }, 'Add photos in bulk'),
      h('div', { class: 'small muted', style: 'margin:4px 0 8px' }, 'Pick photos from your library (e.g. synced from your glasses). They’re sorted by the time they were taken. Assign each to a checklist item, or select several and assign them together. Unsorted photos are saved, so you can come back later.'),
      h('button', { class: 'btn', id: 'bulkPick', onclick: () => file.click() }, h('span', { html: ICON.cam }), 'Choose photos')),
    prog, info);
  const list = h('div', { id: 'bulkList' });
  $view.append(list);

  const bar = h('div', { class: 'bottombar bulkbar' });
  document.body.append(bar);

  for (const pid of insp.bulkQueue) { const p = await DB.get('photos', pid); if (p) photos.set(pid, p); }
  insp.bulkQueue = insp.bulkQueue.filter(pid => photos.has(pid));

  async function assign(ids, key) {
    const t = tByKey[key]; const arr = targetArray(insp, key);
    if (!t || !arr) { toast('That item is no longer available'); return; }
    for (const pid of ids) {
      const p = photos.get(pid); if (!p) continue;
      p.pending = false; p.label = t.path; await DB.put('photos', p);
      arr.push(pid); insp.bulkQueue = insp.bulkQueue.filter(x => x !== pid); photos.delete(pid); selected.delete(pid);
    }
    if (key !== 'general') { lastKey = key; insp.bulkLast = key; }
    await saveNow(); toast(`${ids.length} photo${ids.length === 1 ? '' : 's'} → ${t.label}`, 1500); draw();
  }
  async function skip(ids) {
    for (const pid of ids) { await DB.del('photos', pid); insp.bulkQueue = insp.bulkQueue.filter(x => x !== pid); photos.delete(pid); selected.delete(pid); }
    await saveNow(); draw();
  }

  function draw() {
    const q = insp.bulkQueue.map(pid => photos.get(pid)).filter(Boolean).sort((a, b) => a.takenAt - b.takenAt);
    info.textContent = q.length ? `${q.length} photo${q.length === 1 ? '' : 's'} to sort · tap ☐ to select several` : '';
    list.innerHTML = '';
    if (!q.length) list.append(h('div', { class: 'empty' }, 'No photos waiting. Choose photos to start, or go back to the inspection.'));
    for (const p of q) {
      const sel = selected.has(p.id);
      const card = h('div', { class: 'card bulkcard' + (sel ? ' sel' : ''), 'data-photo': p.id });
      const img = h('img', { src: '', alt: 'photo', loading: 'lazy', class: 'bulkimg', onclick: () => toggle(p.id) });
      photoUrl(p.id).then(u => (img.src = u));
      const time = new Date(p.takenAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
      card.append(
        h('div', { class: 'bulkimgwrap' }, img,
          h('button', { type: 'button', class: 'selbox' + (sel ? ' on' : ''), 'aria-label': 'Select photo', onclick: () => toggle(p.id) }, sel ? '✓' : ''),
          h('div', { class: 'timetag' }, time + (p.takenSrc === 'exif' ? '' : ' (file time)'))),
        h('input', { type: 'text', class: 'bulkcap', placeholder: 'Caption (optional)', value: p.caption || '', oninput: async e => { p.caption = e.target.value; await DB.put('photos', p); } }),
        h('div', { class: 'bulkacts' },
          lastKey ? h('button', { type: 'button', class: 'quick', onclick: () => assign([p.id], lastKey) }, h('small', {}, 'Same as last:'), tByKey[lastKey].label) : null,
          h('button', { type: 'button', class: 'pick', onclick: () => openPicker(key => assign([p.id], key)) }, lastKey ? 'Other item…' : 'Assign to item…'),
          h('button', { type: 'button', class: 'gen', onclick: () => assign([p.id], 'general') }, 'General'),
          h('button', { type: 'button', class: 'skip', onclick: () => skip([p.id]) }, 'Skip')));
      list.append(card);
    }
    // Bottom bar: multi-select actions, or back to the inspection.
    bar.innerHTML = '';
    if (selected.size) {
      bar.append(h('div', { class: 'prog' }, h('div', { style: 'font-weight:700' }, `${selected.size} selected`),
          h('button', { type: 'button', class: 'linkbtn', onclick: () => { q.forEach(p => selected.add(p.id)); draw(); } }, 'Select all'),
          h('button', { type: 'button', class: 'linkbtn', onclick: () => { selected.clear(); draw(); } }, 'Clear')),
        h('button', { class: 'btn', id: 'assignSelected', onclick: () => openPicker(key => assign([...selected], key)) }, 'Assign selected…'));
    } else {
      bar.append(h('div', { class: 'prog' }, h('div', { class: 'ptxt' }, q.length ? `${q.length} left to sort` : 'All sorted')),
        h('button', { class: 'btn', onclick: () => (location.hash = '#/i/' + insp.id) }, 'Back to inspection'));
    }
  }
  function toggle(pid) { selected.has(pid) ? selected.delete(pid) : selected.add(pid); draw(); }

  function openPicker(onPick) {
    const m = document.getElementById('modal');
    const search = h('input', { type: 'search', class: 'search', placeholder: 'Search items (e.g. pool, roof, Bldg 2)', id: 'pickSearch', oninput: () => render() });
    const box = h('div', { class: 'picklist' });
    const lastSec = lastKey ? tByKey[lastKey].secId : null;
    function render() {
      const q = search.value.trim().toLowerCase();
      box.innerHTML = '';
      const hits = targets.filter(t => !q || `${t.group} ${t.label}`.toLowerCase().includes(q));
      // Last-used section first so the next photo from the same area is one tap away.
      let groups = [...new Set(hits.map(t => t.group))]; // General first (it is first in targets), then checklist order
      const lg = groups.find(g => hits.find(t => t.group === g).secId === lastSec);
      if (lg) groups = groups.filter(g => g !== lg).toSpliced(groups[0] === 'General' ? 1 : 0, 0, lg);
      for (const g of groups) {
        const items = hits.filter(t => t.group === g);
        const open = !!q || g === 'General' || items[0].secId === lastSec || (!lastSec && groups.length <= 3);
        const det = h('details', { class: 'pickgrp', open: open ? true : null }, h('summary', {}, g, h('span', { class: 'cnt' }, items[0].secId === lastSec ? 'last used' : '')));
        for (const t of items) det.append(h('button', { type: 'button', class: 'pickitem' + (t.key === lastKey ? ' last' : ''), 'data-key': t.key, onclick: () => { closeModal(); onPick(t.key); } }, t.label));
        box.append(det);
      }
      if (!hits.length) box.append(h('div', { class: 'empty' }, 'No matching items.'));
    }
    render();
    m.innerHTML = '';
    m.append(h('div', { class: 'sheet pickersheet' },
      h('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px' }, h('b', {}, 'Assign to…'), h('button', { class: 'linkbtn', onclick: closeModal }, 'Cancel')),
      search, box));
    m.hidden = false; m.onclick = e => { if (e.target === m) closeModal(); };
  }
  draw();
}

// Warn before leaving the page while photos are still unsorted (desktop browsers; iOS keeps the queue anyway).
window.addEventListener('beforeunload', e => { if (S.insp && (S.insp.bulkQueue || []).length) { e.preventDefault(); e.returnValue = ''; } });
