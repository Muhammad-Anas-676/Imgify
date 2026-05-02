// public/js/album-view.js
// Imgify — Album View Page Logic | File 17/43
// Author: Muhammad Anas · imgify.site

import { db } from './firebase-init.js';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { generateQRCode, downloadQRCode } from './qrcode-helper.js';

// ── XSS-safe HTML escape (same pattern as image-view.js) ──────────────────────
function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  let toast = document.querySelector('.imgify-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'imgify-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.dataset.type = type;
  toast.classList.add('imgify-toast-visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('imgify-toast-visible'), 3200);
}

// ── Lazy script loader ─────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
let _albumData = null;
let _images = [];
let _currentPage = 1;
const PAGE_SIZE = 12;

// ── Entry Point ───────────────────────────────────────────────────────────────
export async function initAlbumView() {
  const params = new URLSearchParams(window.location.search);
  const albumId = params.get('id');

  if (!albumId) {
    window.location.href = '/404.html';
    return;
  }

  try {
    const albumSnap = await getDoc(doc(db, 'albums', albumId));

    if (!albumSnap.exists() || albumSnap.data().deleted === true) {
      window.location.href = '/404.html';
      return;
    }

    _albumData = { id: albumSnap.id, ...albumSnap.data() };

    if (_albumData.privacy === 'private') {
      renderPrivateScreen();
      return;
    }

    // Inject OG meta
    injectOGMeta(_albumData);

    // Fetch images belonging to this album
    const q = query(
      collection(db, 'uploads'),
      where('albumId', '==', albumId),
      where('deleted', '==', false),
      orderBy('createdAt', 'asc')
    );
    const snap = await getDocs(q);
    _images = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderAlbumPage();
    setupEventListeners(albumId);

  } catch (err) {
    console.error('[album-view] Error:', err);
    showToast('Failed to load album. Please try again.', 'error');
  }
}

// ── OG Meta Injection ─────────────────────────────────────────────────────────
function injectOGMeta(album) {
  const setMeta = (prop, content) => {
    let el = document.querySelector(`meta[property="${prop}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('property', prop);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };

  const albumUrl = window.location.href;
  const title = album.name || 'Album — Imgify';
  const desc = album.description || `View this album on Imgify — ${_images.length} images`;
  const image = album.coverImageUrl || 'https://imgify.site/assets/og-default.png';

  document.title = `${title} — Imgify`;
  setMeta('og:title', title);
  setMeta('og:description', desc);
  setMeta('og:image', image);
  setMeta('og:url', albumUrl);
  setMeta('og:type', 'website');
}

// ── Private Screen ────────────────────────────────────────────────────────────
function renderPrivateScreen() {
  const container = document.getElementById('album-view-root');
  if (!container) return;
  container.innerHTML = `
    <div class="av-private-screen">
      <div class="av-private-icon">🔒</div>
      <h2 class="av-private-title">This album is private</h2>
      <p class="av-private-sub">The owner has restricted access to this album.</p>
      <a href="/" class="btn btn-primary av-back-btn">Back to Imgify</a>
    </div>
  `;
}

// ── Main Render ───────────────────────────────────────────────────────────────
function renderAlbumPage() {
  const container = document.getElementById('album-view-root');
  if (!container) return;

  const albumUrl = `${window.location.origin}/album.html?id=${_albumData.id}`;
  const hasCover = !!_albumData.coverImageUrl;
  const imgCount = _images.length;
  const desc = _albumData.description || '';

  const coverHtml = hasCover
    ? `<div class="av-cover" style="background-image: url('${_esc(_albumData.coverImageUrl)}')"></div>`
    : `<div class="av-cover av-cover-gradient"></div>`;

  container.innerHTML = `
    ${coverHtml}

    <div class="av-header">
      <div class="av-meta">
        <h1 class="av-title">${_esc(_albumData.name)}</h1>
        ${desc ? `<p class="av-desc">${_esc(desc)}</p>` : ''}
        <p class="av-count">${imgCount} image${imgCount !== 1 ? 's' : ''}</p>
      </div>

      <div class="av-actions">
        <button class="btn btn-secondary av-action-btn" id="av-share-btn" aria-label="Copy album link">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
          Share
        </button>
        <button class="btn btn-secondary av-action-btn" id="av-qr-btn" aria-label="Show QR code">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/></svg>
          QR Code
        </button>
        ${imgCount > 0 ? `
        <button class="btn btn-primary av-action-btn" id="av-zip-btn" aria-label="Download all as ZIP">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download All as ZIP
        </button>` : ''}
      </div>
    </div>

    <!-- QR Modal -->
    <div class="av-qr-modal" id="av-qr-modal" hidden aria-modal="true" role="dialog" aria-label="Album QR Code">
      <div class="av-qr-card">
        <h3 class="av-qr-card-title">Album QR Code</h3>
        <div id="av-qr-container" class="av-qr-container"></div>
        <div class="av-qr-actions">
          <button class="btn btn-primary" id="av-qr-download-btn">Download PNG</button>
          <button class="btn btn-secondary" id="av-qr-close-btn">Close</button>
        </div>
      </div>
    </div>

    <!-- Image Grid -->
    <div class="av-grid-wrap">
      ${imgCount === 0
        ? `<div class="av-empty-state">
            <div class="av-empty-icon">🖼️</div>
            <p>No images in this album yet.</p>
           </div>`
        : `<div class="av-image-grid" id="av-image-grid"></div>
           <div class="av-pagination" id="av-pagination"></div>`
      }
    </div>
  `;

  if (imgCount > 0) {
    renderPage(_currentPage);
  }

  // Store albumUrl for event listeners
  container.dataset.albumUrl = albumUrl;
}

// ── Grid + Pagination ─────────────────────────────────────────────────────────
function renderPage(page) {
  _currentPage = page;
  const grid = document.getElementById('av-image-grid');
  const paginationEl = document.getElementById('av-pagination');
  if (!grid) return;

  const start = (page - 1) * PAGE_SIZE;
  const slice = _images.slice(start, start + PAGE_SIZE);
  const totalPages = Math.ceil(_images.length / PAGE_SIZE);

  grid.innerHTML = slice.map(img => {
    const thumb = img.imgbbThumbUrl || img.imgbbUrl || '';
    const name = _esc(img.customName || img.originalName || 'Untitled');
    const imagePageUrl = `/image.html?id=${img.id}`;
    return `
      <a href="${_esc(imagePageUrl)}" class="av-image-card" title="${name}">
        <div class="av-image-thumb-wrap">
          <img src="${_esc(thumb)}" alt="${name}" class="av-image-thumb" loading="lazy" />
        </div>
        <div class="av-image-card-footer">
          <span class="av-image-card-name">${name}</span>
        </div>
      </a>
    `;
  }).join('');

  // Pagination
  if (paginationEl) {
    if (totalPages <= 1) {
      paginationEl.innerHTML = '';
      return;
    }

    let pages = '';
    for (let i = 1; i <= totalPages; i++) {
      pages += `<button class="av-page-btn${i === page ? ' active' : ''}" data-page="${i}" aria-label="Page ${i}">${i}</button>`;
    }
    paginationEl.innerHTML = `
      <button class="av-page-btn av-page-prev" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>
      ${pages}
      <button class="av-page-btn av-page-next" data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''} aria-label="Next page">›</button>
    `;

    paginationEl.querySelectorAll('.av-page-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page, 10);
        if (!isNaN(p) && p >= 1 && p <= totalPages) {
          renderPage(p);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }
}

// ── Event Listeners ───────────────────────────────────────────────────────────
function setupEventListeners(albumId) {
  const container = document.getElementById('album-view-root');
  const albumUrl = container?.dataset.albumUrl || window.location.href;

  // Share / Copy URL
  document.getElementById('av-share-btn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(albumUrl);
      showToast('Album link copied!', 'success');
    } catch {
      showToast('Could not copy link.', 'error');
    }
  });

  // QR Code Modal
  const qrBtn = document.getElementById('av-qr-btn');
  const qrModal = document.getElementById('av-qr-modal');
  const qrCloseBtn = document.getElementById('av-qr-close-btn');
  const qrDownloadBtn = document.getElementById('av-qr-download-btn');

  qrBtn?.addEventListener('click', async () => {
    qrModal.hidden = false;
    try {
      await generateQRCode('av-qr-container', albumUrl, { size: 200 });
    } catch (err) {
      console.error('[album-view] QR generation failed:', err);
      showToast('QR code generation failed.', 'error');
    }
  });

  qrCloseBtn?.addEventListener('click', () => {
    qrModal.hidden = true;
  });

  qrModal?.addEventListener('click', (e) => {
    if (e.target === qrModal) qrModal.hidden = true;
  });

  qrDownloadBtn?.addEventListener('click', () => {
    const safeName = (_albumData?.name || 'album').replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
    try {
      downloadQRCode('av-qr-container', `imgify-album-${safeName}`);
    } catch (err) {
      console.error('[album-view] QR download failed:', err);
      showToast('QR download failed.', 'error');
    }
  });

  // Download All as ZIP
  document.getElementById('av-zip-btn')?.addEventListener('click', () => {
    downloadAlbumAsZip();
  });
}

// ── ZIP Download ──────────────────────────────────────────────────────────────
async function downloadAlbumAsZip() {
  if (_images.length === 0) {
    showToast('No images to download.', 'info');
    return;
  }

  const zipBtn = document.getElementById('av-zip-btn');
  if (zipBtn) {
    zipBtn.disabled = true;
    zipBtn.textContent = 'Preparing ZIP…';
  }

  try {
    // Lazy-load JSZip
    if (!window.JSZip) {
      showToast('Loading ZIP library…', 'info');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    }

    const zip = new window.JSZip();
    const total = _images.length;
    let done = 0;

    showToast(`Fetching images (0 / ${total})…`, 'info');

    for (const img of _images) {
      const url = img.imgbbUrl;
      if (!url) { done++; continue; }

      try {
        const blob = await fetch(url).then(r => r.blob());
        const ext = (img.ext || guessExtFromUrl(url) || 'jpg').replace(/^\./, '');
        const safeName = (img.customName || img.originalName || img.id)
          .replace(/[^a-z0-9-_. ]/gi, '_');
        zip.file(`${safeName}.${ext}`, blob);
      } catch (fetchErr) {
        console.warn(`[album-view] Failed to fetch image ${img.id}:`, fetchErr);
      }

      done++;
      showToast(`Fetching images (${done} / ${total})…`, 'info');
    }

    showToast('Generating ZIP file…', 'info');
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    const safeName = (_albumData?.name || 'album').replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
    const filename = `imgify-album-${safeName}.zip`;
    triggerDownload(zipBlob, filename);
    showToast('ZIP downloaded!', 'success');

  } catch (err) {
    console.error('[album-view] ZIP download failed:', err);
    showToast('ZIP download failed. Please try again.', 'error');
  } finally {
    if (zipBtn) {
      zipBtn.disabled = false;
      zipBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download All as ZIP
      `;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function guessExtFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : 'jpg';
  } catch {
    return 'jpg';
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
