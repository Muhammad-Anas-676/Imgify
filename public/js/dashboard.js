/**
 * dashboard.js — Imgify Session Dashboard
 * File 15/43 | ES Module | Firebase 10.12.0
 *
 * Exports: initDashboard(sessionId)
 *
 * Expected DOM IDs in dashboard.html:
 *   #dash-loading          — spinner/overlay shown during fetch
 *   #dash-total-uploads    — stat: image count
 *   #dash-storage-used     — stat: total storage
 *   #dash-filter-type      — <select> file type filter
 *   #dash-filter-date      — <select> date range filter
 *   #dash-filter-album     — <select> album filter (populated dynamically)
 *   #dash-sort             — <select> sort order
 *   #dash-gallery-grid     — image card grid container
 *   #dash-empty-state      — shown when no images match
 *   #dash-pagination       — pagination controls container
 *   #dash-copy-all         — button: copy all URLs
 *   #dash-download-zip     — button: download all as ZIP
 *   #dash-albums-section   — albums section wrapper (hidden if no albums)
 *   #dash-albums-grid      — album card grid container
 */

import { db } from './firebase-init.js';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getSessionAlbums }            from './albums.js';
import { generateQRCode, downloadQRCode } from './qrcode-helper.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const PAGE_SIZE  = 12;
const JSZIP_CDN  = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const SITE_URL   = 'https://imgify.site';

// ─── Module State ─────────────────────────────────────────────────────────────
let _sessionId     = '';
let _allImages     = [];      // full unfiltered set from Firestore
let _filteredImages = [];     // after filter+sort applied
let _currentPage   = 1;
let _sessionAlbums = [];      // cached albums for this session

// ─── Entry Point ──────────────────────────────────────────────────────────────
/**
 * initDashboard — call this from dashboard.html after reading localStorage sessionId.
 * @param {string} sessionId
 */
export async function initDashboard(sessionId) {
  _sessionId = sessionId;
  _showLoading(true);

  // Register global bridge functions once (used by onclick in rendered HTML)
  _registerGlobalBridge();

  // Single persistent outside-click handler to close 3-dot menus
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.img-card-actions')) {
      _closeAllMenus();
    }
  });

  try {
    // Fetch images + albums in parallel for speed
    [_allImages, _sessionAlbums] = await Promise.all([
      _fetchImages(sessionId),
      getSessionAlbums(sessionId).catch(() => [])
    ]);

    _renderStats(_allImages);
    _setupFilterListeners();
    _populateAlbumFilter(_sessionAlbums);
    _setupBulkActions();
    _applyFilters();
    _renderAlbumsSection(_sessionAlbums);
  } catch (err) {
    console.error('[Dashboard] init error:', err);
    _showError('Failed to load your images. Please refresh and try again.');
  } finally {
    _showLoading(false);
  }
}

// ─── Firestore Fetch ──────────────────────────────────────────────────────────
async function _fetchImages(sessionId) {
  const q = query(
    collection(db, 'uploads'),
    where('sessionId', '==', sessionId),
    where('deleted', '==', false)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
}

// ─── Stats Row ────────────────────────────────────────────────────────────────
function _renderStats(images) {
  const totalBytes = images.reduce((acc, img) => acc + (img.fileSize || 0), 0);
  _setText('dash-total-uploads', images.length);
  _setText('dash-storage-used', _formatBytes(totalBytes));
}

// ─── Filter + Sort (all client-side, no extra Firestore query) ────────────────
function _setupFilterListeners() {
  ['dash-filter-type', 'dash-filter-date', 'dash-filter-album', 'dash-sort'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _applyFilters);
  });
}

function _populateAlbumFilter(albums) {
  const el = document.getElementById('dash-filter-album');
  if (!el || !albums.length) return;

  const noneOpt = document.createElement('option');
  noneOpt.value = 'none';
  noneOpt.textContent = 'No Album';
  el.appendChild(noneOpt);

  albums.forEach(album => {
    const opt = document.createElement('option');
    opt.value  = album.albumId;
    opt.textContent = _truncate(album.name, 30);
    el.appendChild(opt);
  });
}

