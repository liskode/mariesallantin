// gallery.js — site-v2 (œuvres W/G via SiteCatalog / WorksCatalog)

document.addEventListener('DOMContentLoaded', () => {
  const gallery = document.getElementById('gallery');
  const seriesList = document.getElementById('series-list');
  let allSeries = {};
  let seriesNames = {};
  let seriesMeta = {};
  let seriesIconWorkIds = {};
  let seriesIconCovers = {};
  let seriesOrder = [];
  let currentSeries = [];
  let currentSeriesCode = '';
  let currentIndex = 0;
  let worksSearchIndex = [];
  let suppressUrlSync = false;
  let searchDebounceTimer = null;
  const SERIES_INTRO_INDEX = -1;

  function isMobileGallery() {
    return window.innerWidth < 900;
  }

  function seriesDescription(code) {
    const meta = seriesMeta[code];
    return meta && meta.description ? String(meta.description).trim() : '';
  }

  function seriesHasIntro(code) {
    return Boolean(seriesDescription(code));
  }

  function isShowingSeriesIntro() {
    return currentIndex === SERIES_INTRO_INDEX;
  }

  function descriptionParagraphs(text) {
    return String(text || '')
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  function fillDescriptionBody(container, text) {
    container.innerHTML = '';
    descriptionParagraphs(text).forEach((p) => {
      const para = document.createElement('p');
      para.textContent = p;
      container.appendChild(para);
    });
  }

  function stripAccents(s) {
    return String(s).normalize('NFD').replace(/\p{M}/gu, '');
  }

  function normalizeForSearch(s) {
    return stripAccents(String(s || '')).toLowerCase();
  }

  function parseGalleryLocation() {
    const sp = new URLSearchParams(window.location.search);
    const hasGallery = sp.has('gallery') || window.location.hash === '#gallery';
    let serie = sp.get('serie') || sp.get('series') || '';
    let oeuvre = sp.get('oeuvre') || sp.get('work') || '';
    const hash = window.location.hash.replace('#', '').trim();
    if (!serie && hash && hash !== 'gallery') {
      if (/^MS\d{4}$/i.test(hash)) oeuvre = hash;
      else serie = hash;
    }
    if (oeuvre) oeuvre = String(oeuvre).trim().toUpperCase();
    if (serie) serie = String(serie).trim().toUpperCase();
    return { hasGallery, serie, oeuvre };
  }

  function buildGalleryUrl(opts) {
    const parts = ['gallery'];
    if (opts && opts.serie) parts.push('serie=' + encodeURIComponent(opts.serie));
    if (opts && opts.oeuvre) parts.push('oeuvre=' + encodeURIComponent(opts.oeuvre));
    return window.location.pathname + '?' + parts.join('&');
  }

  function syncGalleryUrl() {
    if (suppressUrlSync) return;
    const overview = document.getElementById('series-overview');
    if (overview && overview.style.display !== 'none') {
      history.replaceState(null, '', buildGalleryUrl(null));
      return;
    }
    if (!currentSeriesCode) return;
    const opts = { serie: currentSeriesCode };
    if (isLightboxOpen() && !isShowingSeriesIntro() && currentSeries[currentIndex]) {
      opts.oeuvre = currentSeries[currentIndex].id;
    }
    history.replaceState(null, '', buildGalleryUrl(opts));
  }

  function findWorkPlacement(workId, preferredSerie) {
    const id = String(workId || '').trim().toUpperCase();
    if (!id) return null;
    const pref = preferredSerie ? String(preferredSerie).trim().toUpperCase() : '';
    if (pref && allSeries[pref]) {
      const idx = allSeries[pref].findIndex((w) => w.id === id);
      if (idx >= 0) return { serie: pref, index: idx };
    }
    for (const code of orderedSeriesCodes()) {
      const list = allSeries[code] || [];
      const idx = list.findIndex((w) => w.id === id);
      if (idx >= 0) return { serie: code, index: idx };
    }
    return null;
  }

  function openWorkById(workId, options) {
    const opts = options || {};
    const placement = findWorkPlacement(workId, opts.serie);
    if (!placement) return false;
    selectSeries(placement.serie, {
      imageIndex: placement.index,
      openLightbox: true,
      skipUrlSync: opts.skipUrlSync,
      skipIntro: true,
    });
    return true;
  }

  function applyGalleryRouteFromUrl() {
    const loc = parseGalleryLocation();
    if (!loc.hasGallery) return;
    suppressUrlSync = true;
    if (loc.oeuvre) {
      if (!openWorkById(loc.oeuvre, { serie: loc.serie, skipUrlSync: true })) {
        if (loc.serie && orderedSeriesCodes().includes(loc.serie)) {
          selectSeries(loc.serie, { skipUrlSync: true });
        } else {
          showSeriesOverview({ skipUrlSync: true });
        }
      }
    } else if (loc.serie && orderedSeriesCodes().includes(loc.serie)) {
      selectSeries(loc.serie, { skipUrlSync: true });
    } else {
      showSeriesOverview({ skipUrlSync: true });
    }
    suppressUrlSync = false;
    syncGalleryUrl();
  }

  function rebuildSearchIndex() {
    const seen = new Set();
    worksSearchIndex = [];
    orderedSeriesCodes().forEach((code) => {
      (allSeries[code] || []).forEach((work) => {
        if (seen.has(work.id)) return;
        seen.add(work.id);
        worksSearchIndex.push({
          id: work.id,
          title: work.title || work.id,
          serie: code,
          serieName: seriesNames[code] || code,
          normTitle: normalizeForSearch(work.title || ''),
          normId: normalizeForSearch(work.id),
        });
      });
    });
  }

  function hideSearchResults() {
    const results = document.getElementById('series-search-results');
    if (results) results.hidden = true;
  }

  function clearSearchInput() {
    const input = document.getElementById('series-search-input');
    if (input) input.value = '';
    hideSearchResults();
  }

  function renderSearchResults(query) {
    const results = document.getElementById('series-search-results');
    if (!results) return;
    const q = normalizeForSearch(query.trim());
    results.innerHTML = '';
    if (!q) {
      results.hidden = true;
      return;
    }
    const matches = worksSearchIndex
      .filter((w) => w.normTitle.includes(q) || w.normId.includes(q))
      .slice(0, 12);
    if (!matches.length) {
      const li = document.createElement('li');
      li.className = 'series-search-empty';
      li.textContent = 'Aucune œuvre trouvée.';
      results.appendChild(li);
      results.hidden = false;
      return;
    }
    matches.forEach((match) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML =
        '<span class="series-search-result-title"></span>' +
        '<span class="series-search-result-meta"></span>';
      btn.querySelector('.series-search-result-title').textContent = match.title;
      btn.querySelector('.series-search-result-meta').textContent =
        match.id + ' · ' + match.serieName;
      btn.onclick = () => {
        clearSearchInput();
        openWorkById(match.id, { serie: match.serie });
        const galleryEl = document.getElementById('gallery');
        if (galleryEl) {
          window.scrollTo({ top: galleryEl.offsetTop - 40, behavior: 'smooth' });
        }
      };
      li.appendChild(btn);
      results.appendChild(li);
    });
    results.hidden = false;
  }

  function initWorkSearch() {
    const input = document.getElementById('series-search-input');
    const wrap = document.getElementById('series-search-wrap');
    if (!input) return;
    input.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => renderSearchResults(input.value), 120);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        clearSearchInput();
        input.blur();
      }
    });
    document.addEventListener('click', (e) => {
      if (wrap && !wrap.contains(e.target)) hideSearchResults();
    });
  }

  function formatSeriesYears(meta) {
    if (!meta) return '';
    const start = meta.year_start;
    const end = meta.year_end;
    const hasStart = start != null && !Number.isNaN(start);
    const hasEnd = end != null && !Number.isNaN(end);
    if (hasStart && hasEnd) {
      return start === end ? ` ${start}` : ` ${start}-${end}`;
    }
    if (hasStart) return ` ${start}`;
    if (hasEnd) return ` ${end}`;
    return '';
  }

  function formatSeriesHeading(code) {
    const name = seriesNames[code] || code;
    const years = formatSeriesYears(seriesMeta[code]);
    return `Série "${name}"${years}`;
  }

  function updateLightboxSeriesHeading() {
    if (!lightboxSeriesHeading) return;
    const text = currentSeriesCode ? formatSeriesHeading(currentSeriesCode) : '';
    lightboxSeriesHeading.textContent = text;
    lightboxSeriesHeading.style.display = text ? '' : 'none';
  }

  function orderedSeriesCodes() {
    return seriesCodesForGallery({ seriesOrder, allSeries });
  }

  function isGalleryContextActive() {
    const welcome = document.getElementById('welcome-section');
    if (!welcome) return true;
    return welcome.style.display === 'none';
  }

  function shouldHandleGalleryKeys(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return false;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if (e.target && e.target.isContentEditable) return false;
    if (!gallery) return false;
    return isGalleryContextActive();
  }

  function isLightboxOpen() {
    return lightbox && lightbox.style.display === 'flex';
  }

  function selectSeries(code, options) {
    const opts = options || {};
    const codes = orderedSeriesCodes();
    if (!code || !codes.includes(code)) return;

    const wasLightboxOpen = isLightboxOpen();
    const startIndex =
      opts.imageIndex != null
        ? opts.imageIndex
        : wasLightboxOpen
          ? currentIndex
          : 0;

    currentSeriesCode = code;

    if (seriesList) {
      Array.from(seriesList.querySelectorAll('a')).forEach((a) => {
        a.classList.toggle('active', a.getAttribute('href').replace('#', '') === code);
      });
      const menuItem = seriesList.querySelector(`a[href="#${code}"]`);
      if (menuItem) menuItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    if (typeof showSection === 'function') showSection('gallery');
    else {
      const welcome = document.getElementById('welcome-section');
      const overview = document.getElementById('series-overview');
      if (welcome) welcome.style.display = 'none';
      if (overview) overview.style.display = 'none';
      if (gallery) gallery.style.display = '';
    }

    displaySeries(code, startIndex, { skipIntro: opts.skipIntro });

    if (opts.openLightbox || wasLightboxOpen) {
      if (!isMobileGallery()) {
        showLightbox(currentIndex, { skipIntro: opts.skipIntro });
      }
    } else if (!opts.skipUrlSync) {
      syncGalleryUrl();
    }
  }

  function navigateSeries(delta) {
    const codes = orderedSeriesCodes();
    if (!codes.length) return;
    let idx = codes.indexOf(currentSeriesCode);
    if (idx < 0) {
      idx = delta > 0 ? 0 : codes.length - 1;
    } else {
      idx = (idx + delta + codes.length) % codes.length;
    }
    selectSeries(codes[idx], { imageIndex: 0, openLightbox: isLightboxOpen() });
  }

  function navigateImage(delta) {
    if (!currentSeries.length) return;
    if (!isLightboxOpen()) {
      if (delta > 0 && seriesHasIntro(currentSeriesCode)) {
        showSeriesIntro();
      } else {
        showLightbox(currentIndex + delta, { skipIntro: true });
      }
      return;
    }
    if (isShowingSeriesIntro()) {
      if (delta > 0) showLightbox(0, { skipIntro: true });
      return;
    }
    if (delta < 0 && currentIndex === 0 && seriesHasIntro(currentSeriesCode)) {
      showSeriesIntro();
      return;
    }
    showLightbox(currentIndex + delta, { skipIntro: true });
  }

  function onGalleryKeydown(e) {
    if (!shouldHandleGalleryKeys(e)) return;

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      navigateSeries(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const galleryEl = document.getElementById('gallery');
      if (!galleryEl || galleryEl.style.display === 'none' || !currentSeries.length) return;
      e.preventDefault();
      navigateImage(e.key === 'ArrowRight' ? 1 : -1);
      return;
    }

    if (e.key === 'Escape' && isLightboxOpen()) {
      e.preventDefault();
      closeLightbox();
    }
  }

  window.selectSeries = selectSeries;
  window.navigateSeries = navigateSeries;
  window.navigateImage = navigateImage;
  window.openWorkById = openWorkById;
  window.parseGalleryLocation = parseGalleryLocation;
  window.applyGalleryRouteFromUrl = applyGalleryRouteFromUrl;

  function mediaSrc(filePath) {
    if (typeof WorksCatalog !== 'undefined' && typeof WorksCatalog.buildMediaUrl === 'function') {
      return WorksCatalog.buildMediaUrl(filePath);
    }
    return `../media/${filePath}`;
  }

  function thumbSrc(filePath) {
    if (typeof WorksCatalog !== 'undefined' && typeof WorksCatalog.buildThumbUrl === 'function') {
      return WorksCatalog.buildThumbUrl(filePath);
    }
    return mediaSrc(filePath);
  }

  function attachLazyImage(img, filePath, options) {
    const opts = options || {};
    const fullSrc = mediaSrc(filePath);
    const displaySrc = opts.forceFull ? fullSrc : thumbSrc(filePath);
    img.src = displaySrc;
    img.loading = opts.eager ? 'eager' : 'lazy';
    img.decoding = 'async';
    if (!opts.eager && displaySrc !== fullSrc) {
      img.onerror = () => {
        img.onerror = null;
        img.src = fullSrc;
      };
    }
    return img;
  }

  function createPaintingThumb(painting, idx) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'painting-thumb-btn';
    btn.setAttribute('aria-label', painting.title || painting.id || 'Voir l’œuvre');
    const img = document.createElement('img');
    img.className = 'painting-thumb';
    img.alt = painting.title || '';
    attachLazyImage(img, painting.filePath);
    btn.appendChild(img);
    btn.onclick = () => {
      currentIndex = idx;
      showLightbox(idx, { skipIntro: idx > 0 });
    };
    return btn;
  }

  function overviewImageForSeries(code) {
    const list = allSeries[code] || [];
    const iconId = seriesIconWorkIds[code];
    if (iconId) {
      const iconWork = list.find((w) => w.id === iconId);
      if (iconWork) return iconWork;
      if (seriesIconCovers[code]) return seriesIconCovers[code];
    }
    if (!list.length) return seriesIconCovers[code] || null;
    return list[0];
  }

  let lightbox,
    lightboxStage,
    lightboxWorkView,
    lightboxImg,
    lightboxCaption,
    lightboxSeriesHeading,
    lightboxWorkTitle,
    lightboxWorkMeta,
    lightboxIntro,
    lightboxIntroCover,
    lightboxIntroHeading,
    lightboxIntroBody,
    lightboxClose,
    lightboxPrev,
    lightboxNext;

  function workMetaLine(work) {
    if (!work) return '';
    const parts = [];
    if (work.year) parts.push(work.year);
    if (work.techniqueLabel) parts.push(work.techniqueLabel);
    if (work.formatSize) parts.push(work.formatSize);
    return parts.join(' · ');
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.style.display = 'none';
    lightbox.classList.remove('is-open', 'is-series-intro');
    syncGalleryUrl();
  }

  function openLightboxDisplay() {
    lightbox.style.display = 'flex';
    requestAnimationFrame(() => lightbox.classList.add('is-open'));
  }

  function setLightboxView(mode) {
    if (!lightbox) return;
    const isIntro = mode === 'intro';
    lightbox.classList.toggle('is-series-intro', isIntro);
    if (lightboxWorkView) lightboxWorkView.hidden = isIntro;
    if (lightboxIntro) lightboxIntro.hidden = !isIntro;
  }

  function renderLightboxIntro() {
    const code = currentSeriesCode;
    const cover = overviewImageForSeries(code);
    if (lightboxIntroCover) {
      if (cover && cover.filePath) {
        lightboxIntroCover.src = mediaSrc(cover.filePath);
        lightboxIntroCover.alt = '';
      } else {
        lightboxIntroCover.removeAttribute('src');
        lightboxIntroCover.alt = '';
      }
    }
    if (lightboxIntroHeading) {
      lightboxIntroHeading.textContent = formatSeriesHeading(code);
    }
    if (lightboxIntroBody) {
      fillDescriptionBody(lightboxIntroBody, seriesDescription(code));
    }
    setLightboxView('intro');
  }

  function showSeriesIntro() {
    showLightbox(SERIES_INTRO_INDEX);
  }

  function updateLightboxCaption(work) {
    if (!lightboxWorkTitle || !lightboxWorkMeta) return;
    lightboxWorkTitle.textContent = work && work.title ? work.title : '';
    const meta = workMetaLine(work);
    lightboxWorkMeta.textContent = meta;
    lightboxWorkMeta.style.display = meta ? '' : 'none';
  }
  function createLightbox() {
    lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.style.display = 'none';
    lightbox.innerHTML = `
      <button type="button" class="close" aria-label="Fermer">&times;</button>
      <button type="button" class="prev" aria-label="Précédent">&#10094;</button>
      <div class="lightbox-stage">
        <div class="lightbox-work-view">
          <div class="lightbox-series-heading" aria-live="polite"></div>
          <img src="" alt="" decoding="async" />
          <div class="lightbox-caption">
            <div class="lightbox-work-title"></div>
            <div class="lightbox-work-meta"></div>
          </div>
        </div>
        <div class="lightbox-series-intro" hidden>
          <img class="lightbox-intro-cover" src="" alt="" decoding="async" />
          <div class="lightbox-intro-layout">
            <div class="lightbox-intro-header">
              <h2 class="lightbox-intro-heading"></h2>
            </div>
            <div class="lightbox-intro-card">
              <div class="lightbox-intro-body"></div>
              <p class="lightbox-intro-hint">
                <span class="lightbox-intro-hint-arrow" aria-hidden="true">→</span>
                <span class="lightbox-intro-hint-text">Flèche droite pour voir les tableaux</span>
              </p>
            </div>
          </div>
        </div>
      </div>
      <button type="button" class="next" aria-label="Suivant">&#10095;</button>
    `;
    document.body.appendChild(lightbox);
    lightboxStage = lightbox.querySelector('.lightbox-stage');
    lightboxWorkView = lightbox.querySelector('.lightbox-work-view');
    lightboxImg = lightboxWorkView.querySelector('img');
    lightboxCaption = lightbox.querySelector('.lightbox-caption');
    lightboxSeriesHeading = lightbox.querySelector('.lightbox-series-heading');
    lightboxWorkTitle = lightbox.querySelector('.lightbox-work-title');
    lightboxWorkMeta = lightbox.querySelector('.lightbox-work-meta');
    lightboxIntro = lightbox.querySelector('.lightbox-series-intro');
    lightboxIntroCover = lightbox.querySelector('.lightbox-intro-cover');
    lightboxIntroHeading = lightbox.querySelector('.lightbox-intro-heading');
    lightboxIntroBody = lightbox.querySelector('.lightbox-intro-body');
    lightboxClose = lightbox.querySelector('.close');
    lightboxPrev = lightbox.querySelector('.prev');
    lightboxNext = lightbox.querySelector('.next');

    lightboxClose.onclick = () => closeLightbox();
    lightbox.onclick = (e) => {
      if (e.target === lightbox) closeLightbox();
    };
    lightboxPrev.onclick = (e) => {
      e.stopPropagation();
      navigateImage(-1);
    };
    lightboxNext.onclick = (e) => {
      e.stopPropagation();
      navigateImage(1);
    };
  }

  function showLightbox(index, options) {
    const opts = options || {};
    if (!currentSeries.length) return;

    const wantsIntro =
      (index === SERIES_INTRO_INDEX || (index === 0 && !opts.skipIntro)) &&
      seriesHasIntro(currentSeriesCode);

    if (wantsIntro) {
      currentIndex = SERIES_INTRO_INDEX;
      renderLightboxIntro();
      openLightboxDisplay();
      syncGalleryUrl();
      return;
    }

    if (index === SERIES_INTRO_INDEX) {
      showLightbox(0, { ...opts, skipIntro: true });
      return;
    }

    if (index < 0) index = currentSeries.length - 1;
    if (index >= currentSeries.length) index = 0;
    currentIndex = index;
    const work = currentSeries[index];
    setLightboxView('work');
    lightboxImg.src = mediaSrc(work.filePath);
    lightboxImg.alt = work.title;
    updateLightboxSeriesHeading();
    updateLightboxCaption(work);
    openLightboxDisplay();
    syncGalleryUrl();
  }

  function seriesCodesForGallery(data) {
    const order = data.seriesOrder || [];
    const withArt = order.filter((c) => allSeries[c] && allSeries[c].length);
    const extra = Object.keys(allSeries).filter(
      (c) => !order.includes(c) && allSeries[c] && allSeries[c].length
    );
    return withArt.concat(extra);
  }

  function isGalleryRoute() {
    return parseGalleryLocation().hasGallery;
  }

  if (typeof WorksCatalog === 'undefined') {
    console.error('Charger site-catalog.js avant gallery.js');
  } else {
    WorksCatalog.load()
      .then((data) => {
        seriesOrder = data.seriesOrder || [];
        Object.assign(seriesNames, data.seriesNames);
        Object.assign(seriesMeta, data.seriesMeta || {});
        Object.assign(seriesIconWorkIds, data.seriesIconWorkIds || {});
        Object.assign(seriesIconCovers, data.seriesIconCovers || {});
        Object.keys(data.allSeries).forEach((k) => {
          allSeries[k] = data.allSeries[k];
        });
        if (typeof window.onCatalogReady === 'function') window.onCatalogReady(data);
        rebuildSearchIndex();
        initWorkSearch();
        if (isGalleryRoute()) applyGalleryRouteFromUrl();
      })
      .catch((err) => console.error('Chargement du catalogue œuvres:', err));
  }

  if (seriesList) {
    seriesList.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        e.preventDefault();
        const code = e.target.getAttribute('href').replace('#', '');
        selectSeries(code);
      }
    });
  }

  function displaySeries(code, startIndex, options) {
    const opts = options || {};
    const idx = startIndex == null ? 0 : startIndex;
    gallery.innerHTML = '';
    currentSeriesCode = code;
    currentSeries = allSeries[code] || [];
    if (!currentSeries.length) return;
    currentIndex = Math.max(0, Math.min(idx, currentSeries.length - 1));
    if (isMobileGallery()) {
      showLightbox(currentIndex, { skipIntro: opts.skipIntro });
      return;
    }
    const paintingsContainer = document.createElement('div');
    paintingsContainer.className = 'paintings-container';
    currentSeries.forEach((painting, paintingIdx) => {
      paintingsContainer.appendChild(createPaintingThumb(painting, paintingIdx));
    });
    gallery.appendChild(paintingsContainer);
  }

  window.showSeriesOverview = function (options) {
    const opts = options || {};
    const overview = document.getElementById('series-overview');
    const galleryEl = document.getElementById('gallery');
    overview.innerHTML = '';
    if (typeof showSection === 'function') showSection('series-overview');
    else {
      overview.style.display = '';
      galleryEl.style.display = 'none';
      document.getElementById('welcome-section').style.display = 'none';
    }
    seriesCodesForGallery({ seriesOrder, allSeries }).forEach((code) => {
      if (!allSeries[code].length) return;
      const cover = overviewImageForSeries(code);
      if (!cover) return;
      const serieDiv = document.createElement('div');
      serieDiv.className = 'series-overview-item';
      const title = document.createElement('div');
      title.className = 'series-overview-title';
      title.textContent = seriesNames[code];
      const img = document.createElement('img');
      img.alt = seriesNames[code];
      img.className = 'series-overview-img';
      img.style.cursor = 'pointer';
      attachLazyImage(img, cover.filePath);
      img.onclick = () => {
        selectSeries(code, { imageIndex: 0, openLightbox: window.innerWidth < 900 });
      };
      serieDiv.appendChild(title);
      serieDiv.appendChild(img);
      overview.appendChild(serieDiv);
    });
    if (!opts.skipUrlSync) syncGalleryUrl();
  };

  createLightbox();
  document.addEventListener('keydown', onGalleryKeydown);
  window.addEventListener('popstate', () => {
    if (!isGalleryRoute()) return;
    applyGalleryRouteFromUrl();
  });
});
