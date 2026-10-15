/**
 * Bandeau « Le site a été mis à jour » : la page vérifie régulièrement l'empreinte (ETag / Last-Modified)
 * de son propre fichier ; GitHub Pages en change à chaque publication. Un clic recharge la page.
 */
(function () {
  'use strict';

  const CHECK_EVERY_MS = 60 * 1000;
  const url = location.origin + location.pathname;
  let initial = null;
  let shown = false;

  async function signature() {
    try {
      const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!r.ok) return null;
      return r.headers.get('etag') || r.headers.get('last-modified') || null;
    } catch {
      return null;
    }
  }

  function showBanner() {
    if (shown) return;
    shown = true;
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'site-update-banner';
    bar.setAttribute('role', 'status');
    bar.textContent = 'Le site a été mis à jour, cliquer pour actualiser la page';
    bar.addEventListener('click', () => location.reload());
    const style = document.createElement('style');
    style.textContent =
      '.site-update-banner{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:block;width:100%;' +
      'padding:10px 16px;border:none;background:#1f5fa8;color:#fff;font:600 15px/1.3 system-ui,-apple-system,sans-serif;' +
      'text-align:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.25)}' +
      '.site-update-banner:hover,.site-update-banner:focus-visible{background:#174c87;outline:none}' +
      'body.has-site-update-banner{padding-top:42px}';
    document.head.appendChild(style);
    document.body.prepend(bar);
    document.body.classList.add('has-site-update-banner');
  }

  async function check() {
    if (shown) return;
    const sig = await signature();
    if (!sig) return;
    if (initial === null) initial = sig;
    else if (sig !== initial) showBanner();
  }

  check();
  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check();
  });
})();
