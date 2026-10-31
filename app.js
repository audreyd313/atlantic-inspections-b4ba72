'use strict';
/* Property Inspections v1 — vanilla JS, offline-first. Checklists live in checklists.json. */
let CFG = null;
let SETTINGS = {};
const S = { tab: 'property', insp: null, prev: null, entity: null, q: '' };
const $view = document.getElementById('view');
const today = () => new Date().toLocaleDateString('en-CA');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  note: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
  cam: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  flag: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 21V4h11l-2 4 2 4H5"/></svg>',
};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kd of kids.flat(Infinity)) { if (kd == null || kd === false) continue; el.append(kd.nodeType ? kd : document.createTextNode(kd)); }
  return el;
}
function fmtDate(d) { if (!d) return ''; const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtVal(f, v) {
  if (v === '' || v == null) return '—';
  if (f.type === 'percent') return `${v}%`;
  if (f.type === 'currency') return '$' + Number(v).toLocaleString('en-US');
  if (f.type === 'date') return fmtDate(v);
  return String(v);
}
function toast(msg, ms = 2200) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); }
function downloadBlob(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }
const fileSafe = s => String(s || 'Unnamed site').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90);
const slug = s => String(s || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50);

/* ---------- Scoring & shared logic (also used by pdf.js) ---------- */
const Core = {
  type: t => CFG.types[t],
  allItems: t => CFG.types[t].sections.flatMap(s => (s.items || []).map(i => ({ ...i, section: s }))),
  secScore(sec, insp) {
    const r = (sec.items || []).map(i => insp.items[i.id]?.rating).filter(x => typeof x === 'number');
    return { avg: r.length ? r.reduce((a, b) => a + b, 0) / r.length : null, n: r.length, total: (sec.items || []).length };
  },
  // Overall = weighted average of section averages (N/A and unrated items ignored; weight defaults to 1).
  overall(insp) {
    let w = 0, s = 0;
    for (const sec of CFG.types[insp.type].sections) {
      const sc = Core.secScore(sec, insp);
      if (sc.avg != null) { const wt = sec.weight ?? 1; w += wt; s += sc.avg * wt; }
    }
    return w ? s / w : null;
  },
  band(v) { return v == null ? { label: 'Not rated', color: '#98a2b3' } : CFG.rating.bands.find(b => v >= b.min); },
  progress(insp) {
    const items = Core.allItems(insp.type);
    return { done: items.filter(i => insp.items[i.id]?.rating != null).length, total: items.length };
  },
  actionItems(insp) {
    const out = [];
    for (const sec of CFG.types[insp.type].sections) {
      for (const it of sec.items || []) {
        const a = insp.items[it.id];
        if (a?.flag) out.push({ section: sec.title, item: it.label, priority: a.priority || 'Medium', owner: a.owner || '', due: a.due || '', notes: a.notes || '', rating: a.rating, status: 'Open', source: 'Flagged item' });
      }
      if (sec.repeater?.carryOpen) {
        for (const r of insp.reps[sec.repeater.id] || []) {
          if (r.item && r.status !== 'Closed') out.push({ section: sec.title, item: r.item, priority: r.priority || 'Medium', owner: r.owner || '', due: r.due || '', notes: r.notes || '', rating: null, status: r.status || 'Open', source: r.carried ? 'Carried from last visit' : 'Open item' });
        }
      }
    }
    const ord = { High: 0, Medium: 1, Low: 2 };
    return out.sort((a, b) => (ord[a.priority] ?? 1) - (ord[b.priority] ?? 1));
  },
  async previous(insp) {
    const d = insp.fields.date || '9999-12-31';
    const list = (await DB.byIndex('inspections', 'entityId', insp.entityId))
      .filter(x => x.id !== insp.id && x.type === insp.type && x.status === 'complete')
      .filter(x => (x.fields.date || '') < d || ((x.fields.date || '') === d && x.createdAt < insp.createdAt))
      .sort((a, b) => (b.fields.date || '').localeCompare(a.fields.date || '') || b.createdAt - a.createdAt);
    return list[0] || null;
  },
  csv(rows) { return rows.map(r => r.map(c => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n'); },
};

/* ---------- App bar & save state ---------- */
function setBar(title, sub = '', back = null) {
  document.getElementById('title').textContent = title;
  document.getElementById('subtitle').textContent = sub;
  const b = document.getElementById('backBtn');
  b.hidden = !back; b.onclick = () => (location.hash = back);
  // Brand logo shows on top-level screens (where there's no back button) so it never crowds a site name.
  document.getElementById('brandLogo').hidden = !!back;
  document.getElementById('saveState').textContent = '';
  window.scrollTo(0, 0);
}
let saveTimer = null;
function queueSave() {
  if (!S.insp) return;
  document.getElementById('saveState').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
async function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!S.insp) return;
  S.insp.updatedAt = Date.now();
  await DB.put('inspections', S.insp);
  document.getElementById('saveState').textContent = 'Saved ✓';
}
window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) saveNow(); });

/* ---------- Router ---------- */
async function route() {
  if (saveTimer) await saveNow();
  closeModal();
  document.getElementById('toast').hidden = true;
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  const [r, id] = parts;
  document.querySelectorAll('.bottombar,.fab').forEach(e => e.remove());
  $view.innerHTML = '';
  S.insp = null;
  try {
    if (!r) await viewHome();
    else if (r === 'new') await viewEntityForm(null, id);
    else if (r === 'edit') await viewEntityForm(id);
    else if (r === 'e') await viewEntity(id);
    else if (r === 'i') await viewInspect(id);
    else if (r === 'r') await viewReport(id);
    else if (r === 'settings') await viewSettings();
    else location.hash = '#/';
  } catch (e) { console.error(e); $view.append(h('div', { class: 'card' }, 'Something went wrong: ' + e.message)); }
}

