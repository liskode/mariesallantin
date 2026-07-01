/**
 * Page Ressources — rendu par sections et filtres.
 */
(function () {
  const SECTION_DEFS = [
    {
      id: 'resources-web',
      title: 'Sur le web',
      match: function (item) {
        return !item.internal_path && item.media_type_code === 'WEB';
      },
    },
    {
      id: 'resources-press',
      title: 'Presse',
      match: function (item) {
        return !item.internal_path && item.media_type_code === 'PRESS';
      },
    },
    {
      id: 'resources-video',
      title: 'Vidéos & interviews',
      match: function (item) {
        return !item.internal_path && item.media_type_code === 'VIDEO';
      },
    },
    {
      id: 'resources-audio',
      title: 'Audio',
      match: function (item) {
        return !item.internal_path && item.media_type_code === 'AUDIO';
      },
    },
    {
      id: 'resources-pub',
      title: 'Catalogues & livres',
      match: function (item) {
        return !item.internal_path && (item.media_type_code === 'EXCAT' || item.media_type_code === 'BOOK');
      },
    },
    {
      id: 'resources-site',
      title: 'Sur ce site',
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

  function sectionsFromItems(items) {
    return SECTION_DEFS.map(function (def) {
      const sectionItems = items.filter(def.match);
      return { id: def.id, title: def.title, items: sectionItems };
    }).filter(function (section) {
      return section.items.length > 0;
    });
  }

  function renderJumpNav(sections) {
    return sections
      .map(function (section) {
        return (
          '<a class="resources-jump-link" href="#' +
          section.id +
          '">' +
          escapeHtml(section.title) +
          '</a>'
        );
      })
      .join('');
  }

  function renderSections(sections) {
    return sections
      .map(function (section) {
        return (
          '<section class="resources-section" id="' +
          section.id +
          '" aria-labelledby="' +
          section.id +
          '-title">' +
          '<h3 class="resources-section-title" id="' +
          section.id +
          '-title">' +
          escapeHtml(section.title) +
          '</h3>' +
          '<ul class="resources-grid">' +
          section.items.map(renderCard).join('') +
          '</ul>' +
          '</section>'
        );
      })
      .join('');
  }

  function wireJumpNav() {
    document.querySelectorAll('.resources-jump-link').forEach(function (link) {
      link.addEventListener('click', function (e) {
        const id = link.getAttribute('href');
        if (!id || id.charAt(0) !== '#') return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function showEmpty() {
    const root = document.getElementById('resources-root');
    if (!root) return;
    root.innerHTML = '<p class="resources-empty">Aucune ressource publiée pour le moment.</p>';
  }

  function render(data) {
    const jump = document.getElementById('resources-jump');
    const root = document.getElementById('resources-root');
    if (!root) return;

    const sections = sectionsFromItems(data.items || []);
    if (!sections.length) {
      if (jump) jump.innerHTML = '';
      showEmpty();
      return;
    }

    if (jump) jump.innerHTML = renderJumpNav(sections);
    root.innerHTML = renderSections(sections);
    wireJumpNav();
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
