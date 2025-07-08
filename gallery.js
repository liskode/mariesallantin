// gallery.js
// Handles loading and displaying artworks by series for Marie Sallantin's website

document.addEventListener('DOMContentLoaded', () => {
  const gallery = document.getElementById('gallery');
  const seriesList = document.getElementById('series-list');
  let allSeries = {};
  let seriesNames = {};
  let currentSeries = [];
  let currentSeriesCode = '';
  let currentIndex = 0;

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
    lightboxImg.src = `media/${filePath}`;
    lightboxImg.alt = title;
    lightboxTitle.textContent = title;
    lightbox.style.display = 'flex';
  }

  // Load titles.txt and parse series and artworks
  fetch('media/titles.txt')
    .then(r => r.text())
    .then(text => {
      const lines = text.split('\n');
      let current = '';
      lines.forEach(line => {
        if (line.startsWith('#')) {
          const [code, name] = line.replace('#','').split(';');
          current = code.trim();
          seriesNames[current] = name.trim();
          allSeries[current] = [];
        } else if (line.includes('/') && line.includes(';')) {
          const [filePath, title] = line.split(';');
          const folder = filePath.split('/')[0];
          if (allSeries[folder]) {
            allSeries[folder].push({ filePath: filePath.trim(), title: title.trim() });
          }
        }
      });
      // Show first series by default
      const firstSeries = Object.keys(allSeries)[0];
      if (firstSeries) displaySeries(firstSeries);
    });

  // Listen for menu clicks
  if (seriesList) {
    seriesList.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        e.preventDefault();
        const code = e.target.getAttribute('href').replace('#','');
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
    currentSeries.forEach(({ filePath }, idx) => {
      const item = document.createElement('div');
      item.className = 'gallery-item';
      item.innerHTML = `<img src="media/${filePath}" alt="" loading="lazy">`;
      item.onclick = () => showLightbox(idx);
      gallery.appendChild(item);
    });
  }

  createLightbox();
}); 