/* ---------- Home ---------- */
async function viewHome() {
  setBar('Property Inspections', SETTINGS.company || 'Property walks & site visits');
  const [ents, insps] = await Promise.all([DB.all('entities'), DB.all('inspections')]);
  const byEnt = {};
  for (const i of insps) (byEnt[i.entityId] ||= []).push(i);
  const drafts = insps.filter(i => i.status === 'draft').sort((a, b) => b.updatedAt - a.updatedAt);
  const entMap = Object.fromEntries(ents.map(e => [e.id, e]));

  if (drafts.length) {
    $view.append(h('h2', {}, 'In progress'));
    for (const d of drafts) {
      const e = entMap[d.entityId]; if (!e) continue;
      const p = Core.progress(d);
      $view.append(h('div', { class: 'card ent', onclick: () => (location.hash = '#/i/' + d.id) },
        h('div', { class: 'main' }, h('div', { class: 'name' }, e.name, h('span', { class: 'badge draft' }, 'Draft')),
          h('div', { class: 'meta' }, `${CFG.types[d.type].name} · ${fmtDate(d.fields.date)} · ${p.done}/${p.total} rated`)),
        h('div', { class: 'btn teal', style: 'width:auto;padding:0 14px;min-height:42px;margin:0' }, 'Resume')));
    }
  }

  const cnt = k => ents.filter(e => e.kind === k).length;
  const tabs = h('div', { class: 'tabs' },
    h('button', { class: S.tab === 'property' ? 'on' : '', onclick: () => { S.tab = 'property'; route(); } }, `Operating (${cnt('property')})`),
    h('button', { class: S.tab === 'project' ? 'on' : '', onclick: () => { S.tab = 'project'; route(); } }, `Construction (${cnt('project')})`));
  $view.append(h('h2', {}, 'Portfolio'), tabs);
  const list = h('div');
  const search = h('input', { class: 'search', type: 'search', placeholder: S.tab === 'property' ? 'Search properties' : 'Search projects', value: S.q, oninput: e => { S.q = e.target.value; draw(); } });
  $view.append(search, list);
  function draw() {
    list.innerHTML = '';
    const q = S.q.trim().toLowerCase();
    const items = ents.filter(e => e.kind === S.tab && (!q || `${e.name} ${e.city || ''}`.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
    if (!items.length) list.append(h('div', { class: 'empty' }, q ? 'No matches.' : S.tab === 'property' ? 'No properties yet. Tap “Add property” to get started, or import your property list.' : 'No construction projects yet. Tap “Add project”.'));
    if (!items.length && !q && S.tab === 'property') list.append(importButton());
    for (const e of items) {
      const done = (byEnt[e.id] || []).filter(i => i.status === 'complete').sort((a, b) => (b.fields.date || '').localeCompare(a.fields.date || ''));
      const last = done[0];
      let pill = null;
      if (last && e.kind === 'property') { const sc = Core.overall(last); const b = Core.band(sc); pill = h('div', { class: 'scorepill', style: `background:${b.color}` }, sc == null ? '—' : sc.toFixed(1), h('small', {}, 'score')); }
      if (last && e.kind === 'project') pill = h('div', { class: 'scorepill', style: 'background:#1e3a5f' }, last.fields.pctComplete !== '' && last.fields.pctComplete != null ? last.fields.pctComplete + '%' : '—', h('small', {}, 'complete'));
      const hasDraft = (byEnt[e.id] || []).some(i => i.status === 'draft');
      list.append(h('div', { class: 'card ent', onclick: () => (location.hash = '#/e/' + e.id) },
        h('div', { class: 'main' },
          h('div', { class: 'name' }, e.name, e.sample ? h('span', { class: 'badge sample' }, 'Sample') : null, hasDraft ? h('span', { class: 'badge draft' }, 'Draft') : null),
          h('div', { class: 'meta' }, [e.city, e.units ? `${e.units} units` : null].filter(Boolean).join(' · ')),
          h('div', { class: 'meta' }, last ? `Last ${e.kind === 'property' ? 'walk' : 'visit'}: ${fmtDate(last.fields.date)}` : 'Not inspected yet')),
        pill, h('div', { class: 'chev' }, '›')));
    }
  }
  draw();
  document.body.append(h('button', { class: 'fab', onclick: () => (location.hash = '#/new/' + S.tab) }, S.tab === 'property' ? '+ Add property' : '+ Add project'));
}

/* ---------- Property / project form ---------- */
const ENTITY_FIELDS = {
  property: [
    { id: 'name', label: 'Property / site name (required)', type: 'text', required: true }, { id: 'address', label: 'Street address', type: 'text' },
    { id: 'city', label: 'City, State', type: 'text' }, { id: 'zip', label: 'ZIP', type: 'text' }, { id: 'units', label: 'Units', type: 'number' },
    { id: 'bin', label: 'Property # (BIN)', type: 'text' }, { id: 'yearBuilt', label: 'Year built', type: 'number' },
    { id: 'manager', label: 'Management company', type: 'text' }, { id: 'regional', label: 'Regional manager', type: 'text' },
    { id: 'contact', label: 'Site contact', type: 'text' }, { id: 'phone', label: 'Office phone', type: 'tel' },
    { id: 'email', label: 'Office email', type: 'email' },
    { id: 'owner', label: 'Ownership entity', type: 'text' }, { id: 'notes', label: 'Notes', type: 'textarea' }],
  project: [
    { id: 'name', label: 'Project / site name (required)', type: 'text', required: true }, { id: 'address', label: 'Site address', type: 'text' },
    { id: 'city', label: 'City, State', type: 'text' }, { id: 'units', label: 'Total units', type: 'number' },
    { id: 'buildings', label: 'Buildings / phases', type: 'number' }, { id: 'gc', label: 'General contractor', type: 'text' },
    { id: 'start', label: 'Construction start', type: 'date' }, { id: 'target', label: 'Target completion / TCO', type: 'date' },
    { id: 'notes', label: 'Notes', type: 'textarea' }],
};
async function viewEntityForm(id, kind) {
  const e = id ? await DB.get('entities', id) : { id: uid(), kind: kind === 'project' ? 'project' : 'property', createdAt: Date.now() };
  setBar(id ? `Edit ${e.name}` : e.kind === 'property' ? 'Add property' : 'Add project', '', id ? '#/e/' + id : '#/');
  const card = h('div', { class: 'card' });
  for (const f of ENTITY_FIELDS[e.kind]) card.append(fieldEl(f, () => e[f.id], v => (e[f.id] = v)));
  card.append(h('label', { class: 'f', style: 'display:flex;gap:10px;align-items:center' },
    h('input', { type: 'checkbox', style: 'width:24px;height:24px;min-height:0', checked: e.sample ? true : null, onchange: ev => (e.sample = ev.target.checked) }),
    h('span', { style: 'margin:0' }, 'This is sample / test data (marks reports “SAMPLE”)')));
  $view.append(card,
    h('button', { class: 'btn', id: 'saveEntity', onclick: async () => {
      if (!String(e.name || '').trim()) { toast('Site name is required - it appears on every report'); card.querySelector('[data-field="name"]').focus(); return; }
      e.name = e.name.trim(); e.updatedAt = Date.now();
      await DB.put('entities', e); S.tab = e.kind; location.hash = '#/e/' + e.id;
    } }, 'Save'));
  if (id) $view.append(h('button', { class: 'btn danger', onclick: async () => {
    if (!confirm(`Delete ${e.name} and all of its inspections and photos? This can't be undone.`)) return;
    for (const i of await DB.byIndex('inspections', 'entityId', e.id)) await deleteInspection(i.id);
    await DB.del('entities', e.id); location.hash = '#/';
  } }, 'Delete'));
}

/* ---------- Property / project detail ---------- */
async function viewEntity(id) {
  const e = await DB.get('entities', id); if (!e) { location.hash = '#/'; return; }
  setBar(e.name, [e.city, e.units ? `${e.units} units` : ''].filter(Boolean).join(' · '), '#/');
  const insps = (await DB.byIndex('inspections', 'entityId', id)).sort((a, b) => (b.fields.date || '').localeCompare(a.fields.date || '') || b.createdAt - a.createdAt);
  const draft = insps.find(i => i.status === 'draft');
  const typeKey = e.kind === 'project' ? 'construction' : 'routine';
  if (e.sample) $view.append(h('div', { class: 'samplebar' }, 'SAMPLE DATA — created for testing'));
  const info = h('dl', { class: 'kv' });
  for (const f of ENTITY_FIELDS[e.kind].slice(1)) if (e[f.id] !== '' && e[f.id] != null) {
    const v = fmtVal(f, e[f.id]);
    const dd = f.type === 'tel' ? h('a', { href: 'tel:' + String(e[f.id]).replace(/[^\d+]/g, '') }, v)
      : f.type === 'email' ? h('a', { href: 'mailto:' + e[f.id] }, v)
      : f.id === 'address' ? h('a', { href: 'https://maps.apple.com/?q=' + encodeURIComponent([e.address, e.city, e.zip].filter(Boolean).join(', ')), target: '_blank', rel: 'noopener' }, v) : v;
    info.append(h('dt', {}, f.label), h('dd', {}, dd));
  }
  $view.append(h('div', { class: 'card' }, info.children.length ? info : h('div', { class: 'muted' }, 'No details yet.'),
    h('button', { class: 'btn secondary', style: 'min-height:44px;margin-top:12px', onclick: () => (location.hash = '#/edit/' + id) }, 'Edit details')));
  if (draft) $view.append(h('button', { class: 'btn teal', onclick: () => (location.hash = '#/i/' + draft.id) }, `Resume draft (${fmtDate(draft.fields.date)})`));
  $view.append(h('button', { class: draft ? 'btn secondary' : 'btn', id: 'startInspection', onclick: async () => {
    if (!String(e.name || '').trim()) { toast('Add the site name before starting - it appears on every report'); location.hash = '#/edit/' + id; return; }
    if (draft && !confirm('You already have a draft for this property. Start another one anyway?')) return;
    const insp = await newInspection(e, typeKey); location.hash = '#/i/' + insp.id;
  } }, e.kind === 'project' ? '+ Start site visit' : '+ Start property walk'));

  $view.append(h('h2', {}, 'History'));
  if (!insps.length) $view.append(h('div', { class: 'empty' }, 'No inspections yet.'));
  for (const i of insps) {
    const sc = Core.overall(i), b = Core.band(sc), ai = Core.actionItems(i).length;
    const right = e.kind === 'project'
      ? h('div', { class: 'scorepill', style: 'background:#1e3a5f' }, i.fields.pctComplete !== '' && i.fields.pctComplete != null ? i.fields.pctComplete + '%' : '—', h('small', {}, 'complete'))
      : h('div', { class: 'scorepill', style: `background:${b.color}` }, sc == null ? '—' : sc.toFixed(1), h('small', {}, 'score'));
    $view.append(h('div', { class: 'card ent', onclick: () => (location.hash = (i.status === 'draft' ? '#/i/' : '#/r/') + i.id) },
      h('div', { class: 'main' },
        h('div', { class: 'name', style: 'font-size:16px' }, fmtDate(i.fields.date), h('span', { class: 'badge ' + (i.status === 'draft' ? 'draft' : 'done') }, i.status === 'draft' ? 'Draft' : 'Complete')),
        h('div', { class: 'meta' }, `${CFG.types[i.type].name}${i.fields.inspector ? ' · ' + i.fields.inspector : ''}`),
        h('div', { class: 'meta' }, `${ai} action item${ai === 1 ? '' : 's'}${e.kind === 'project' && sc != null ? ` · quality/safety ${sc.toFixed(1)}` : ''}`)),
      right, h('div', { class: 'chev' }, '›')));
  }
}

async function newInspection(entity, type) {
  if (!String(entity.name || '').trim()) throw new Error('Site name is required before starting an inspection');
  const insp = { id: uid(), entityId: entity.id, type, status: 'draft', createdAt: Date.now(), updatedAt: Date.now(),
    fields: { date: today(), inspector: SETTINGS.inspector || '' }, items: {}, reps: {} };
  const prev = await Core.previous(insp);
  const def = CFG.types[type];
  if (type === 'construction' && entity.gc) insp.fields.gc = entity.gc;
  if (prev) {
    for (const f of def.header) if (f.carry && prev.fields[f.id]) insp.fields[f.id] = prev.fields[f.id];
    for (const sec of def.sections) {
      const rep = sec.repeater; if (!rep) continue;
      const rows = prev.reps[rep.id] || [];
      // Building list carries forward by name so this visit's % sits next to last visit's.
      if (rep.carry) insp.reps[rep.id] = rows.filter(r => r[rep.compareKey]).map(r => ({ _id: uid(), [rep.compareKey]: r[rep.compareKey], photos: [] }));
      // Open items that weren't closed roll forward to the next visit.
      if (rep.carryOpen) insp.reps[rep.id] = rows.filter(r => r.item && r.status !== 'Closed').map(r => ({ ...r, _id: uid(), photos: [], carried: true, status: 'Open' }));
    }
  }
  await DB.put('inspections', insp);
  return insp;
}

/* ---------- Generic field renderer ---------- */
function fieldEl(f, get, set, opts = {}) {
  const isSeg = f.type === 'segmented';
  const wrap = h(isSeg ? 'div' : 'label', { class: 'f' + (f.type === 'textarea' || isSeg || opts.wide ? ' wide' : '') }, h('span', {}, f.label));
  let cmpEl = null;
  const hasCmp = opts.cmp !== undefined && opts.cmp !== null && opts.cmp !== '';
  const updCmp = () => {
    if (!cmpEl) return;
    const cur = get(); let delta = '';
    if (['percent', 'number', 'currency'].includes(f.type) && cur !== '' && cur != null && !isNaN(cur)) {
      const d = Number(cur) - Number(opts.cmp);
      if (d !== 0) delta = ` <span class="${f.type === 'percent' ? (d > 0 ? 'delta-up' : 'delta-down') : ''}">(${d > 0 ? '+' : ''}${f.type === 'currency' ? '$' + d.toLocaleString('en-US') : d}${f.type === 'percent' ? ' pts' : ''})</span>`;
    }
    cmpEl.innerHTML = `Last visit${opts.cmpDate ? ' (' + esc(fmtDate(opts.cmpDate)) + ')' : ''}: <b>${esc(fmtVal(f, opts.cmp))}</b>${delta}`;
  };
  const doSet = v => { set(v); updCmp(); opts.onChange && opts.onChange(v); };
  let input;
  if (f.type === 'select') {
    input = h('select', { onchange: e => doSet(e.target.value) }, h('option', { value: '' }, 'Select…'), f.options.map(o => h('option', { value: o }, o)));
    input.value = get() ?? '';
  } else if (isSeg) {
    input = h('div', { class: 'seg', role: 'group', 'aria-label': f.label });
    const draw = () => { input.innerHTML = ''; for (const o of f.options) input.append(h('button', { type: 'button', class: get() === o ? 'on' : '', 'data-v': o, onclick: () => { doSet(get() === o && !f.sticky ? '' : o); draw(); } }, o)); };
    draw();
  } else if (f.type === 'textarea') {
    input = h('textarea', { oninput: e => doSet(e.target.value) }); input.value = get() ?? '';
  } else {
    const num = ['number', 'percent', 'currency'].includes(f.type);
    input = h('input', { type: num ? 'number' : ['date', 'tel', 'email'].includes(f.type) ? f.type : 'text', inputmode: num ? (f.type === 'number' ? 'numeric' : 'decimal') : null,
      min: f.type === 'percent' ? 0 : null, max: f.type === 'percent' ? 100 : null, step: f.type === 'currency' ? '0.01' : 'any',
      placeholder: f.type === 'percent' ? '0–100' : f.type === 'currency' ? '$' : null, value: get() ?? '',
      oninput: e => doSet(num ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value) });
  }
  input.dataset.field = f.id;
  wrap.append(input);
  if (hasCmp) { cmpEl = h('div', { class: 'cmp' }); wrap.append(cmpEl); updCmp(); }
  return wrap;
}

/* ---------- Photos ---------- */
const urlCache = new Map();
async function photoUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const p = await DB.get('photos', id); if (!p) return null;
  const u = URL.createObjectURL(p.blob); urlCache.set(id, u); return u;
}
function compressImage(file, max = 1600, quality = 0.72) {
  return new Promise((res, rej) => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * r), hh = Math.round(img.naturalHeight * r);
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      c.getContext('2d').drawImage(img, 0, 0, w, hh);
      URL.revokeObjectURL(u);
      c.toBlob(b => (b ? res({ blob: b, w, h: hh }) : rej(new Error('Could not compress photo'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Unsupported image')); };
    img.src = u;
  });
}
function photoWidget(arr, label) {
  const thumbs = h('div', { class: 'thumbs' });
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) {
      try {
        const { blob, w, h: hh } = await compressImage(f);
        const p = { id: uid(), inspectionId: S.insp.id, blob, w, h: hh, caption: '', label, createdAt: Date.now() };
        await DB.put('photos', p); arr.push(p.id);
      } catch (err) { toast(err.message); }
    }
    queueSave(); draw(); btnCount();
  } });
  let countEl = h('span');
  const btnCount = () => (countEl.textContent = arr.length ? `Photo (${arr.length})` : 'Photo');
  btnCount();
  async function draw() {
    thumbs.innerHTML = '';
    for (const id of arr) {
      const u = await photoUrl(id); if (!u) continue;
      thumbs.append(h('img', { src: u, alt: 'photo', onclick: () => openPhoto(id, arr, () => { draw(); btnCount(); }) }));
    }
  }
  draw();
  const button = h('button', { type: 'button', class: 'photobtn', onclick: () => file.click() }, h('span', { html: ICON.cam }), countEl);
  return { button, thumbs, file };
}
async function openPhoto(id, arr, after) {
  const p = await DB.get('photos', id);
  const m = document.getElementById('modal');
  const cap = h('input', { type: 'text', placeholder: 'Caption (shows in the report)', value: p.caption || '', oninput: async e => { p.caption = e.target.value; await DB.put('photos', p); } });
  m.innerHTML = '';
  m.append(h('div', { class: 'sheet' },
    h('img', { src: await photoUrl(id), alt: '' }),
    h('div', { class: 'small muted', style: 'margin:8px 0' }, p.label || ''),
    h('label', { class: 'f' }, h('span', {}, 'Caption'), cap),
    h('div', { class: 'row2' },
      h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm('Delete this photo?')) return;
        arr.splice(arr.indexOf(id), 1); await DB.del('photos', id); queueSave(); closeModal(); after();
      } }, 'Delete'),
      h('button', { class: 'btn', onclick: closeModal }, 'Done'))));
  m.hidden = false;
  m.onclick = e => { if (e.target === m) closeModal(); };
}
function closeModal() { const m = document.getElementById('modal'); m.hidden = true; m.innerHTML = ''; }

