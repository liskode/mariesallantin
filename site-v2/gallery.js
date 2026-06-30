// gallery.js — site-v2 (œuvres W/G via SiteCatalog / WorksCatalog)

document.addEventListener('DOMContentLoaded', () => {
  const gallery = document.getElementById('gallery');
  const seriesList = document.getElementById('series-list');
  let allSeries = {};
  let seriesNames = {};
  let seriesIconWorkIds = {};
  let seriesIconCovers = {};
  let seriesOrder = [];
  let currentSeries = [];
  let currentIndex = 0;

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
      showLightbox(currentIndex - 1);
    };
    lightboxNext.onclick = (e) => {
      e.stopPropagation();
      showLightbox(currentIndex + 1);
    };
    document.addEventListener('keydown', (e) => {
      if (lightbox.style.display === 'flex') {
        if (e.key === 'ArrowLeft') showLightbox(currentIndex - 1);
        if (e.key === 'ArrowRight') showLightbox(currentIndex + 1);
        if (e.key === 'Escape') lightbox.style.display = 'none';
      }
    });
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

  if (typeof WorksCatalog === 'undefined') {
    console.error('Charger site-catalog.js avant gallery.js');
  } else {
    WorksCatalog.load()
      .then((data) => {
        seriesOrder = data.seriesOrder || [];
        Object.assign(seriesNames, data.seriesNames);
        Object.assign(seriesIconWorkIds, data.seriesIconWorkIds || {});
        Object.assign(seriesIconCovers, data.seriesIconCovers || {});
        Object.keys(data.allSeries).forEach((k) => {
          allSeries[k] = data.allSeries[k];
        });
        if (window.showSeriesOverview) window.showSeriesOverview();
        if (typeof window.onCatalogReady === 'function') window.onCatalogReady(data);
      })
      .catch((err) => console.error('Chargement du catalogue œuvres:', err));
  }

  if (seriesList) {
    seriesList.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        e.preventDefault();
        const code = e.target.getAttribute('href').replace('#', '');
        if (typeof showSection === 'function') showSection('gallery');
        else {
          document.getElementById('welcome-section').style.display = 'none';
          document.getElementById('series-overview').style.display = 'none';
          document.getElementById('gallery').style.display = '';
        }
        displaySeries(code);
        Array.from(seriesList.querySelectorAll('a')).forEach((a) => a.classList.remove('active'));
        e.target.classList.add('active');
      }
    });
  }

  function displaySeries(code) {
    gallery.innerHTML = '';
    currentSeries = allSeries[code] || [];
    if (!currentSeries.length) return;
    if (window.innerWidth < 900) {
      showLightbox(0);
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
      img.addEventListener('click', () => showLightbox(idx));
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
        if (typeof showSection === 'function') showSection('gallery');
        else {
          overview.style.display = 'none';
          galleryEl.style.display = '';
        }
        displaySeries(code);
        if (seriesList) {
          Array.from(seriesList.querySelectorAll('a')).forEach((a) => a.classList.remove('active'));
          const menuItem = seriesList.querySelector(`a[href="#${code}"]`);
          if (menuItem) menuItem.classList.add('active');
        }
      };
      serieDiv.appendChild(title);
      serieDiv.appendChild(img);
      overview.appendChild(serieDiv);
    });
  };

  createLightbox();
});
