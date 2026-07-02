/**
 * Page Ressources — filtres par catégorie (un seul affichage à la fois).
 */
(function () {
  const FILTER_DEFS = [
    { id: 'recent', label: 'Récents', kind: 'recent' },
    { id: 'essential', label: 'Essentiels', kind: 'essential' },
    {
      id: 'web',
      label: 'Sur le web',
      match: function (item) {
        return !item.internal_path && item.media_type_code === 'WEB';
      },
    },
    {
      id: 'press',
      label: 'Presse',
      match: function (item) {
        return !item.internal_path && item.media_type_code === 'PRESS';
      },
    },
    {
      id: 'video',
      label: 'Vidéos & interviews',
      match: function (item) {
        return !item.internal_path && item.media_type_code === 'VIDEO';
      },
    },
    {
      id: 'audio',
      label: 'Audio',
      optional: true,
      match: function (item) {
        return !item.internal_path && item.media_type_code === 'AUDIO';
      },
    },
    {
      id: 'pub',
      label: 'Catalogues & livres',
      optional: true,
      match: function (item) {
        return (
          !item.internal_path &&
          (item.media_type_code === 'EXCAT' || item.media_type_code === 'BOOK')
        );
      },
    },
    {
      id: 'site',
      label: 'Sur ce site',
      match: function (item) {
        return Boolean(item.internal_path);
      },
    },
  ];

  const TYPE_LABELS = {
    WEB: 'Lien',
    PRESS: 'Presse',
    VIDEO: 'Vidéo',
    AUDIO: 'Audio',
    EXCAT: 'Catalogue',
    BOOK: 'Livre',
  };

  /** @type {Array<object>} */
  let allItems = [];
  let activeFilterId = 'recent';

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(value) {
    if (!value) return '';
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-');
      return d === '01' && m === '01' ? y : new Date(s + 'T12:00:00').toLocaleDateString('fr-FR');
    }
    return s;
  }

  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function itemHref(item) {
    if (item.internal_path) return SiteResources.resolveInternalPath(item.internal_path);
    if (item.file_path) return SiteResources.resolveMediaPath(item.file_path);
    return item.url || '#';
  }

  function itemExternal(item) {
    return !item.internal_path && Boolean(item.url) && !item.file_path;
  }

  function thumbForItem(item) {
    if (item.thumbnail_path) return SiteResources.resolveAssetPath(item.thumbnail_path);
    return '';
  }

  function placeholderClass(item) {
    if (item.internal_path) return 'resource-thumb-placeholder--site';
    return 'resource-thumb-placeholder--' + String(item.media_type_code || 'web').toLowerCase();
  }

  function renderThumb(item) {
    const src = thumbForItem(item);
    if (src) {
      return '<img class="resource-card-thumb" src="' + escapeHtml(src) + '" alt="" loading="lazy" decoding="async" />';
    }
    const label = TYPE_LABELS[item.media_type_code] || 'Ressource';
    return (
      '<span class="resource-thumb-placeholder ' +
      placeholderClass(item) +
      '" aria-hidden="true"><span class="resource-thumb-placeholder-label">' +
      escapeHtml(label) +
      '</span></span>'
    );
  }

  function renderMeta(item) {
    const parts = [];
    if (item.source) parts.push(escapeHtml(item.source));
    const date = formatDate(item.media_date);
    if (date) parts.push(escapeHtml(date));
    const duration = formatDuration(item.duration_seconds);
    if (duration) parts.push(escapeHtml(duration));
    if (!parts.length) return '';
    return '<p class="resource-card-meta">' + parts.join(' · ') + '</p>';
  }

  function renderCard(item) {
    const href = itemHref(item);
    const external = itemExternal(item);
    const title = escapeHtml(item.title || 'Sans titre');
    const desc = item.description
      ? '<p class="resource-card-desc">' + escapeHtml(item.description) + '</p>'
      : '';
    const rel = external ? ' rel="noopener noreferrer"' : '';
    const target = external ? ' target="_blank"' : '';
    const icon = external ? '<span class="resource-card-external" aria-hidden="true">↗</span>' : '';

    return (
      '<li class="resource-card-item">' +
      '<a class="resource-card" href="' +
      escapeHtml(href) +
      '"' +
      target +
      rel +
      '>' +
      renderThumb(item) +
      '<span class="resource-card-body">' +
      '<span class="resource-card-title">' +
      title +
      icon +
      '</span>' +
      renderMeta(item) +
      desc +
      '</span>' +
      '</a>' +
      '</li>'
    );
  }

  function sortRecent(items) {
    return items.slice().sort(function (a, b) {
      const da = a.media_date ? String(a.media_date) : '';
      const db = b.media_date ? String(b.media_date) : '';
      if (da !== db) {
        if (!da) return 1;
        if (!db) return -1;
        return db.localeCompare(da);
      }
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  }

  function sortDefault(items) {
    return items.slice().sort(function (a, b) {
      const order = (a.sort_order || 0) - (b.sort_order || 0);
      if (order !== 0) return order;
      const da = a.media_date ? String(a.media_date) : '';
      const db = b.media_date ? String(b.media_date) : '';
      return db.localeCompare(da);
    });
  }

  function visibleFilters() {
    return FILTER_DEFS.filter(function (def) {
      if (!def.optional) return true;
      if (def.kind === 'recent' || def.kind === 'essential') return true;
      return allItems.some(def.match);
    });
  }

  function itemsForFilter(filterId) {
    const def = FILTER_DEFS.find(function (f) {
      return f.id === filterId;
    });
    if (!def) return [];

    if (def.kind === 'recent') return sortRecent(allItems);
    if (def.kind === 'essential') {
      return sortDefault(allItems.filter(function (item) {
        return Boolean(item.is_essential);
      }));
    }
    return sortDefault(
      allItems.filter(function (item) {
        return def.match(item);
      })
    );
  }

  function renderFilterNav() {
    const jump = document.getElementById('resources-jump');
    if (!jump) return;

    const filters = visibleFilters();
    if (!filters.some(function (f) {
      return f.id === activeFilterId;
    })) {
      activeFilterId = 'recent';
    }

    jump.innerHTML = filters
      .map(function (def) {
        const active = def.id === activeFilterId ? ' is-active' : '';
        return (
          '<button type="button" class="resources-jump-link resources-filter-btn' +
          active +
          '" data-filter="' +
          escapeHtml(def.id) +
          '" aria-pressed="' +
          (def.id === activeFilterId ? 'true' : 'false') +
          '">' +
          escapeHtml(def.label) +
          '</button>'
        );
      })
      .join('');
  }

  function renderGrid() {
    const root = document.getElementById('resources-root');
    if (!root) return;

    const items = itemsForFilter(activeFilterId);
    if (!items.length) {
      const def = FILTER_DEFS.find(function (f) {
        return f.id === activeFilterId;
      });
      const label = def ? def.label.toLowerCase() : 'cette catégorie';
      root.innerHTML = '<p class="resources-empty">Aucun média dans « ' + escapeHtml(label) + ' ».</p>';
      return;
    }

    root.innerHTML = '<ul class="resources-grid">' + items.map(renderCard).join('') + '</ul>';
  }

  function wireFilterNav() {
    document.querySelectorAll('.resources-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-filter');
        if (!id || id === activeFilterId) return;
        activeFilterId = id;
        renderFilterNav();
        renderGrid();
        wireFilterNav();
      });
    });
  }

  function showEmpty() {
    const jump = document.getElementById('resources-jump');
    const root = document.getElementById('resources-root');
    if (jump) jump.innerHTML = '';
    if (root) root.innerHTML = '<p class="resources-empty">Aucune ressource publiée pour le moment.</p>';
  }

  function render(data) {
    allItems = data.items || [];
    if (!allItems.length) {
      showEmpty();
      return;
    }
    renderFilterNav();
    renderGrid();
    wireFilterNav();
  }

  function init() {
    if (typeof SiteResources === 'undefined') {
      console.error('Charger site-resources.js avant resources-page.js');
      return;
    }
    SiteResources.load()
      .then(render)
      .catch(function (err) {
        console.error('Ressources:', err);
        showEmpty();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