/* ---------- Inspection screen ---------- */
async function viewInspect(id) {
  const insp = await DB.get('inspections', id); if (!insp) { location.hash = '#/'; return; }
  const ent = await DB.get('entities', insp.entityId);
  S.insp = insp; S.entity = ent; S.prev = await Core.previous(insp);
  const def = CFG.types[insp.type];
  setBar(ent.name, `${def.name}${insp.status === 'complete' ? ' (editing completed)' : ' · draft'}`, '#/e/' + ent.id);
  document.getElementById('saveState').textContent = 'Saved ✓';
  if (ent.sample) $view.append(h('div', { class: 'samplebar' }, 'SAMPLE DATA — created for testing'));

  const cmpOpts = f => (f.compare && S.prev ? { cmp: S.prev.fields[f.id], cmpDate: S.prev.fields.date } : {});
  const hdr = h('div', { class: 'grid2' });
  for (const f of def.header) hdr.append(fieldEl(f, () => insp.fields[f.id], v => { insp.fields[f.id] = v; queueSave(); }, cmpOpts(f)));
  $view.append(h('div', { class: 'card' },
    h('div', { style: 'font-weight:700;margin-bottom:10px' }, def.name + ' details'),
    S.prev ? h('div', { class: 'small muted', style: 'margin:-6px 0 10px' }, `Comparing to last ${insp.type === 'construction' ? 'visit' : 'walk'} on ${fmtDate(S.prev.fields.date)}`) : null,
    hdr));

  const secEls = {};
  def.sections.forEach((sec, idx) => {
    const sum = h('summary', {}, h('span', { class: 't' }, sec.title), h('span', { class: 'cnt' }), h('span', { class: 'chip' }));
    const body = h('div', { class: 'secbody' });
    const det = h('details', { class: 'sec', 'data-sec': sec.id, open: idx === 0 ? true : null }, sum, body);
    let built = false;
    const build = () => {
      if (built) return; built = true;
      // Order: rated items, then repeater entries, then free fields (e.g. "Focus for next visit" goes last).
      for (const it of sec.items || []) body.append(itemEl(it, sec));
      if (sec.repeater) body.append(repeaterEl(sec.repeater, sec));
      if (sec.fields) body.append(h('div', { style: sec.items || sec.repeater ? 'margin-top:14px' : '' }, fieldsBlock(sec.fields, cmpOpts)));
    };
    det.addEventListener('toggle', () => det.open && build());
    if (idx === 0) build();
    secEls[sec.id] = { sum, sec };
    $view.append(det);
  });

  const ptxt = h('div', { class: 'ptxt' }), bar = h('div'), scoreEl = h('div', { class: 'chip', style: 'font-size:15px;padding:8px 10px' });
  document.body.append(h('div', { class: 'bottombar' },
    h('div', { class: 'prog' }, ptxt, h('div', { class: 'bar' }, bar)), scoreEl,
    h('button', { class: 'btn', id: 'finishBtn', onclick: finish }, insp.status === 'complete' ? 'Done' : 'Finish')));

  S.refresh = () => {
    for (const { sum, sec } of Object.values(secEls)) {
      const sc = Core.secScore(sec, insp);
      sum.querySelector('.cnt').textContent = sec.items ? `${sc.n + (sec.items || []).filter(i => insp.items[i.id]?.rating === 'na').length}/${sc.total}` : sec.repeater ? `${(insp.reps[sec.repeater.id] || []).length} entries` : '';
      const chip = sum.querySelector('.chip');
      chip.hidden = !sec.items; chip.textContent = sc.avg == null ? '—' : sc.avg.toFixed(1); chip.style.background = Core.band(sc.avg).color;
    }
    const p = Core.progress(insp); ptxt.textContent = `${p.done} of ${p.total} items rated`;
    bar.style.width = `${p.total ? (100 * p.done) / p.total : 0}%`;
    const o = Core.overall(insp); scoreEl.textContent = o == null ? 'Score —' : `Score ${o.toFixed(1)}`; scoreEl.style.background = Core.band(o).color;
  };
  S.refresh();

  async function finish() {
    const p = Core.progress(insp);
    if (insp.status !== 'complete' && p.done < p.total && !confirm(`${p.total - p.done} items aren't rated. They'll be left out of the score. Finish anyway?`)) return;
    insp.status = 'complete'; insp.completedAt = insp.completedAt || Date.now();
    await saveNow(); location.hash = '#/r/' + insp.id;
  }
}
function fieldsBlock(fields, cmpOpts) {
  const g = h('div', { class: 'grid2' });
  for (const f of fields) g.append(fieldEl(f, () => S.insp.fields[f.id], v => { S.insp.fields[f.id] = v; queueSave(); }, cmpOpts(f)));
  return g;
}
function itemEl(it, sec) {
  const insp = S.insp;
  const a = (insp.items[it.id] ||= { rating: null, notes: '', photos: [], flag: false });
  a.photos ||= [];
  const el = h('div', { class: 'item', 'data-item': it.id });
  const lbl = h('div', { class: 'ratelbl' });
  const rate = h('div', { class: 'rate' });
  const vals = [1, 2, 3, 4, 5, 'na'];
  const drawRate = () => {
    rate.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(a.rating) === b.dataset.r));
    lbl.textContent = a.rating === 'na' ? 'Not applicable' : a.rating ? CFG.rating.labels[a.rating] : '';
  };
  for (const v of vals) rate.append(h('button', { type: 'button', 'data-r': String(v), 'aria-label': v === 'na' ? 'N/A' : `Rate ${v}`, onclick: () => {
    a.rating = a.rating === v ? null : v; drawRate(); S.refresh(); queueSave();
    if (typeof v === 'number' && v <= 2 && !a.flag) flagBtn.classList.add('suggest');
  } }, v === 'na' ? 'N/A' : String(v)));
  const notes = h('textarea', { class: 'notes', placeholder: 'Notes', hidden: !a.notes, oninput: e => { a.notes = e.target.value; queueSave(); noteBtn.classList.toggle('on', !!a.notes); } });
  notes.value = a.notes || '';
  const noteBtn = h('button', { type: 'button', class: a.notes ? 'on' : '', onclick: () => { notes.hidden = !notes.hidden; if (!notes.hidden) notes.focus(); } }, h('span', { html: ICON.note }), 'Notes');
  const ph = photoWidget(a.photos, `${sec.title} — ${it.label}`);
  const flagBox = h('div', { class: 'flagbox', hidden: !a.flag },
    h('div', { style: 'font-weight:700;color:#b42318;margin-bottom:8px;font-size:14px' }, 'Action item'),
    fieldEl({ id: 'priority', label: 'Priority', type: 'segmented', sticky: true, options: ['High', 'Medium', 'Low'] }, () => a.priority, v => { a.priority = v; queueSave(); }),
    h('div', { class: 'grid2' },
      ownerField(() => a.owner, v => { a.owner = v; queueSave(); }),
      fieldEl({ id: 'due', label: 'Due', type: 'date' }, () => a.due, v => { a.due = v; queueSave(); })),
    h('div', { class: 'small muted' }, 'The item notes are used as the action item description.'));
  const flagBtn = h('button', { type: 'button', class: 'flag' + (a.flag ? ' on' : ''), onclick: () => {
    a.flag = !a.flag; if (a.flag && !a.priority) a.priority = (typeof a.rating === 'number' && a.rating <= 2) ? 'High' : 'Medium';
    flagBtn.classList.toggle('on', a.flag); flagBox.hidden = !a.flag;
    flagBox.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.v === a.priority));
    if (a.flag) notes.hidden = false;
    queueSave();
  } }, h('span', { html: ICON.flag }), 'Flag');
  el.append(...[h('div', { class: 'lbl' }, it.label), it.hint ? h('div', { class: 'hint' }, it.hint) : null, rate, lbl,
    h('div', { class: 'acts' }, noteBtn, ph.button, flagBtn), notes, ph.thumbs, ph.file, flagBox].filter(Boolean));
  drawRate();
  return el;
}
function ownerField(get, set) {
  const listId = 'owners-list';
  if (!document.getElementById(listId)) document.body.append(h('datalist', { id: listId }, CFG.owners.map(o => h('option', { value: o }))));
  const inp = h('input', { type: 'text', list: listId, placeholder: 'Who owns it?', value: get() || '', oninput: e => set(e.target.value) });
  inp.dataset.field = 'owner';
  return h('label', { class: 'f wide' }, h('span', {}, 'Owner'), inp);
}
function repeaterEl(rep, sec) {
  const insp = S.insp;
  const list = (insp.reps[rep.id] ||= []);
  const box = h('div');
  const prevRows = S.prev ? S.prev.reps[rep.id] || [] : [];
  const draw = () => {
    box.innerHTML = '';
    list.forEach((row, idx) => {
      row.photos ||= [];
      const key = rep.compareKey ? String(row[rep.compareKey] || '').trim().toLowerCase() : '';
      const prevRow = key ? prevRows.find(r => String(r[rep.compareKey] || '').trim().toLowerCase() === key) : null;
      const title = h('span', {}, row[rep.titleField] || `${rep.addLabel.replace(/^Add /, '')} ${idx + 1}`);
      const grid = h('div', { class: 'grid2' });
      for (const f of rep.fields) {
        const o = f.compare && prevRow ? { cmp: prevRow[f.id], cmpDate: S.prev.fields.date } : {};
        if (f.id === rep.titleField) o.wide = true;
        grid.append(fieldEl(f, () => row[f.id], v => { row[f.id] = v; queueSave(); if (f.id === rep.titleField) title.textContent = v || '—'; }, o));
      }
      const ph = photoWidget(row.photos, `${sec.title} — ${row[rep.titleField] || rep.label}`);
      box.append(h('div', { class: 'rep', 'data-row': idx },
        h('div', { class: 'rephead' }, h('div', {}, title, row.carried ? h('span', { class: 'carried' }, 'From last visit') : null),
          h('button', { type: 'button', class: 'rm', onclick: () => { if (confirm('Remove this entry?')) { list.splice(idx, 1); queueSave(); draw(); S.refresh(); } } }, 'Remove')),
        grid, h('div', { class: 'acts' }, ph.button), ph.thumbs, ph.file));
    });
    box.append(h('button', { type: 'button', class: 'btn secondary', 'data-add': rep.id, onclick: () => {
      list.push({ _id: uid(), photos: [], ...(rep.id === 'openItems' ? { status: 'Open', priority: 'Medium' } : {}) });
      queueSave(); draw(); S.refresh();
      const last = box.querySelectorAll('.rep'); last[last.length - 1]?.querySelector('input,select,textarea')?.focus();
    } }, '+ ' + rep.addLabel));
  };
  draw();
  return h('div', { style: 'margin-top:8px' }, h('div', { style: 'font-weight:700;margin:10px 2px 0' }, rep.label), box);
}

