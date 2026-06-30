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

  function appendSeriesHeading(code) {
    const header = document.createElement('h2');
    header.className = 'series-gallery-heading';
    header.textContent = formatSeriesHeading(code);
    gallery.appendChild(header);
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

    displaySeries(code, startIndex);

    if (opts.openLightbox || wasLightboxOpen) {
      showLightbox(currentIndex);
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
      showLightbox(currentIndex + delta);
      return;
    }
    showLightbox(currentIndex + delta);
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
      lightbox.style.display = 'none';
    }
  }

  window.selectSeries = selectSeries;
  window.navigateSeries = navigateSeries;
  window.navigateImage = navigateImage;

  function mediaSrc(filePath) {
    if (typeof WorksCatalog !== 'undefined' && typeof WorksCatalog.buildMediaUrl === 'function') {
      return WorksCatalog.buildMediaUrl(filePath);
    }
    return `../media/${filePath}`;
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

  let lightbox, lightboxImg, lightboxCaption, lightboxWorkTitle, lightboxWorkMeta, lightboxClose, lightboxPrev, lightboxNext;

  function workMetaLine(work) {
    if (!work) return '';
    const parts = [];
    if (work.year) parts.push(work.year);
    if (work.techniqueLabel) parts.push(work.techniqueLabel);
    if (work.formatSize) parts.push(work.formatSize);
    return parts.join(' · ');
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
      <span class="close">&times;</span>
      <span class="prev">&#10094;</span>
      <img src="" alt="" />
      <div class="lightbox-caption">
        <div class="lightbox-work-title"></div>
        <div class="lightbox-work-meta"></div>
      </div>
      <span class="next">&#10095;</span>
    `;
    document.body.appendChild(lightbox);
    lightboxImg = lightbox.querySelector('img');
    lightboxCaption = lightbox.querySelector('.lightbox-caption');
    lightboxWorkTitle = lightbox.querySelector('.lightbox-work-title');
    lightboxWorkMeta = lightbox.querySelector('.lightbox-work-meta');
    lightboxClose = lightbox.querySelector('.close');
    lightboxPrev = lightbox.querySelector('.prev');
    lightboxNext = lightbox.querySelector('.next');

    lightboxClose.onclick = () => (lightbox.style.display = 'none');
    lightbox.onclick = (e) => {
      if (e.target === lightbox) lightbox.style.display = 'none';
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

  function showLightbox(index) {
    if (!currentSeries.length) return;
    if (index < 0) index = currentSeries.length - 1;
    if (index >= currentSeries.length) index = 0;
    currentIndex = index;
    const work = currentSeries[index];
    lightboxImg.src = mediaSrc(work.filePath);
    lightboxImg.alt = work.title;
    updateLightboxCaption(work);
    lightbox.style.display = 'flex';
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
    if (window.location.search.includes('gallery')) return true;
    const hash = window.location.hash.replace('#', '').trim();
    return hash.length > 0;
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
        if (window.showSeriesOverview && isGalleryRoute()) window.showSeriesOverview();
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

  function displaySeries(code, startIndex) {
    const idx = startIndex == null ? 0 : startIndex;
    gallery.innerHTML = '';
    currentSeriesCode = code;
    currentSeries = allSeries[code] || [];
    appendSeriesHeading(code);
    if (!currentSeries.length) return;
    currentIndex = Math.max(0, Math.min(idx, currentSeries.length - 1));
    if (window.innerWidth < 900) {
      showLightbox(currentIndex);
      return;
    }
    const paintingsContainer = document.createElement('div');
    paintingsContainer.className = 'paintings-container';
    currentSeries.forEach((painting, idx) => {
      const img = document.createElement('img');
      img.src = mediaSrc(painting.filePath);
      img.alt = painting.title;
      img.className = 'painting-thumb';
      img.tabIndex = 0;
      img.onclick = () => {
        currentIndex = idx;
        showLightbox(idx);
      };
      paintingsContainer.appendChild(img);
    });
    gallery.appendChild(paintingsContainer);
  }

  window.showSeriesOverview = function () {
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
      img.src = mediaSrc(cover.filePath);
      img.alt = seriesNames[code];
      img.className = 'series-overview-img';
      img.style.cursor = 'pointer';
      img.onclick = () => {
        selectSeries(code, { imageIndex: 0, openLightbox: window.innerWidth < 900 });
      };
      serieDiv.appendChild(title);
      serieDiv.appendChild(img);
      overview.appendChild(serieDiv);
    });
  };

  createLightbox();
  document.addEventListener('keydown', onGalleryKeydown);
});
