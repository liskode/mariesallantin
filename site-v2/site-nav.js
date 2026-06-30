/**
 * Menu latéral séries + navigation Peintures (pages secondaires site-v2).
 */
(function () {
  function fillSeriesMenu(data, linkPrefix) {
    var ul = document.getElementById('series-list');
    if (!ul || !data) return;
    ul.innerHTML = '';
    var prefix = linkPrefix || 'index.html?gallery#';
    data.seriesOrder.forEach(function (code) {
      var name = data.seriesNames[code];
      if (!name) return;
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = prefix + code;
      a.textContent = name;
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
