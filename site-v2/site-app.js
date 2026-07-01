/**
 * Accueil site-v2 : menu séries, hero (œuvres G), routing galerie.
 */
(function () {
  function showSection(section) {
    var welcome = document.getElementById('welcome-section');
    var overview = document.getElementById('series-overview');
    var gallery = document.getElementById('gallery');
    if (!welcome || !overview || !gallery) return;
    if (section !== 'welcome-section') stopHeroRotation();
    welcome.style.display = section === 'welcome-section' ? '' : 'none';
    overview.style.display = section === 'series-overview' ? '' : 'none';
    gallery.style.display = section === 'gallery' ? '' : 'none';
  }
  window.showSection = showSection;

  function isGalleryRoute() {
    if (window.location.search.includes('gallery')) return true;
    var hash = window.location.hash.replace('#', '').trim();
    return hash.length > 0;
  }

  function buildSeriesMenu(data) {
    var ul = document.getElementById('series-list');
    if (!ul) return;
    ul.innerHTML = '';
    data.seriesOrder.forEach(function (code) {
      var name = data.seriesNames[code];
      if (!name) return;
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + code;
      a.textContent = name;
      a.onclick = function (e) {
        e.preventDefault();
        stopHeroRotation();
        if (typeof window.selectSeries === 'function') {
          window.selectSeries(code);
        } else {
          showSection('gallery');
        }
        var galleryEl = document.getElementById('gallery');
        if (galleryEl) {
          window.scrollTo({ top: galleryEl.offsetTop - 40, behavior: 'smooth' });
        }
      };
      li.appendChild(a);
      ul.appendChild(li);
    });
  }

  var heroPool = [];
  var heroTimer = null;

  function pickHeroWork(data) {
    var pool = (data.galleryWorks && data.galleryWorks.length && data.galleryWorks) || heroPool;
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function showHeroWork(w, data) {
    if (!w) return;
    var codes = w.series || [];
    var seriesName = codes
      .map(function (c) {
        return data.seriesNames[c] || c;
      })
      .join(' · ');
    var seriesCode = codes[0] || '';
    var img = document.getElementById('random-image');
    var titleElement = document.getElementById('image-title');
    var seriesNameElement = document.getElementById('series-name');
    if (!img || !titleElement || !seriesNameElement) return;
    img.src = WorksCatalog.buildMediaUrl(w.media);
    titleElement.textContent = w.title || w.id;
    seriesNameElement.textContent = seriesName || '—';
    seriesNameElement.dataset.seriesCode = seriesCode;
  }

  function loadRandomImage(data) {
    var catalog = data;
    if (!catalog && typeof WorksCatalog !== 'undefined') {
      WorksCatalog.load()
        .then(loadRandomImage)
        .catch(function (err) {
          console.error('Hero:', err);
        });
      return;
    }
    var w = pickHeroWork(catalog);
    showHeroWork(w, catalog);
  }

  function startHeroRotation(data) {
    heroPool = data.galleryWorks || [];
    loadRandomImage(data);
    if (heroTimer) clearInterval(heroTimer);
    heroTimer = setInterval(function () {
      loadRandomImage(data);
    }, 6000);
    window._randomImageInterval = heroTimer;
  }

  function stopHeroRotation() {
    if (heroTimer) {
      clearInterval(heroTimer);
      heroTimer = null;
    }
  }

  function openGalleryFromUrl() {
    if (!window.location.search.includes('gallery') && window.location.hash !== '#gallery') return;
    var tries = 0;
    var interval = setInterval(function () {
      var welcome = document.getElementById('welcome-section');
      if (welcome) {
        welcome.style.display = 'none';
        stopHeroRotation();
        clearInterval(interval);
      }
      tries++;
      if (tries > 30) clearInterval(interval);
    }, 100);
  }

  window.onCatalogReady = function (data) {
    buildSeriesMenu(data);
    var welcomeVisible =
      document.getElementById('welcome-section') &&
      document.getElementById('welcome-section').style.display !== 'none';
    if (welcomeVisible) startHeroRotation(data);
  };

  openGalleryFromUrl();

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.main-nav a, .mobile-nav a').forEach(function (a) {
      if (a.textContent.trim().toLowerCase() === 'peintures') {
        a.addEventListener('click', function (e) {
          if (!window.location.search.includes('gallery')) return;
          e.preventDefault();
          stopHeroRotation();
          showSection('series-overview');
          if (window.showSeriesOverview) window.showSeriesOverview();
          history.replaceState(null, '', window.location.pathname + '?gallery');
        });
      }
    });

    document.addEventListener('click', function (e) {
      if (e.target.classList.contains('clickable-series')) {
        var seriesCode = e.target.dataset.seriesCode;
        if (!seriesCode) return;
        stopHeroRotation();
        if (typeof window.selectSeries === 'function') {
          window.selectSeries(seriesCode);
        }
      }
    });

    var logo = document.getElementById('logo-link');
    if (logo) {
      logo.addEventListener('click', function (e) {
        e.preventDefault();
        window.history.replaceState({}, '', window.location.pathname);
        showSection('welcome-section');
        if (typeof WorksCatalog !== 'undefined') {
          WorksCatalog.load().then(startHeroRotation);
        }
      });
    }
  });
})();