function _getFilterValues() {
  return {
    type  : document.getElementById('dash-filter-type')?.value  || 'all',
    date  : document.getElementById('dash-filter-date')?.value  || 'all',
    album : document.getElementById('dash-filter-album')?.value || 'all',
    sort  : document.getElementById('dash-sort')?.value         || 'newest'
  };
}

function _applyFilters() {
  const { type, date, album, sort } = _getFilterValues();
  const now = Date.now();

  _filteredImages = _allImages.filter(img => {
    // ── File type ──────────────────────────────────────────────
    if (type !== 'all') {
      const mime = (img.mimeType || '').toLowerCase();
      if (type === 'jpeg' && !/jpe?g/.test(mime))        return false;
      if (type === 'png'  && !mime.includes('png'))       return false;
      if (type === 'gif'  && !mime.includes('gif'))       return false;
      if (type === 'webp' && !mime.includes('webp'))      return false;
      if (type === 'svg'  && !mime.includes('svg'))       return false;
    }

    // ── Date range ─────────────────────────────────────────────
    if (date !== 'all') {
      const ts   = img.createdAt?.toDate?.()?.getTime?.() || 0;
      const diff = now - ts;
      if (date === 'today' && diff > 86_400_000)      return false;
      if (date === 'week'  && diff > 604_800_000)     return false;
      if (date === 'month' && diff > 2_592_000_000)   return false;
    }

    // ── Album ──────────────────────────────────────────────────
    if (album !== 'all') {
      if (album === 'none' && img.albumId)             return false;
      if (album !== 'none' && img.albumId !== album)   return false;
    }

    return true;
  });

  // ── Sort ───────────────────────────────────────────────────────
  _filteredImages.sort((a, b) => {
    const aT = a.createdAt?.toDate?.()?.getTime?.() || 0;
    const bT = b.createdAt?.toDate?.()?.getTime?.() || 0;
    if (sort === 'newest')   return bT - aT;
    if (sort === 'oldest')   return aT - bT;
    if (sort === 'largest')  return (b.fileSize || 0) - (a.fileSize || 0);
    if (sort === 'smallest') return (a.fileSize || 0) - (b.fileSize || 0);
    return 0;
  });

  _currentPage = 1;
  _renderGallery();
  _renderPagination();
}

// ─── Gallery Grid ─────────────────────────────────────────────────────────────
function _renderGallery() {
  const grid       = document.getElementById('dash-gallery-grid');
  const emptyState = document.getElementById('dash-empty-state');
  if (!grid) return;

  if (_filteredImages.length === 0) {
    grid.innerHTML = '';
    if (emptyState) emptyState.hidden = false;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  const start      = (_currentPage - 1) * PAGE_SIZE;
  const pageImages = _filteredImages.slice(start, start + PAGE_SIZE);

  grid.innerHTML = pageImages.map(_createImageCard).join('');

  // Attach menu toggle buttons after DOM insertion
  grid.querySelectorAll('.img-card-menu-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _toggleMenu(btn.dataset.menuId);
    });
  });
}

