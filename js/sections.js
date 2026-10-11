/* ============================================================
   js/sections.js — v5.0 DH · "All data as tables, with headings"
   ------------------------------------------------------------
   Turns the LIVE PAGE into clean structured rows and saves them in
   the cloud, so every section of every day (and the ✨ AI Assistant
   form) exists as real table data in Supabase — readable on any
   device, forever:

     contract_section_headings  🏷 registry of all section headings
     contract_day_sections      🪪 every section of every day page
     contract_log_book_rows     📔 each 📔 Log Book sheet field, one row
     contract_field_entries     🧾 EVERY input/select entry + heading
     contract_generator_choices ✨ AI Assistant form selections

   How it works:
     • window.dhkCollectSections() reads the DOM directly: headings
       from h2/h3/legend labels, values from inputs/selects/check-
       boxes/table cells — exactly what is on screen right now.
     • window.dhkPushSections() upserts those rows via the anon key
       (PostgREST, on_conflict → merge-duplicates). Idempotent.
     • It hooks 💾 Save (window.dhSyncNow), the ✨ AI apply path and
       day creation, plus a debounced autosave — so the tables are
       refreshed automatically on every sync, from every device.
     • Nothing here can break the app: every call is wrapped in
       try/catch and runs fire-and-forget after the normal save.

   Requires: window.SUPABASE_CONFIG (js/supabase-config.js) and the
   tables created by go-live-structured.sql (run it once in the
   Supabase SQL Editor).
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey) return;
  const H = {
    'apikey': cfg.anonKey,
    'Authorization': 'Bearer ' + cfg.anonKey,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal'
  };

  const txt = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const escH = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* current value of any form control, human-readable */
  function ctlValue(el) {
    if (el.tagName === 'SELECT') {
      const o = el.selectedOptions && el.selectedOptions[0];
      return txt(o ? o.textContent : el.value);
    }
    if (el.type === 'checkbox') return el.checked ? 'Yes ✓' : 'No';
    if (el.type === 'radio')    return el.checked ? (el.value || 'Yes ✓') : '';
    return txt(el.value);
  }

  /* best human heading for a control: label → aria-label →
     data-label → nearest preceding text node/strong → name/id */
  function ctlHeading(el) {
    if (el.labels && el.labels.length) return txt(el.labels[0].textContent);
    const a = el.getAttribute('aria-label') || el.getAttribute('data-label');
    if (a) return txt(a);
    let n = el.previousElementSibling;
    for (let i = 0; i < 3 && n; i++, n = n.previousElementSibling) {
      if (/^(LABEL|STRONG|B|SPAN|P|TD)$/.test(n.tagName) && txt(n.textContent))
        return txt(n.textContent).slice(0, 90);
    }
    const ph = el.getAttribute('placeholder');
    if (ph) return txt(ph);
    return txt(el.name || el.id || el.tagName.toLowerCase());
  }

  /* which day page contains this element? ('' = main/global) */
  function ownerDay(el) {
    const p = el.closest && el.closest('.page');
    return (p && /^day\d+$/.test(p.id || '')) ? p.id : '';
  }

  /* ---------- collectors ------------------------------------------- */

  /* 1) EVERY individual field entry, with heading + section */
  function collectFieldEntries() {
    const rows = [];
    document.querySelectorAll('input, select, textarea').forEach(el => {
      if (el.type === 'hidden' || el.type === 'button' || el.type === 'submit') return;
      const v = ctlValue(el);
      if (!v) return;
      rows.push({
        state_key: 'fields',
        entry_key: (ownerDay(el) || 'main') + '~' + (el.getAttribute('data-dhk') || el.id || el.name || ctlHeading(el)),
        slug: ownerDay(el),
        section: ownerDay(el) ? 'day page' : 'global/main',
        heading: ctlHeading(el).slice(0, 140),
        value: v.slice(0, 4000),
        updated_at: new Date().toISOString(),
      });
    });
    return rows;
  }

  /* 2) One row per SECTION per day: heading + tab-separated content */
  function collectDaySections() {
    const rows = [];
    const pages = document.querySelectorAll('.page');
    pages.forEach(pg => {
      if (!/^day\d+$/.test(pg.id || '')) return;
      const slug = pg.id;
      let ord = 0;
      const push = (heading, content) => {
        heading = txt(heading).slice(0, 140); content = txt(content);
        if (!heading || !content) return;
        rows.push({ slug, heading, content: content.slice(0, 8000),
                    ord: ++ord, writer: navigator.platform || 'device',
                    synced_at: new Date().toISOString() });
      };

      /* title line */
      const h1 = pg.querySelector('h1, h2');
      push('📅 Day header', (h1 ? txt(h1.textContent) : slug));

      /* every article/section block: heading + its controls & paragraphs */
      pg.querySelectorAll('h2, h3, h4, legend').forEach(head => {
        const container = head.closest('section, fieldset, article, div.block, table') || head.parentElement;
        if (!container) return;
        const bits = [];
        const ht = txt(head.textContent);
        /* paragraphs & list items inside this block */
        container.querySelectorAll('p, li').forEach(x => {
          if (x.closest('select')) return;
          const t = txt(x.textContent); if (t && t !== ht) bits.push(t);
        });
        /* table rows inside this block */
        container.querySelectorAll('table tr').forEach(tr => {
          const cells = Array.from(tr.children).map(c => txt(c.textContent)).filter(Boolean);
          if (cells.length) bits.push(cells.join(' | '));
        });
        /* inputs/selects inside this block */
        container.querySelectorAll('input, select, textarea').forEach(el => {
          if (el.type === 'hidden' || el.type === 'button' || el.type === 'submit') return;
          const v = ctlValue(el);
          if (v) bits.push(ctlHeading(el) + ': ' + v);
        });
        push(ht, bits.slice(0, 60).join('\n'));
      });
    });
    return dedupe(rows, r => r.slug + '~' + r.heading);
  }

  /* 3) 📔 Log Book sheets — one row per field, sheet heading included */
  function collectLogBookRows() {
    const rows = [];
    document.querySelectorAll('.lb-form fieldset.lb-group').forEach(fs => {
      const legend = fs.querySelector('legend');
      const sheetName = txt(legend ? legend.textContent : '');
      if (!sheetName) return;
      const sheetKey = sheetName.replace(/[^\w]+/g, '_').toLowerCase().slice(0, 40);
      const slug = ownerDay(fs);
      fs.querySelectorAll('input, select, textarea').forEach(el => {
        if (el.type === 'hidden' || el.type === 'button' || el.type === 'submit') return;
        const v = ctlValue(el);
        if (!v) return;
        rows.push({
          slug, sheet_key: sheetKey, sheet_name: sheetName.slice(0, 90),
          field_heading: ctlHeading(el).slice(0, 140),
          value: v.slice(0, 2000),
          lb_date: (function () {
            const d = fs.querySelector('input[type="date"], input[data-lb-date]');
            return d ? txt(d.value) : '';
          })(),
          sent_to_logbook_cloud: !!(fs.dataset && fs.dataset.lbDirty === '0'),
          synced_at: new Date().toISOString(),
        });
      });
    });
    return dedupe(rows, r => r.slug + '~' + r.sheet_key + '~' + r.field_heading);
  }

  /* 4) ✨ AI Assistant "Write Our Day" generator form selections */
  function collectGeneratorChoices() {
    const rows = [];
    const modal = document.getElementById('ai-modal') ||
                  document.querySelector('.ai-modal, #aiAssistant, [data-ai-generator]');
    const scope = modal || document;
    scope.querySelectorAll('#gen-couple-type, #gen-mood, #gen-intensity, #gen-mode, ' +
      '#gen-lead, #gen-venue, #gen-duration, #gen-aftercare, #gen-sub-request, ' +
      '#gen-dom-request, #gen-limits-extra, #gen-notes').forEach(el => {
      const v = ctlValue(el);
      if (!v) return;
      rows.push({ choice_key: el.id, heading: ctlHeading(el).slice(0, 140),
                  value: v.slice(0, 2000), updated_at: new Date().toISOString() });
    });
    /* selected play-category chips/toggles */
    const picked = Array.from(scope.querySelectorAll(
      '[data-cat].on, .chip.on, .pick.on, input[data-cat]:checked'))
      .map(el => txt(el.textContent || el.value));
    if (picked.length) rows.push({
      choice_key: 'playCategories', heading: 'Play categories & subcategories selected',
      value: picked.join(', ').slice(0, 4000), updated_at: new Date().toISOString() });
    return dedupe(rows, r => r.choice_key);
  }

  function dedupe(arr, keyf) {
    const m = new Map(); arr.forEach(r => m.set(keyf(r), r));
    return Array.from(m.values());
  }

  /* ---------- pusher ------------------------------------------------ */
  async function upsert(table, pk, rows) {
    if (!rows.length) return true;
    const res = await fetch(cfg.url + '/rest/v1/' + table + '?on_conflict=' + pk,
      { method: 'POST', headers: H, body: JSON.stringify(rows) });
    return res.ok;
  }

  let pushing = false, queued = false;
  async function dhkPushSections() {
    if (pushing) { queued = true; return; }
    pushing = true;
    do {
      queued = false;
      try {
        await Promise.all([
          upsert('contract_field_entries', 'state_key,entry_key', collectFieldEntries()),
          upsert('contract_day_sections',  'slug,heading',        collectDaySections()),
          upsert('contract_log_book_rows', 'slug,sheet_key,field_heading', collectLogBookRows()),
          upsert('contract_generator_choices', 'choice_key',      collectGeneratorChoices()),
        ]);
      } catch { /* offline → next save retries; core sync unaffected */ }
    } while (queued);
    pushing = false;
  }
  window.dhkPushSections = dhkPushSections;
  window.dhkCollectSections = { fields: collectFieldEntries, sections: collectDaySections,
                                logbook: collectLogBookRows, generator: collectGeneratorChoices };

  /* ---------- hooks -------------------------------------------------- */
  let debounceT;
  const schedule = () => { clearTimeout(debounceT); debounceT = setTimeout(dhkPushSections, 2500); };

  function boot() {
    /* wrap the app's own sync paths so tables refresh right after 💾 Save */
    const orig = window.dhSyncNow;
    window.dhSyncNow = async function () {
      const r = orig ? await orig.apply(this, arguments) : undefined;
      dhkPushSections();
      return r;
    };
    ['dhPersistDays', 'dhApplyGeneratedDay', 'dhAddDay'].forEach(name => {
      const f = window[name];
      if (typeof f === 'function' && !f.__dhkWrapped) {
        const w = function () { const r = f.apply(this, arguments); setTimeout(dhkPushSections, 800); return r; };
        w.__dhkWrapped = true; window[name] = w;
      }
    });
    document.addEventListener('input',  schedule, true);
    document.addEventListener('change', schedule, true);
    /* first fill shortly after load (cloud pull may still be restoring) */
    setTimeout(dhkPushSections, 4000);
    setTimeout(dhkPushSections, 12000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
