/**
 * Menu latéral séries + navigation Peintures (pages secondaires site-v2).
 */
(function () {
  function coverPathForSeries(data, code) {
    var cover = data.seriesIconCovers && data.seriesIconCovers[code];
    if (cover && cover.filePath) return cover.filePath;
    var list = data.allSeries && data.allSeries[code];
    if (list && list.length && list[0].filePath) return list[0].filePath;
    return null;
  }

  function fillSeriesMenu(data, linkPrefix) {
    var ul = document.getElementById('series-list');
    if (!ul || !data) return;
    ul.innerHTML = '';
    var prefix = linkPrefix || '../index.html?gallery#';
    (data.seriesOrder || []).forEach(function (code) {
      var name = data.seriesNames[code];
      var works = data.allSeries && data.allSeries[code];
      if (!name || !works || !works.length) return;
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = prefix + code;
      var mediaPath = coverPathForSeries(data, code);
      if (mediaPath && typeof WorksCatalog !== 'undefined' && WorksCatalog.buildThumbUrl) {
        var thumb = document.createElement('span');
        thumb.className = 'series-menu-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        var img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        var thumbUrl = WorksCatalog.buildThumbUrl(mediaPath);
        var fullUrl = WorksCatalog.buildMediaUrl(mediaPath);
        img.src = thumbUrl;
        if (thumbUrl !== fullUrl) {
          img.onerror = function () {
            img.onerror = null;
            img.src = fullUrl;
          };
        }
        thumb.appendChild(img);
        a.appendChild(thumb);
      }
      var label = document.createElement('span');
      label.className = 'series-menu-label';
      label.textContent = name;
      a.appendChild(label);
      li.appendChild(a);
      ul.appendChild(li);
    });
  }

  function wirePeinturesNav() {
    document.querySelectorAll('.main-nav a, .mobile-nav a').forEach(function (a) {
      if (a.textContent.trim().toLowerCase() === 'peintures') {
        a.addEventListener('click', function () {
          window.location.replace(a.href);
        });
      }
    });
  }

  function initSecondaryPage(linkPrefix) {
    wirePeinturesNav();
    if (typeof WorksCatalog !== 'undefined') {
      WorksCatalog.load()
        .then(function (data) {
          fillSeriesMenu(data, linkPrefix);
        })
        .catch(function (err) {
          console.error('Menu séries:', err);
        });
    }
  }

  window.SiteNav = {
    fillSeriesMenu: fillSeriesMenu,
    wirePeinturesNav: wirePeinturesNav,
    initSecondaryPage: initSecondaryPage,
  };
})();