function _createImageCard(img) {
  const id     = img.imageId || img._docId;
  const thumb  = _esc(img.imgbbThumbUrl || img.imgbbUrl || '/assets/img/placeholder.svg');
  const name   = _esc(img.customName || img.filename || 'Untitled');
  const date   = _formatDate(img.createdAt);
  const size   = _formatBytes(img.fileSize || 0);
  const url    = _esc(img.slugUrl || img.siteUrl || `${SITE_URL}/image.html?id=${id}`);
  const idEsc  = _esc(id);
  const nameEsc = _esc(img.customName || id);

  const privacyBadge = img.privacy && img.privacy !== 'public'
    ? `<span class="badge badge-privacy badge-${_esc(img.privacy)}">${_esc(img.privacy)}</span>` : '';
  const pwBadge = img.isPasswordProtected
    ? `<span class="badge badge-pw" title="Password protected">🔒</span>` : '';

  return `
<article class="img-card" data-id="${idEsc}" aria-label="${name}">
  <div class="img-card-thumb">
    <img
      src="${thumb}"
      alt="${name}"
      loading="lazy"
      onerror="this.src='/assets/img/placeholder.svg'"
    >
    <div class="img-card-badges">${privacyBadge}${pwBadge}</div>
    <div class="img-card-overlay">
      <button
        class="icon-btn qr-btn"
        title="Download QR Code"
        aria-label="Download QR code for ${name}"
        onclick="window.__dashDownloadQR('${idEsc}', '${url}', '${nameEsc}')"
      >${_iconQR()}</button>
    </div>
  </div>
  <div class="img-card-body">
    <div class="img-card-name" title="${name}">${name}</div>
    <div class="img-card-meta">
      <span>${date}</span>
      <span class="meta-dot">·</span>
      <span>${size}</span>
    </div>
  </div>
  <div class="img-card-actions">
    <button
      class="img-card-menu-btn"
      data-menu-id="menu-${idEsc}"
      title="More options"
      aria-label="More options for ${name}"
      aria-haspopup="true"
    >${_iconDots()}</button>
    <div class="img-card-menu" id="menu-${idEsc}" hidden role="menu">
      <button role="menuitem" onclick="window.__dashCopyUrl('${url}')">
        <span class="menu-icon">📋</span> Copy URL
      </button>
      <button role="menuitem" onclick="window.open('${url}', '_blank', 'noopener')">
        <span class="menu-icon">🔗</span> Open
      </button>
      <button role="menuitem" onclick="window.__dashDownloadQR('${idEsc}', '${url}', '${nameEsc}')">
        <span class="menu-icon">📥</span> Download QR
      </button>
      <button role="menuitem" class="menu-danger" onclick="window.__dashSoftDelete('${idEsc}')">
        <span class="menu-icon">🗑</span> Delete
      </button>
    </div>
  </div>
</article>`;
}

// ─── 3-Dot Menu ───────────────────────────────────────────────────────────────
function _toggleMenu(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const wasHidden = menu.hidden;
  _closeAllMenus();
  menu.hidden = !wasHidden;
}

function _closeAllMenus() {
  document.querySelectorAll('.img-card-menu').forEach(m => { m.hidden = true; });
}

// ─── Pagination ───────────────────────────────────────────────────────────────
function _renderPagination() {
  const el = document.getElementById('dash-pagination');
  if (!el) return;

  const total = Math.ceil(_filteredImages.length / PAGE_SIZE);
  if (total <= 1) { el.innerHTML = ''; return; }

  const prevDis = _currentPage === 1     ? 'disabled' : '';
  const nextDis = _currentPage === total ? 'disabled' : '';

  const pages = _paginationRange(_currentPage, total);
  const pageButtons = pages.map(p =>
    p === '…'
      ? `<span class="page-ellipsis" aria-hidden="true">…</span>`
      : `<button
           class="page-btn${p === _currentPage ? ' active' : ''}"
           onclick="window.__dashGoPage(${p})"
           aria-label="Page ${p}"
           ${p === _currentPage ? 'aria-current="page"' : ''}
         >${p}</button>`
  ).join('');

  el.innerHTML = `
<div class="pagination-inner" role="navigation" aria-label="Gallery pages">
  <button class="page-btn page-prev" onclick="window.__dashGoPage(${_currentPage - 1})"
    ${prevDis} aria-label="Previous page">${_iconChevronLeft()}</button>
  ${pageButtons}
  <button class="page-btn page-next" onclick="window.__dashGoPage(${_currentPage + 1})"
    ${nextDis} aria-label="Next page">${_iconChevronRight()}</button>
  <span class="page-info" aria-live="polite">Page ${_currentPage} of ${total}</span>
</div>`;
}

