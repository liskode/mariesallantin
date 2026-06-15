// gallery.js
// Handles loading and displaying artworks by series for Marie Sallantin's website

document.addEventListener('DOMContentLoaded', () => {
  const gallery = document.getElementById('gallery');
  const seriesList = document.getElementById('series-list');
  let allSeries = {};
  let seriesNames = {};
  /** @type {string[]} ordre d’affichage des séries (rempli après WorksCatalog.load) */
  let seriesOrder = [];
  let currentSeries = [];
  let currentSeriesCode = '';
  let currentIndex = 0;

  function mediaSrc(filePath) {
    if (typeof WorksCatalog !== 'undefined' && typeof WorksCatalog.buildMediaUrl === 'function') {
      return WorksCatalog.buildMediaUrl(filePath);
    }
    return `media/${filePath}`;
  }

  // Lightbox elements
  let lightbox, lightboxImg, lightboxTitle, lightboxClose, lightboxPrev, lightboxNext;

  // Create lightbox HTML
  function createLightbox() {
    lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.style.display = 'none';
    lightbox.innerHTML = `
      <span class="close">&times;</span>
      <span class="prev">&#10094;</span>
      <img src="" alt="" />
      <div class="lightbox-title"></div>
      <span class="next">&#10095;</span>
    `;
    document.body.appendChild(lightbox);
    lightboxImg = lightbox.querySelector('img');
    lightboxTitle = lightbox.querySelector('.lightbox-title');
    lightboxClose = lightbox.querySelector('.close');
    lightboxPrev = lightbox.querySelector('.prev');
    lightboxNext = lightbox.querySelector('.next');

    lightboxClose.onclick = () => (lightbox.style.display = 'none');
    lightbox.onclick = (e) => { if (e.target === lightbox) lightbox.style.display = 'none'; };
    lightboxPrev.onclick = (e) => { e.stopPropagation(); showLightbox(currentIndex - 1); };
    lightboxNext.onclick = (e) => { e.stopPropagation(); showLightbox(currentIndex + 1); };
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
    const { filePath, title } = currentSeries[index];
    lightboxImg.src = mediaSrc(filePath);
    lightboxImg.alt = title;
    lightboxTitle.textContent = title;
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
    console.error('Charger works-catalog.js avant gallery.js');
  } else {
    WorksCatalog.load()
      .then((data) => {
        seriesOrder = data.seriesOrder || [];
        Object.assign(seriesNames, data.seriesNames);
        Object.keys(data.allSeries).forEach((k) => {
          allSeries[k] = data.allSeries[k];
        });
        if (window.showSeriesOverview) window.showSeriesOverview();
      })
      .catch((err) => console.error('Chargement du catalogue œuvres:', err));
  }

  // Listen for menu clicks
  if (seriesList) {
    seriesList.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        e.preventDefault();
        const code = e.target.getAttribute('href').replace('#','');
        if (typeof showSection === 'function') showSection('gallery');
        else {
          document.getElementById('welcome-section').style.display = 'none';
          document.getElementById('series-overview').style.display = 'none';
          document.getElementById('gallery').style.display = '';
        }
        displaySeries(code);
        // Update active class
        Array.from(seriesList.querySelectorAll('a')).forEach(a => a.classList.remove('active'));
        e.target.classList.add('active');
      }
    });
  }

  function displaySeries(code) {
    gallery.innerHTML = '';
    currentSeries = allSeries[code] || [];
    currentSeriesCode = code;
    if (!currentSeries.length) return;
    // Si mobile (<900px), ouvrir la lightbox directement
    if (window.innerWidth < 900) {
      showLightbox(0);
      return;
    }
    // Sinon (desktop), afficher uniquement la grille des peintures
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

  window.showSeriesOverview = function() {
    const overview = document.getElementById('series-overview');
    const gallery = document.getElementById('gallery');
    overview.innerHTML = '';
    if (typeof showSection === 'function') showSection('series-overview');
    else {
      overview.style.display = '';
      gallery.style.display = 'none';
      document.getElementById('welcome-section').style.display = 'none';
    }
    // Affiche la première image de chaque série
    seriesCodesForGallery({ seriesOrder, allSeries }).forEach((code) => {
      if (!allSeries[code].length) return;
      const serieDiv = document.createElement('div');
      serieDiv.className = 'series-overview-item';
      const title = document.createElement('div');
      title.className = 'series-overview-title';
      title.textContent = seriesNames[code];
      const img = document.createElement('img');
      img.src = mediaSrc(allSeries[code][0].filePath);
      img.alt = seriesNames[code];
      img.className = 'series-overview-img';
      img.style.cursor = 'pointer';
      img.onclick = () => {
        if (typeof showSection === 'function') showSection('gallery');
        else {
          overview.style.display = 'none';
          gallery.style.display = '';
        }
        displaySeries(code);
        // Update active class in sidebar menu
        if (seriesList) {
          Array.from(seriesList.querySelectorAll('a')).forEach(a => a.classList.remove('active'));
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