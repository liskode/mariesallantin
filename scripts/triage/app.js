/* Tri de l'export : une carte par groupe de photos (même toile), décision enregistrée à chaque clic. */
(function () {
  'use strict';

  const PAGE_SIZE = 40;
  const CAT_LABELS = { duplicate: 'Doublon', new: 'Nouvelle', situ: 'Autre photo', ignore: 'Écarter' };
  const CAT_KEYS = { d: 'duplicate', n: 'new', s: 'situ', x: 'ignore' };
  const SITU_TYPES = { A: 'Atelier', E: 'Exposition', C: 'Chez un collectionneur', M: 'Combinaison de tableaux', D: 'Détail', X: 'Autre' };

  let groups = [];
  let decisions = {};
  let imported = {};
  let workById = new Map();
  let filter = 'all';
  let search = '';
  let page = 0;
  let focusIndex = 0;
  let visible = [];

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c) n.append(c);
    return n;
  };

  /** Décision effective d'un groupe : proposition automatique + choix enregistrés. */
  function state(g) {
    const d = decisions[g.id] || {};
    return {
      category: d.category || g.proposal,
      work: d.work !== undefined ? d.work : g.work,
      replace: d.replace !== undefined ? d.replace : false,
      best: d.best || g.photos[0].name,
      situ_works: d.situ_works || [],
      situ_type: d.situ_type || g.type_hint || 'X',
      caption: d.caption || '',
      reviewed: !!decisions[g.id],
    };
  }

  async function save(g, patch) {
    decisions[g.id] = { ...(decisions[g.id] || {}), ...patch };
    const r = await fetch('api/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BaseArt': '1' },
      body: JSON.stringify({ group: g.id, decision: patch }),
    });
    if (!r.ok) alert('Enregistrement impossible : ' + (await r.text()));
  }

  const qualityColor = (q) => 'hsl(' + Math.round(Math.max(0, Math.min(120, (q - 30) * 2))) + ', 75%, 45%)';
  const dot = (q, label) =>
    q == null ? null : el('span', { class: 'dot', style: 'background:' + qualityColor(q), title: (label || 'Qualité') + ' : ' + q + '/100' });

  const FILTERS = [
    ['all', 'Toutes', () => true],
    ['todo', 'Non vues', (g, s) => !s.reviewed],
    ['duplicate', 'Déjà dans BaseArt', (g, s) => s.category === 'duplicate'],
    ['replace', 'Photo meilleure', (g, s) => s.category === 'duplicate' && g.replace_suggested],
    ['new', 'Nouvelles', (g, s) => s.category === 'new'],
    ['suspect', 'Nouvelles proches d’une œuvre', (g, s) => s.category === 'new' && g.suspect],
    ['maybe', 'Peut-être une autre photo', (g, s) => s.category === 'new' && g.maybe_situ],
    ['situ', 'Autres photos', (g, s) => s.category === 'situ'],
    ['ignore', 'Écartées', (g, s) => s.category === 'ignore'],
    ['imported', 'Importées', (g) => !!imported[g.id]],
  ];

  function matchesSearch(g) {
    if (!search) return true;
    const s = state(g);
    const hay = [
      ...g.photos.map((p) => p.name),
      g.meta.title,
      ...(g.meta.series || []),
      s.work || '',
      ...s.situ_works,
    ].join(' ').toLowerCase();
    return search.split(/\s+/).every((t) => hay.includes(t));
  }

  function renderFilters() {
    const nav = $('filters');
    nav.textContent = '';
    for (const [key, label, fn] of FILTERS) {
      const n = groups.filter((g) => fn(g, state(g))).length;
      nav.append(
        el('button', {
          type: 'button',
          'aria-pressed': String(filter === key),
          onclick: () => { filter = key; page = 0; render(); },
          text: label + ' (' + n + ')',
        })
      );
    }
  }

  function workThumb(id, opts = {}) {
    const w = workById.get(id);
    const box = el(
      'div',
      { class: 'work' + (opts.on ? ' on' : '') + (opts.onclick ? '' : ' static'), title: w ? id + ' — ' + (w.title || '') : id, onclick: opts.onclick },
      el('img', { src: 'cat/' + id, alt: '', loading: 'lazy' }),
      el('span', {}, id, opts.d != null ? ' · ' + opts.d.toFixed(2) : '')
    );
    if (w && w.image_quality != null) box.querySelector('span').append(dot(w.image_quality, 'Qualité BaseArt'));
    return box;
  }

  function contextPanel(g, s, rerender) {
    const ctx = el('div', { class: 'ctx' });
    if (s.category === 'duplicate') {
      const input = el('input', {
        type: 'text', value: s.work || '', size: 8, 'aria-label': 'Code de l’œuvre',
        onchange: async (e) => {
          const v = e.target.value.trim().toUpperCase().replace(/^(\d+)$/, (m) => 'MS' + m.padStart(4, '0'));
          await save(g, { work: v });
          rerender();
        },
      });
      ctx.append(el('div', {}, 'Même œuvre que ', input));
      if (s.work) ctx.append(el('div', { class: 'works' }, workThumb(s.work)));
      const best = g.photos.find((p) => p.name === s.best) || g.photos[0];
      const cur = workById.get(s.work)?.image_quality;
      const cb = el('input', { type: 'checkbox', onchange: (e) => save(g, { replace: e.target.checked }) });
      cb.checked = s.replace;
      ctx.append(
        el('label', {}, cb, 'Remplacer la photo de BaseArt par celle-ci',
          cur != null && best.quality != null ? ' (qualité ' + cur + ' → ' + best.quality + ')' : '',
          g.replace_suggested ? el('strong', { class: 'warn', text: ' — conseillé' }) : null)
      );
    } else if (s.category === 'new') {
      if (g.maybe_situ) {
        const why = [g.hint, ...(g.scene ? g.scene.labels : [])].filter(Boolean).join(', ');
        ctx.append(el('div', { class: 'warn', text: 'Peut-être une autre photo (' + why + ') — touche S si c\u2019est le cas.' }));
      }
      if (g.suspect) {
        ctx.append(el('div', { class: 'warn', text: 'Ressemble à une œuvre de BaseArt (doublon possible, à trier ensuite) :' }));
        ctx.append(el('div', { class: 'works' }, ...g.nearest.filter((n) => n.d < 0.47).map((n) =>
          workThumb(n.work, { d: n.d, onclick: async () => { await save(g, { category: 'duplicate', work: n.work }); rerender(); } })
        )));
        ctx.append(el('div', { class: 'auto', text: 'Cliquer une vignette pour en faire un doublon de cette œuvre.' }));
      }
    } else if (s.category === 'situ') {
      const sel = el('select', { 'aria-label': 'Type de photo', onchange: (e) => save(g, { situ_type: e.target.value }) },
        ...Object.entries(SITU_TYPES).map(([k, v]) => {
          const o = el('option', { value: k, text: v });
          if (k === s.situ_type) o.selected = true;
          return o;
        }));
      ctx.append(el('div', {}, 'Type : ', sel));
      const toggle = async (id) => {
        const set = new Set(state(g).situ_works);
        set.has(id) ? set.delete(id) : set.add(id);
        await save(g, { situ_works: [...set] });
        rerender();
      };
      const suggestions = g.situ_candidates.map((c) => c.work);
      const ids = [...new Set([...s.situ_works, ...suggestions])];
      if (g.hint) ctx.append(el('div', { class: 'auto', text: 'Indice : ' + g.hint }));
      ctx.append(el('div', { class: 'auto', text: 'Œuvre(s) concernée(s) (cliquer pour rattacher) — suggestions automatiques :' }));
      ctx.append(el('div', { class: 'works' }, ...ids.map((id) => {
        const c = g.situ_candidates.find((x) => x.work === id);
        return workThumb(id, { on: s.situ_works.includes(id), d: c ? c.d : null, onclick: () => toggle(id) });
      })));
      const add = el('input', {
        type: 'text', placeholder: 'Ajouter des codes : 440 521…', size: 22,
        onchange: async (e) => {
          const codes = e.target.value.split(/[\s,;]+/).filter(Boolean).map((c) => 'MS' + c.replace(/^MS/i, '').padStart(4, '0'));
          const valid = codes.filter((c) => workById.has(c));
          await save(g, { situ_works: [...new Set([...state(g).situ_works, ...valid])] });
          if (valid.length < codes.length) alert('Codes inconnus ignorés : ' + codes.filter((c) => !workById.has(c)).join(' '));
          rerender();
        },
      });
      if (!s.situ_works.length) ctx.append(el('div', { class: 'warn', text: 'Aucune œuvre rattachée : la photo ne sera pas ajoutée tant qu\u2019aucune œuvre n\u2019est choisie.' }));
      const cap = el('input', { type: 'text', value: s.caption, placeholder: 'Légende (lieu, date, collectionneur…)', size: 32, onchange: (e) => save(g, { caption: e.target.value }) });
      ctx.append(el('div', {}, add), el('div', {}, cap));
      if (g.scene && g.scene.labels.length) ctx.append(el('div', { class: 'auto', text: 'Détecté : ' + g.scene.labels.join(', ') }));
    }
    return ctx;
  }

  function card(g, index) {
    const s = state(g);
    const best = g.photos.find((p) => p.name === s.best) || g.photos[0];
    const node = el('article', { class: 'card', 'data-cat': s.category, tabindex: '0' });
    const rerender = () => {
      const fresh = card(g, index);
      node.replaceWith(fresh);
      renderFilters();
      if (focusIndex === index) fresh.classList.add('focused');
    };
    node.addEventListener('focus', () => setFocus(index, false));
    node.addEventListener('click', () => setFocus(index, false));

    const main = el('img', { class: 'main-photo', src: best.thumb, alt: best.name, loading: 'lazy',
      onclick: () => openLightbox(best) });
    const strip = el('div', { class: 'strip' });
    if (g.photos.length > 1) {
      for (const p of g.photos) {
        strip.append(el('img', {
          src: p.thumb, alt: '', loading: 'lazy', class: p.name === best.name ? 'best' : '',
          title: p.name + (p.quality != null ? ' — qualité ' + p.quality : '') + ' (cliquer pour en faire la photo retenue)',
          onclick: async () => { await save(g, { best: p.name }); rerender(); },
        }));
      }
    }
    const left = el('div', {}, main, strip);

    const m = g.meta;
    const meta = el('div', { class: 'meta' },
      ...(m.series || []).map((c) => el('span', { class: 'chip', text: c })),
      m.year ? el('span', { class: 'chip', text: String(m.year) }) : null,
      m.format ? el('span', { class: 'chip', text: m.format }) : null,
      m.technique ? el('span', { class: 'chip', text: m.technique }) : null,
      m.title ? el('div', { text: m.title }) : null);

    const cats = el('div', { class: 'cats' }, ...Object.entries(CAT_LABELS).map(([k, label]) =>
      el('button', { type: 'button', 'data-cat': k, 'aria-pressed': String(s.category === k),
        onclick: async () => { await save(g, { category: k }); rerender(); }, text: label })),
      !s.reviewed ? el('span', { class: 'auto', text: 'proposition automatique' }) : null);

    const right = el('div', {},
      el('div', { class: 'name' }, best.name, dot(best.quality),
        imported[g.id] ? el('span', { class: 'imported', text: (imported[g.id].replaced ? 'photo remplacée : ' : imported[g.id].photo_id ? 'photo ajoutée' : 'importée : ') + (imported[g.id].work || '') }) : null),
      el('div', { class: 'auto', text: g.id + ' · ' + g.photos.length + ' photo(s)' + (best.w ? ' · ' + best.w + '×' + best.h + ' px' : '') }),
      meta, cats, contextPanel(g, s, rerender));
    node.append(left, right);
    node._group = g;
    return node;
  }

  function render() {
    renderFilters();
    const fn = FILTERS.find((f) => f[0] === filter)[2];
    visible = groups.filter((g) => fn(g, state(g)) && matchesSearch(g));
    const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    page = Math.min(page, pages - 1);
    $('page').textContent = 'page ' + (page + 1) + ' / ' + pages + ' — ' + visible.length + ' groupe(s)';
    const box = $('cards');
    box.textContent = '';
    const slice = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    if (!slice.length) box.append(el('p', { class: 'empty', text: 'Aucun groupe dans ce filtre.' }));
    slice.forEach((g, i) => box.append(card(g, i)));
    focusIndex = 0;
    setFocus(0, false);
    window.scrollTo(0, 0);
  }

  function setFocus(i, scroll = true) {
    const nodes = [...document.querySelectorAll('.card')];
    if (!nodes.length) return;
    focusIndex = Math.max(0, Math.min(nodes.length - 1, i));
    nodes.forEach((n, k) => n.classList.toggle('focused', k === focusIndex));
    if (scroll) nodes[focusIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function openLightbox(p) {
    $('lightbox-img').src = 'photo?name=' + encodeURIComponent(p.name);
    $('lightbox-caption').textContent = p.name + (p.w ? ' — ' + p.w + ' × ' + p.h + ' px' : '') + (p.quality != null ? ' — qualité ' + p.quality : '');
    $('lightbox').showModal();
  }
  $('lightbox').addEventListener('click', () => $('lightbox').close());

  document.addEventListener('keydown', async (e) => {
    if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || $('lightbox').open) return;
    const nodes = [...document.querySelectorAll('.card')];
    const node = nodes[focusIndex];
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setFocus(focusIndex + 1); return; }
    if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setFocus(focusIndex - 1); return; }
    const cat = CAT_KEYS[e.key.toLowerCase()];
    if (cat && node) {
      e.preventDefault();
      await save(node._group, { category: cat });
      const fresh = card(node._group, focusIndex);
      node.replaceWith(fresh);
      renderFilters();
      setFocus(focusIndex + 1);
    }
  });

  async function refreshImportStatus() {
    const s = await (await fetch('api/import/status', { cache: 'no-store' })).json();
    const withAuto = $('include-unreviewed').checked;
    const pending = withAuto ? s.pending_new_unreviewed : s.pending_new;
    $('import-status').textContent =
      pending + ' nouvelle(s) à importer' + (withAuto ? ' (dont propositions non vues)' : ' (validées)') +
      ' · ' + s.pending_replace + ' photo(s) à remplacer · ' + s.imported + ' traitée(s) · ' + s.to_publish + ' fichier(s) à publier';
    $('replace-btn').disabled = !!s.busy || !s.pending_replace;
    $('photos-btn').disabled = !!s.busy || !s.pending_photos;
    $('photos-btn').textContent = 'Ajouter les autres photos (' + s.pending_photos + ')';
    $('replace-btn').textContent = 'Traiter les doublons — photos / fiches (' + s.pending_replace + ')';
    $('import-btn').disabled = !!s.busy || !pending;
    $('publish-btn').disabled = !!s.busy || !s.to_publish;
  }
  async function runAction(url, label, body) {
    $('import-btn').disabled = $('publish-btn').disabled = $('replace-btn').disabled = $('photos-btn').disabled = true;
    $('import-msg').textContent = label + '…';
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BaseArt': '1' }, body: JSON.stringify(body || {}) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || r.status);
      return j;
    } catch (e) {
      $('import-msg').textContent = 'Erreur : ' + e.message;
      throw e;
    } finally {
      await refreshImportStatus();
    }
  }
  $('import-btn').addEventListener('click', async () => {
    if (!confirm('Importer les 50 prochaines nouvelles œuvres (fiches « À valider », versions allégées, originaux mis de côté) ?')) return;
    const j = await runAction('api/import', 'Import en cours (environ 1 à 2 minutes)', { limit: 50, include_unreviewed: $('include-unreviewed').checked });
    for (const x of j.imported) imported[x.group] = { work: x.work };
    $('import-msg').textContent = j.imported.length + ' œuvre(s) importée(s) : ' + (j.imported[0]?.work || '') + '–' + (j.imported[j.imported.length - 1]?.work || '') + '. Vérifiez-les dans l\u2019éditeur puis publiez.';
    render();
  });
  $('include-unreviewed').addEventListener('change', refreshImportStatus);
  $('photos-btn').addEventListener('click', async () => {
    if (!confirm('Ajouter les autres photos validées (atelier, exposition, combinaison, détail…) et les rattacher à leurs œuvres ?')) return;
    const j = await runAction('api/photos', 'Ajout des autres photos en cours');
    for (const x of j.added) imported[x.group] = { photo_id: x.photo_id, work: x.works.join(' ') };
    $('import-msg').textContent = j.added.length + ' photo(s) ajoutée(s).' + (j.remaining ? ' ' + j.remaining + ' restante(s).' : '');
    render();
  });
  $('replace-btn').addEventListener('click', async () => {
    if (!confirm('Traiter les doublons : photos de référence remplacées (anciennes archivées) et corrections de fiche appliquées ?')) return;
    const j = await runAction('api/replace', 'Remplacement en cours');
    for (const x of j.replaced) imported[x.group] = { work: x.work, replaced: true };
    $('import-msg').textContent = j.replaced.length + ' doublon(s) traité(s). Vérifiez-les dans l\u2019éditeur puis publiez.';
    render();
  });
  $('validate-page').addEventListener('click', async () => {
    const slice = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).filter((g) => !decisions[g.id]?.category);
    if (!slice.length) { alert('Toutes les cartes de cette page sont déjà validées.'); return; }
    if (!confirm('Valider la proposition affichée pour ' + slice.length + ' carte(s) non vue(s) de cette page ?')) return;
    for (const g of slice) await save(g, { category: state(g).category });
    render();
    refreshImportStatus();
  });
  $('publish-btn').addEventListener('click', async () => {
    if (!confirm('Publier sur le site les images et works.json importés (commit + push GitHub) ?')) return;
    const j = await runAction('api/publish', 'Publication en cours');
    $('import-msg').textContent = j.pushed ? 'Publié : ' + j.paths.length + ' fichier(s). En ligne dans quelques minutes.' : 'Rien à publier.';
  });

  $('prev').addEventListener('click', () => { if (page > 0) { page--; render(); } });
  $('next').addEventListener('click', () => { if ((page + 1) * PAGE_SIZE < visible.length) { page++; render(); } });
  let t;
  $('search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { search = e.target.value.trim().toLowerCase(); page = 0; render(); }, 250); });

  fetch('api/data', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
      groups = d.triage.groups;
      decisions = d.decisions || {};
      imported = d.imported || {};
      workById = new Map(d.works.map((w) => [w.id, w]));
      render();
      refreshImportStatus();
    })
    .catch((e) => { $('cards').textContent = 'Chargement impossible : ' + e.message; });
})();
