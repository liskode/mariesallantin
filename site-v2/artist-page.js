/**
 * Page L'Artiste — parcours depuis SiteEvents (filtre par type d'événement).
 */
(function () {
  const PREVIEW_COUNT = 12;
  let activeTypeCode = '';
  /** @type {{ event_types: Array<object>, items: Array<object> }} */
  let eventsData = null;

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function mediaHref(media) {
    if (typeof SiteResources !== 'undefined') {
      if (media.internal_path) return SiteResources.resolveInternalPath(media.internal_path);
      if (media.file_path) return SiteResources.resolveMediaPath(media.file_path);
    }
    return media.url || '#';
  }

  function mediaExternal(media) {
    return !media.internal_path && Boolean(media.url) && !media.file_path;
  }

  function renderMediaLinks(mediaList) {
    if (!mediaList || !mediaList.length) return '';
    const links = mediaList
      .map(function (media) {
        const href = mediaHref(media);
        const external = mediaExternal(media);
        const rel = external ? ' rel="noopener noreferrer"' : '';
        const target = external ? ' target="_blank"' : '';
        const title = escapeHtml(media.title || 'Ressource');
        return (
          '<a class="artist-entry-media-link" href="' +
          escapeHtml(href) +
          '"' +
          target +
          rel +
          ' title="' +
          title +
          '"><span class="artist-entry-media-link-label">' +
          title +
          '</span><span class="artist-entry-media-link-icon" aria-hidden="true">↗</span></a>'
        );
      })
      .join('');
    return '<span class="artist-entry-media">' + links + '</span>';
  }

  function renderEntry(item) {
    const year = SiteEvents.displayDate(item);
    const note = item.note
      ? '<p class="artist-entry-note">' + escapeHtml(item.note) + '</p>'
      : '';
    const media = renderMediaLinks(item.media);

    return (
      '<li class="artist-entry">' +
      '<span class="artist-entry-year">' +
      escapeHtml(year) +
      '</span>' +
      '<span class="artist-entry-body">' +
      '<span class="artist-entry-label">' +
      escapeHtml(item.label) +
      '</span>' +
      note +
      media +
      '</span>' +
      '</li>'
    );
  }

  function renderTimeline(entries, extraClass) {
    const cls = 'artist-timeline' + (extraClass ? ' ' + extraClass : '');
    return '<ol class="' + cls + '">' + entries.map(renderEntry).join('') + '</ol>';
  }

  function visibleTypes() {
    if (!eventsData) return [];
    const codesWithItems = new Set(
      (eventsData.items || []).map(function (item) {
        return item.event_type_code;
      })
    );
    return (eventsData.event_types || []).filter(function (t) {
      return codesWithItems.has(t.code);
    });
  }

  function itemsForType(typeCode) {
    return (eventsData.items || []).filter(function (item) {
      return item.event_type_code === typeCode;
    });
  }

  function typeLabel(typeCode) {
    const t = (eventsData.event_types || []).find(function (x) {
      return x.code === typeCode;
    });
    return t ? t.label : typeCode;
  }

  function renderSection(typeCode) {
    const entries = itemsForType(typeCode);
    const hasMore = entries.length > PREVIEW_COUNT;
    const visible = hasMore ? entries.slice(0, PREVIEW_COUNT) : entries;
    const hidden = hasMore ? entries.slice(PREVIEW_COUNT) : [];

    let body =
      renderTimeline(visible) +
      (hidden.length
        ? '<div class="artist-timeline-more-wrap" hidden>' +
          renderTimeline(hidden, 'artist-timeline-more') +
          '</div>' +
          '<button type="button" class="artist-show-more" data-type="' +
          escapeHtml(typeCode) +
          '">Voir toutes les entrées (' +
          entries.length +
          ')</button>'
        : '');

    return (
      '<section class="artist-panel" id="artist-type-' +
      escapeHtml(typeCode) +
      '" aria-labelledby="artist-type-' +
      escapeHtml(typeCode) +
      '-title">' +
      '<h3 class="artist-panel-title" id="artist-type-' +
      escapeHtml(typeCode) +
      '-title">' +
      escapeHtml(typeLabel(typeCode)) +
      '</h3>' +
      '<div class="artist-panel-body">' +
      body +
      '</div>' +
      '</section>'
    );
  }

  function fillBio() {
    const container = document.getElementById('artist-bio-text');
    if (!container || !window.ArtistData || !ArtistData.bio) return;
    container.innerHTML = ArtistData.bio.map(function (p) {
      return '<p>' + escapeHtml(p) + '</p>';
    }).join('');
  }

  function fillFilterNav() {
    const nav = document.getElementById('artist-jump');
    const types = visibleTypes();
    if (!nav || !types.length) return;

    if (!activeTypeCode || !types.some(function (t) { return t.code === activeTypeCode; })) {
      activeTypeCode = types[0].code;
    }

    nav.innerHTML = types
      .map(function (type) {
        const active = type.code === activeTypeCode ? ' is-active' : '';
        return (
          '<button type="button" class="artist-jump-link artist-filter-btn' +
          active +
          '" data-type="' +
          escapeHtml(type.code) +
          '" aria-pressed="' +
          (type.code === activeTypeCode ? 'true' : 'false') +
          '">' +
          escapeHtml(type.label) +
          '</button>'
        );
      })
      .join('');
  }

  function fillActiveSection() {
    const container = document.getElementById('artist-sections');
    if (!container || !activeTypeCode) return;
    container.innerHTML = renderSection(activeTypeCode);
  }

  function wireShowMore() {
    document.querySelectorAll('.artist-show-more').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const panel = btn.closest('.artist-panel');
        if (!panel) return;
        const more = panel.querySelector('.artist-timeline-more-wrap');
        if (more) more.hidden = false;
        btn.remove();
      });
    });
  }

  function wireFilterNav() {
    document.querySelectorAll('.artist-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const code = btn.getAttribute('data-type');
        if (!code || code === activeTypeCode) return;
        activeTypeCode = code;
        fillFilterNav();
        fillActiveSection();
        wireShowMore();
      });
    });
  }

  function showEmpty() {
    const nav = document.getElementById('artist-jump');
    const container = document.getElementById('artist-sections');
    if (nav) nav.innerHTML = '';
    if (container) {
      container.innerHTML = '<p class="artist-empty">Parcours indisponible pour le moment.</p>';
    }
  }

  function render(data) {
    eventsData = data;
    if (!data.items || !data.items.length) {
      showEmpty();
      return;
    }
    fillFilterNav();
    fillActiveSection();
    wireShowMore();
    wireFilterNav();
  }

  function init() {
    fillBio();
    if (typeof SiteEvents === 'undefined') {
      console.error('Charger site-events.js avant artist-page.js');
      showEmpty();
      return;
    }
    SiteEvents.load()
      .then(render)
      .catch(function (err) {
        console.error('Parcours artiste:', err);
        showEmpty();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