function _paginationRange(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (cur <= 4)         return [1, 2, 3, 4, 5, '…', total];
  if (cur >= total - 3) return [1, '…', total-4, total-3, total-2, total-1, total];
  return [1, '…', cur - 1, cur, cur + 1, '…', total];
}

// ─── Soft Delete ──────────────────────────────────────────────────────────────
async function _softDelete(imageId) {
  if (!confirm('Delete this image from your dashboard?')) return;
  try {
    await updateDoc(doc(db, 'uploads', imageId), {
      deleted:   true,
      updatedAt: serverTimestamp()
    });

    // Remove from local state immediately — no need to re-fetch
    _allImages = _allImages.filter(img => (img.imageId || img._docId) !== imageId);
    _renderStats(_allImages);
    _applyFilters();
    _showToast('Image deleted.', 'success');
  } catch (err) {
    console.error('[Dashboard] soft-delete error:', err);
    _showToast('Could not delete image. Please try again.', 'error');
  }
}

// ─── QR Download ──────────────────────────────────────────────────────────────
async function _handleDownloadQR(imageId, url, name) {
  const tempId = `qr-temp-${imageId}`;

  let container = document.getElementById(tempId);
  if (!container) {
    container = Object.assign(document.createElement('div'), { id: tempId });
    Object.assign(container.style, {
      position: 'fixed', top: '-9999px', left: '-9999px',
      width: '200px', height: '200px', overflow: 'hidden'
    });
    document.body.appendChild(container);
  }

  try {
    await generateQRCode(tempId, url, { size: 200 });
    // Allow qrcode.js canvas one tick to render before pulling dataURL
    await new Promise(r => setTimeout(r, 350));
    downloadQRCode(tempId, name || imageId);
    _showToast('QR code downloaded!', 'success');
  } catch (err) {
    console.error('[Dashboard] QR download error:', err);
    _showToast('Could not generate QR code.', 'error');
  } finally {
    container.remove();
  }
}

// ─── Bulk Actions ─────────────────────────────────────────────────────────────
function _setupBulkActions() {
  document.getElementById('dash-copy-all')?.addEventListener('click', _copyAllUrls);
  document.getElementById('dash-download-zip')?.addEventListener('click', _downloadAllZip);
}

function _copyAllUrls() {
  if (!_allImages.length) {
    _showToast('No images to copy.', 'error');
    return;
  }
  const urls = _allImages
    .map(img => img.slugUrl || img.siteUrl || `${SITE_URL}/image.html?id=${img.imageId || img._docId}`)
    .join('\n');

  navigator.clipboard.writeText(urls)
    .then(() => _showToast(`${_allImages.length} URLs copied!`, 'success'))
    .catch(() => _showToast('Copy failed — please try manually.', 'error'));
}

