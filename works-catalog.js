/**
 * Catalogue des œuvres : charge media/works.json (prioritaire) ou media/titles.txt.
 * Chaque œuvre a un id stable, un chemin media/ et une liste de codes de séries.
 */
(function (global) {
  let cache = null;

  function uniqSeriesCodes(codes) {
    const out = [];
    const seen = new Set();
    (codes || []).forEach((c) => {
      const x = String(c).trim();
      if (!x || seen.has(x)) return;
      seen.add(x);
      out.push(x);
    });
    return out;
  }

  function parseTitlesTxt(text) {
    const lines = text.split('\n');
    const seriesOrder = [];
    const seriesNames = {};
    lines.forEach((line) => {
      if (!line.startsWith('#')) return;
      const [code, name] = line.replace('#', '').split(';');
      if (!code || !name) return;
      const c = code.trim();
      if (seriesNames[c] === undefined) seriesOrder.push(c);
      seriesNames[c] = name.trim();
    });

    const works = [];
    lines.forEach((line) => {
      if (line.startsWith('#') || !line.includes('/') || !line.includes(';')) return;
      const [filePath, title] = line.split(';');
      const media = filePath.trim();
      const folder = media.split('/')[0];
      const seriesFromFolder =
        folder && String(folder).toLowerCase() !== 'catalogue' ? [folder] : [];
      works.push({
        id: media,
        media,
        title: (title || '').trim(),
        series: uniqSeriesCodes(seriesFromFolder),
        photo: 'OK',
        publish: 'ON',
        dimensions: '',
        tailleMo: null,
      });
    });

    return buildStructures(seriesOrder, seriesNames, works);
  }

  function inferPublishFromBasename(basename) {
    const lastDot = basename.lastIndexOf('.');
    let base = lastDot === -1 ? basename : basename.slice(0, lastDot);
    base = base.replace(/^MS\d{4}[\s_-]+/i, '');
    if (/^offf-/i.test(base) || /^off-/i.test(base)) return 'OFF';
    if (/^val-/i.test(base)) return 'VAL';
    return 'ON';
  }

  function parseWorksJson(data) {
    const seriesOrder = [];
    const seriesNames = {};
    const se = data.series;
    if (Array.isArray(se)) {
      se.forEach((entry) => {
        if (Array.isArray(entry) && entry.length >= 2) {
          const code = String(entry[0]).trim();
          const name = String(entry[1]).trim();
          if (!code) return;
          if (seriesNames[code] === undefined) seriesOrder.push(code);
          seriesNames[code] = name;
        } else if (entry && typeof entry === 'object' && entry.code) {
          const code = String(entry.code).trim();
          if (!code) return;
          if (seriesNames[code] === undefined) seriesOrder.push(code);
          seriesNames[code] = String(entry.name || code).trim();
        }
      });
    }

    const works = (data.works || []).map((w) => {
      const media = String(w.media || w.filePath || '').trim();
      const id = String(w.id || media).trim();
      const title = String(w.title || '').trim();
      let series = [];
      if (Array.isArray(w.series)) series = w.series.map((x) => String(x).trim()).filter(Boolean);
      else if (w.seriesCode) series = [String(w.seriesCode).trim()].filter(Boolean);
      const folderFromMedia = media.includes('/') ? media.split('/')[0] : '';
      const folderLower = String(folderFromMedia).toLowerCase();
      if (!series.length && folderFromMedia && folderLower !== 'catalogue') {
        series = [folderFromMedia];
      }
      series = uniqSeriesCodes(series);
      const photo = w.photo != null ? String(w.photo).trim() : 'OK';
      const dimensions = w.dimensions != null ? String(w.dimensions).trim() : '';
      const tailleMo = w.tailleMo != null && w.tailleMo !== '' ? Number(w.tailleMo) : null;
      const fileName = media.includes('/') ? media.slice(media.indexOf('/') + 1) : media;
      let publish = w.publish != null ? String(w.publish).trim().toUpperCase() : '';
      if (publish !== 'ON' && publish !== 'OFF' && publish !== 'VAL') {
        publish = inferPublishFromBasename(fileName);
      }
      return { id, media, title, series, photo, publish, dimensions, tailleMo };
    });

    return buildStructures(seriesOrder, seriesNames, works);
  }

  function buildStructures(seriesOrder, seriesNames, works) {
    const allSeries = {};
    seriesOrder.forEach((c) => {
      allSeries[c] = [];
    });

    works.forEach((w) => {
      const filePath = w.media;
      const item = {
        id: w.id,
        filePath,
        title: w.title,
        photo: w.photo,
        publish: w.publish,
        dimensions: w.dimensions,
        tailleMo: w.tailleMo,
      };
      w.series.forEach((code) => {
        if (!allSeries[code]) {
          allSeries[code] = [];
          if (!seriesOrder.includes(code)) seriesOrder.push(code);
          seriesNames[code] = seriesNames[code] || code;
        }
        allSeries[code].push(item);
      });
    });

    return { seriesOrder, seriesNames, allSeries, works };
  }

  function getSeriesCounts(works, seriesOrder) {
    const counts = {};
    seriesOrder.forEach((c) => {
      counts[c] = 0;
    });
    works.forEach((w) => {
      w.series.forEach((c) => {
        if (counts[c] !== undefined) counts[c]++;
      });
    });
    return counts;
  }

  async function load() {
    if (cache) return cache;
    cache = await loadInner();
    return cache;
  }

  async function loadInner() {
    const rj = await fetch('media/works.json', { cache: 'no-store' });
    if (rj.ok) {
      try {
        const data = await rj.json();
        return parseWorksJson(data);
      } catch (e) {
        console.warn('works.json invalide, repli sur titles.txt', e);
      }
    }
    const rt = await fetch('media/titles.txt', { cache: 'no-store' });
    if (!rt.ok) throw new Error('Impossible de charger ni works.json ni titles.txt');
    return parseTitlesTxt(await rt.text());
  }

  /** Réinitialise le cache (tests / rechargement forcé). */
  function clearCache() {
    cache = null;
  }

  /**
   * URL pour attribut src (img) : préfixe media/ + chemin type catalogue/fichier.jpeg.
   * NFC sur chaque segment encodé pour correspondre aux chemins sur l’hébergeur (GitHub Pages, etc.).
   */
  function buildMediaUrl(mediaRelativePath) {
    const p = String(mediaRelativePath || '')
      .trim()
      .replace(/\\/g, '/');
    if (!p) return '';
    const full = p.startsWith('media/') ? p : 'media/' + p;
    return full
      .split('/')
      .map((seg, i) =>
        i === 0 ? seg : encodeURIComponent(String(seg).normalize('NFC'))
      )
      .join('/');
  }

  global.WorksCatalog = {
    load,
    clearCache,
    parseTitlesTxt,
    parseWorksJson,
    getSeriesCounts,
    buildMediaUrl,
  };
})(typeof window !== 'undefined' ? window : this);