/* ---------- Report / summary ---------- */
async function viewReport(id) {
  const insp = await DB.get('inspections', id); if (!insp) { location.hash = '#/'; return; }
  const ent = await DB.get('entities', insp.entityId);
  const def = CFG.types[insp.type];
  const prev = await Core.previous(insp);
  setBar(ent.name, `${def.name} · ${fmtDate(insp.fields.date)}`, '#/e/' + ent.id);
  if (ent.sample) $view.append(h('div', { class: 'samplebar' }, 'SAMPLE DATA — created for testing'));
  const o = Core.overall(insp), b = Core.band(o);
  const top = h('div', { class: 'card' });
  if (insp.type === 'construction') {
    const pc = insp.fields.pctComplete, pp = prev?.fields.pctComplete;
    top.append(h('div', { class: 'bigscore' },
      h('div', { class: 'num', style: 'background:#1e3a5f' }, pc !== '' && pc != null ? pc + '%' : '—', h('small', {}, ' complete')),
      h('div', {}, h('div', { style: 'font-weight:700' }, insp.fields.schedStatus || 'Schedule not set', insp.fields.daysBehind ? ` · ${insp.fields.daysBehind} days behind` : ''),
        h('div', { class: 'small muted' }, pp != null && pp !== '' ? `Last visit ${fmtDate(prev.fields.date)}: ${pp}% (${pc - pp >= 0 ? '+' : ''}${pc - pp} pts)` : 'No previous visit to compare'),
        h('div', { class: 'small muted' }, `Quality / safety score: ${o == null ? '—' : o.toFixed(1) + ' / 5 (' + b.label + ')'}`))));
  } else {
    top.append(h('div', { class: 'bigscore' },
      h('div', { class: 'num', style: `background:${b.color}` }, o == null ? '—' : o.toFixed(1), h('small', {}, ' / 5')),
      h('div', {}, h('div', { style: 'font-weight:700;font-size:18px' }, b.label),
        h('div', { class: 'small muted' }, prev ? `Previous walk ${fmtDate(prev.fields.date)}: ${Core.overall(prev)?.toFixed(1) ?? '—'}` : 'First walk on record'),
        h('div', { class: 'small muted' }, `Inspector: ${insp.fields.inspector || '—'}`))));
  }
  $view.append(top);
  $view.append(h('button', { class: 'btn', id: 'pdfBtn', onclick: async ev => {
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Building PDF…';
    try { const { blob, name } = await Report.build(insp, ent, SETTINGS, prev); downloadBlob(blob, name); toast('PDF saved'); }
    catch (e) { console.error(e); toast('PDF failed: ' + e.message, 5000); }
    btn.disabled = false; btn.textContent = 'Download PDF report';
  } }, 'Download PDF report'));
  if (navigator.canShare) $view.append(h('button', { class: 'btn secondary', onclick: async () => {
    const { blob, name } = await Report.build(insp, ent, SETTINGS, prev);
    const file = new File([blob], name, { type: 'application/pdf' });
    if (navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: name }).catch(() => {}); else downloadBlob(blob, name);
  } }, 'Share PDF (email, text, Drive…)'));
  $view.append(h('div', { class: 'row2' },
    h('button', { class: 'btn secondary', id: 'csvBtn', onclick: () => exportActionCsv([{ insp, ent }], `${fileSafe(ent.name)} - ${def.name} Action Items - ${insp.fields.date}.csv`) }, 'Action items CSV'),
    h('button', { class: 'btn secondary', onclick: () => (location.hash = '#/i/' + insp.id) }, 'Edit')));

  $view.append(h('h2', {}, 'Section scores'));
  const ss = h('div', { class: 'card' });
  for (const sec of def.sections.filter(s => s.items)) {
    const sc = Core.secScore(sec, insp);
    ss.append(h('div', { class: 'secrow' }, h('div', {}, sec.title, h('div', { class: 'small muted' }, `${sc.n} of ${sc.total} rated`)),
      h('div', { class: 'chip', style: `background:${Core.band(sc.avg).color}` }, sc.avg == null ? '—' : sc.avg.toFixed(1))));
  }
  $view.append(ss);
  const ai = Core.actionItems(insp);
  $view.append(h('h2', {}, `Action items (${ai.length})`));
  const aic = h('div', { class: 'card' });
  if (!ai.length) aic.append(h('div', { class: 'muted' }, 'No action items.'));
  for (const a of ai) aic.append(h('div', { class: 'ai' }, h('div', {}, h('span', { class: 'prio ' + a.priority }, a.priority), h('b', {}, a.item)),
    h('div', { class: 'small muted' }, [a.section, a.owner && 'Owner: ' + a.owner, a.due && 'Due ' + fmtDate(a.due)].filter(Boolean).join(' · ')),
    a.notes ? h('div', { class: 'small' }, a.notes) : null));
  $view.append(aic);
  $view.append(h('button', { class: 'btn danger', onclick: async () => {
    if (!confirm('Delete this inspection and its photos?')) return;
    await deleteInspection(insp.id); location.hash = '#/e/' + ent.id;
  } }, 'Delete inspection'));
}
async function deleteInspection(id) {
  for (const p of await DB.byIndex('photos', 'inspectionId', id)) await DB.del('photos', p.id);
  await DB.del('inspections', id);
}
function exportActionCsv(pairs, name) {
  const rows = [['Site name', 'Inspection type', 'Inspection date', 'Inspector', 'Priority', 'Section', 'Item', 'Notes', 'Rating', 'Owner', 'Due date', 'Status', 'Source']];
  for (const { insp, ent } of pairs) for (const a of Core.actionItems(insp))
    rows.push([(ent.name || '(unnamed site)') + (ent.sample && !/sample/i.test(ent.name) ? ' (SAMPLE)' : ''), CFG.types[insp.type].name, insp.fields.date, insp.fields.inspector || '', a.priority, a.section, a.item, a.notes, a.rating ?? '', a.owner, a.due, a.status, a.source]);
  downloadBlob(new Blob(['\ufeff' + Core.csv(rows)], { type: 'text/csv' }), name);
  toast(`${rows.length - 1} action items exported`);
}