async function _downloadAllZip() {
  if (!_allImages.length) {
    _showToast('No images to download.', 'error');
    return;
  }

  const btn = document.getElementById('dash-download-zip');
  const original = btn?.textContent ?? '';
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }

  try {
    await _loadScript(JSZIP_CDN);
    const zip = new window.JSZip();
    let done = 0;

    for (const img of _allImages) {
      try {
        const blob = await fetch(img.imgbbUrl).then(r => {
          if (!r.ok) throw new Error(r.statusText);
          return r.blob();
        });
        const ext  = (img.mimeType || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
        const name = (img.customName || img.imageId || img._docId) + '.' + ext;
        zip.file(name, blob);
      } catch {
        // Skip inaccessible files silently
      }
      done++;
      if (btn) btn.textContent = `Packing ${done}/${_allImages.length}…`;
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(zipBlob),
      download: 'imgify-my-uploads.zip'
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    _showToast('ZIP downloaded!', 'success');
  } catch (err) {
    console.error('[Dashboard] ZIP error:', err);
    _showToast('ZIP download failed. Please try again.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

// ─── Albums Section ───────────────────────────────────────────────────────────
function _renderAlbumsSection(albums) {
  const section = document.getElementById('dash-albums-section');
  const grid    = document.getElementById('dash-albums-grid');
  if (!section || !grid) return;

  if (!albums?.length) {
    section.hidden = true;
    return;
  }

  section.hidden  = false;
  grid.innerHTML  = albums.map(_createAlbumCard).join('');
}

function _createAlbumCard(album) {
  const name    = _esc(album.name || 'Untitled Album');
  const desc    = _esc(album.description || '');
  const cover   = _esc(album.coverImageUrl || '/assets/img/placeholder.svg');
  const count   = album.imageCount || 0;
  const privacy = _esc(album.privacy || 'public');
  const href    = `/album.html?id=${_esc(album.albumId)}`;

  return `
<a href="${href}" class="album-card" aria-label="${name} — ${count} images">
  <div class="album-card-cover">
    <img src="${cover}" alt="${name} cover" loading="lazy" onerror="this.src='/assets/img/placeholder.svg'">
    <span class="album-image-count">${count} ${count === 1 ? 'image' : 'images'}</span>
    <span class="badge badge-privacy badge-${privacy}">${privacy}</span>
  </div>
  <div class="album-card-body">
    <div class="album-card-name">${name}</div>
    ${desc ? `<div class="album-card-desc">${desc}</div>` : ''}
  </div>
</a>`;
}

// ─── Global Bridge (onclick handlers in rendered HTML need window scope) ──────
function _registerGlobalBridge() {
  window.__dashCopyUrl     = (url) => {
    navigator.clipboard.writeText(url)
      .then(() => _showToast('URL copied!', 'success'))
      .catch(() => _showToast('Copy failed.', 'error'));
  };

  window.__dashSoftDelete  = (id) => _softDelete(id);

  window.__dashDownloadQR  = (id, url, name) => _handleDownloadQR(id, url, name);

  window.__dashGoPage      = (page) => {
    const total = Math.ceil(_filteredImages.length / PAGE_SIZE);
    if (page < 1 || page > total) return;
    _currentPage = page;
    _renderGallery();
    _renderPagination();
    document.getElementById('dash-gallery-grid')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function _showLoading(show) {
  const el = document.getElementById('dash-loading');
  if (el) el.hidden = !show;
}

function _showError(message) {
  const emptyState = document.getElementById('dash-empty-state');
  if (emptyState) {
    emptyState.hidden   = false;
    emptyState.innerHTML = `<p class="dash-error-msg">${_esc(message)}</p>`;
  }
  const grid = document.getElementById('dash-gallery-grid');
  if (grid) grid.innerHTML = '';
}

function _showToast(message, type = 'info') {
  document.querySelector('.imgify-toast')?.remove();

  const toast = Object.assign(document.createElement('div'), {
    className:   `imgify-toast imgify-toast-${type}`,
    textContent: message
  });
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('imgify-toast-visible'));
  setTimeout(() => {
    toast.classList.remove('imgify-toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function _setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ─── Format Utilities ─────────────────────────────────────────────────────────
function _formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${i === 0 ? val : val.toFixed(1)} ${units[i]}`;
}

function _formatDate(timestamp) {
  if (!timestamp) return '—';
  const d = timestamp.toDate?.() ?? new Date(timestamp);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function _truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

/** Escape HTML to prevent XSS in dynamically injected attributes/text */
function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Script Loader ────────────────────────────────────────────────────────────
function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src     = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error(`Script load failed: ${src}`));
    document.head.appendChild(s);
  });
}

// ─── Inline SVG Icons (no CDN dependency required here) ──────────────────────
function _iconQR() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
    <rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none"/>
    <rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none"/>
    <rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none"/>
    <path d="M14 14h3v3h-3zM17 17h3v3h-3zM14 17h3M17 14v3"/>
  </svg>`;
}

function _iconDots() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">
    <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
  </svg>`;
}

function _iconChevronLeft() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>`;
}

function _iconChevronRight() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
}
