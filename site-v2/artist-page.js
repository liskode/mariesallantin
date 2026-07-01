/**
 * Page L'Artiste — rendu des sections et interactions.
 */
(function () {
  const PREVIEW_COUNT = 12;

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderEntry(entry) {
    return (
      '<li class="artist-entry">' +
      '<span class="artist-entry-year">' +
      escapeHtml(entry.year) +
      '</span>' +
      '<span class="artist-entry-label">' +
      escapeHtml(entry.label) +
      '</span>' +
      '</li>'
    );
  }

  function renderTimeline(entries, extraClass) {
    const cls = 'artist-timeline' + (extraClass ? ' ' + extraClass : '');
    return '<ol class="' + cls + '">' + entries.map(renderEntry).join('') + '</ol>';
  }

  function renderSection(section) {
    const entries = section.entries || [];
    const hasMore = entries.length > PREVIEW_COUNT;
    const visible = hasMore ? entries.slice(0, PREVIEW_COUNT) : entries;
    const hidden = hasMore ? entries.slice(PREVIEW_COUNT) : [];

    let body =
      renderTimeline(visible) +
      (hidden.length
        ? '<div class="artist-timeline-more-wrap" hidden>' +
          renderTimeline(hidden, 'artist-timeline-more') +
          '</div>' +
          '<button type="button" class="artist-show-more" data-section="' +
          section.id +
          '">Voir toutes les entrées (' +
          entries.length +
          ')</button>'
        : '');

    return (
      '<section class="artist-panel" id="' +
      section.id +
      '" aria-labelledby="' +
      section.id +
      '-title">' +
      '<details class="artist-details" open>' +
      '<summary class="artist-panel-title" id="' +
      section.id +
      '-title">' +
      escapeHtml(section.title) +
      '</summary>' +
      '<div class="artist-panel-body">' +
      body +
      '</div>' +
      '</details>' +
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

  function fillJumpNav() {
    const nav = document.getElementById('artist-jump');
    if (!nav || !window.ArtistData) return;
    nav.innerHTML = ArtistData.sections
      .map(function (section) {
        return (
          '<a class="artist-jump-link" href="#' +
          section.id +
          '">' +
          escapeHtml(section.title) +
          '</a>'
        );
      })
      .join('');
  }

  function fillSections() {
    const container = document.getElementById('artist-sections');
    if (!container || !window.ArtistData) return;
    container.innerHTML = ArtistData.sections.map(renderSection).join('');
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

  function wireJumpNav() {
    document.querySelectorAll('.artist-jump-link').forEach(function (link) {
      link.addEventListener('click', function (e) {
        const id = link.getAttribute('href');
        if (!id || id.charAt(0) !== '#') return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        const details = target.querySelector('.artist-details');
        if (details) details.open = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.innerWidth < 900) closeOtherDetails(details);
      });
    });
  }

  function closeOtherDetails(openDetails) {
    if (!openDetails) return;
    document.querySelectorAll('.artist-details').forEach(function (d) {
      if (d !== openDetails) d.open = false;
    });
  }

  function wireAccordionMobile() {
    const isMobile = window.innerWidth < 900;
    const detailsList = document.querySelectorAll('.artist-details');
    detailsList.forEach(function (details, index) {
      details.open = !isMobile || index === 0;
      details.addEventListener('toggle', function () {
        if (window.innerWidth >= 900 || !details.open) return;
        closeOtherDetails(details);
      });
    });
  }

  function init() {
    if (!window.ArtistData) return;
    fillBio();
    fillJumpNav();
    fillSections();
    wireShowMore();
    wireJumpNav();
    wireAccordionMobile();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