/* ---------- Settings ---------- */
async function viewSettings() {
  setBar('Settings', 'Report branding, backup', '#/');
  const s = SETTINGS;
  const save = async () => { await DB.put('kv', s, 'settings'); toast('Saved'); };
  const card = h('div', { class: 'card' },
    fieldEl({ id: 'company', label: 'Company name (report header, default Atlantic Development)', type: 'text' }, () => s.company, v => (s.company = v)),
    fieldEl({ id: 'inspector', label: 'Default inspector name', type: 'text' }, () => s.inspector, v => (s.inspector = v)),
    fieldEl({ id: 'distribution', label: 'Report prepared for / distribution', type: 'text' }, () => s.distribution, v => (s.distribution = v)));
  const logoPrev = h('div', { class: 'thumbs' }, s.logo ? h('img', { src: s.logo, style: 'width:auto;max-width:200px;object-fit:contain;background:#1e3a5f;padding:6px' }) : null);
  const logoIn = h('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true, onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    const { blob, w, h: hh } = await compressImage(f, 600, 0.9);
    s.logo = await blobToDataUrl(blob); s.logoW = w; s.logoH = hh; await save(); route();
  } });
  card.append(h('div', { class: 'f' }, h('span', {}, 'Logo for reports (optional, light logo looks best on the dark header)'), logoPrev, logoIn,
    h('div', { class: 'row2' }, h('button', { class: 'btn secondary', onclick: () => logoIn.click() }, 'Upload logo'),
      h('button', { class: 'btn secondary', onclick: async () => { delete s.logo; await save(); route(); } }, 'Remove'))));
  $view.append(card, h('button', { class: 'btn', onclick: save }, 'Save settings'));

  $view.append(h('h2', {}, 'Data'));
  $view.append(importButton());
  $view.append(h('button', { class: 'btn secondary', onclick: async () => {
    const [ents, insps] = await Promise.all([DB.all('entities'), DB.all('inspections')]);
    const em = Object.fromEntries(ents.map(e => [e.id, e]));
    const latest = {};
    for (const i of insps.filter(i => i.status === 'complete')) { const k = i.entityId + i.type; if (!latest[k] || (i.fields.date || '') > (latest[k].fields.date || '')) latest[k] = i; }
    exportActionCsv(Object.values(latest).filter(i => em[i.entityId]).map(i => ({ insp: i, ent: em[i.entityId] })), `portfolio_open-action-items_${today()}.csv`);
  } }, 'Export portfolio action items (CSV)'));
  $view.append(h('button', { class: 'btn secondary', onclick: exportBackup }, 'Back up all data (JSON)'));
  const imp = h('input', { type: 'file', accept: '.json,application/json,text/plain', hidden: true, onchange: e => e.target.files[0] && importBackup(e.target.files[0]) });
  $view.append(imp, h('button', { class: 'btn secondary', onclick: () => imp.click() }, 'Restore from backup'));
  let est = '';
  if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); est = `Using ${(e.usage / 1048576).toFixed(1)} MB on this device.`; }
  $view.append(h('div', { class: 'small muted', style: 'margin:12px 4px' },
    `Data is stored only on this device (works offline). Back up regularly. ${est} Checklist version ${CFG.version}.`));
}
const blobToDataUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
async function exportBackup() {
  const [entities, inspections, photos] = await Promise.all([DB.all('entities'), DB.all('inspections'), DB.all('photos')]);
  const ph = [];
  for (const p of photos) ph.push({ ...p, blob: await blobToDataUrl(p.blob) });
  downloadBlob(new Blob([JSON.stringify({ app: 'property-inspections', version: 1, exportedAt: new Date().toISOString(), settings: SETTINGS, entities, inspections, photos: ph })], { type: 'application/json' }), `inspections-backup_${today()}.json`);
}
/* Import a property / project list. Merges: skips anything whose name already exists (case-insensitive). Never deletes. */
function importButton() {
  const inp = h('input', { type: 'file', accept: '.json,application/json,text/plain', hidden: true, id: 'importPropsInput', onchange: e => { const f = e.target.files[0]; e.target.value = ''; f && importProperties(f); } });
  return h('div', {}, inp, h('button', { class: 'btn teal', id: 'importPropsBtn', onclick: () => inp.click() }, 'Import properties (list file)'));
}
const normName = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
async function importProperties(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { alert('That file isn’t a property list (could not read JSON).'); return; }
  if (data.type !== 'property-import' || !Array.isArray(data.properties)) {
    alert(data.app === 'property-inspections' ? 'That looks like a full backup. Use “Restore from backup” instead.' : 'That file isn’t a property list for this app.'); return;
  }
  const existing = new Map((await DB.all('entities')).map(e => [(e.kind || 'property') + '|' + normName(e.name), e]));
  const fields = new Set([...ENTITY_FIELDS.property, ...ENTITY_FIELDS.project].map(f => f.id));
  let added = 0, skipped = 0, filled = 0, bad = 0, units = 0;
  for (const p of data.properties) {
    const name = String(p.name || '').replace(/\s+/g, ' ').trim();
    const kind = p.kind === 'project' ? 'project' : 'property';
    if (!name) { bad++; continue; }
    const key = kind + '|' + normName(name);
    if (existing.has(key)) {
      // Already in the app: never overwrite what she entered, only fill in blank details (address, units, contact...).
      const cur = existing.get(key); let changed = false;
      for (const [k, v] of Object.entries(p)) if (fields.has(k) && k !== 'name' && v !== '' && v != null && (cur[k] === '' || cur[k] == null)) { cur[k] = v; changed = true; }
      if (changed) { cur.updatedAt = Date.now(); await DB.put('entities', cur); filled++; }
      skipped++; continue;
    }
    const e = { id: uid(), kind, name, createdAt: Date.now(), updatedAt: Date.now(), importedFrom: data.source || file.name };
    for (const [k, v] of Object.entries(p)) if (fields.has(k) && k !== 'name' && v !== '' && v != null) e[k] = v;
    await DB.put('entities', e); existing.set(key, e); added++; units += Number(e.units) || 0;
  }
  S.tab = 'property';
  alert(`Imported ${added} ${added === 1 ? 'property' : 'properties'} (${units.toLocaleString('en-US')} units).` + (skipped ? ` ${skipped} were already in the app (not duplicated${filled ? `; filled in blank details on ${filled}` : ''}).` : '') + (bad ? ` ${bad} rows had no name.` : ''));
  location.hash = '#/'; route();
}
async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.type === 'property-import') { importProperties(file); return; }
  if (data.app !== 'property-inspections') { toast('Not a backup file from this app'); return; }
  if (!confirm(`Restore ${data.entities.length} properties/projects and ${data.inspections.length} inspections? Matching records will be overwritten.`)) return;
  for (const e of data.entities) await DB.put('entities', e);
  for (const i of data.inspections) await DB.put('inspections', i);
  for (const p of data.photos) await DB.put('photos', { ...p, blob: await (await fetch(p.blob)).blob() });
  toast('Restored'); route();
}

/* ---------- Boot ---------- */
(async function boot() {
  document.getElementById('settingsBtn').onclick = () => (location.hash = '#/settings');
  CFG = await (await fetch('checklists.json')).json();
  SETTINGS = (await DB.get('kv', 'settings')) || { company: CFG.company || '', inspector: '', distribution: '' };
  if (!SETTINGS.company) SETTINGS.company = CFG.company || '';
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  window.addEventListener('hashchange', route);
  route();
})();
