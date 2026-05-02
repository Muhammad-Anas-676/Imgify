/**
 * admin-images.js — File 21/43
 * Imgify Admin: Full Image Management CRUD
 * Cursor-based pagination · Grid/List view · Bulk ops · Detail modal
 */

import { initAdminAuth, handleAdminLogout } from './admin-auth.js';
import { db } from '../firebase-init.js';
import {
  collection, query, where, orderBy, limit,
  startAfter, startAt, getDocs, getDoc,
  updateDoc, deleteDoc, doc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Shared Helpers (self-contained) ──────────────────────────────────────────

const _esc = s =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
                 .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const _formatDate = ts => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-PK', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};

const _formatBytes = b => {
  if (!b && b !== 0) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1_048_576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1_048_576).toFixed(2) + ' MB';
};

const _showToast = (msg, type = 'info') => {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
};

const _debounce = (fn, ms) => {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
};

// ── Module State ──────────────────────────────────────────────────────────────

const PAGE_SIZE   = 20;
let currentView   = 'grid';          // 'grid' | 'list'
let pageHistory   = [];              // stack of firstDoc cursors for prev navigation
let currentFirst  = null;            // first DocumentSnapshot of current page
let currentLast   = null;            // last  DocumentSnapshot of current page
let allDocsOnPage = [];              // raw data objects for current page
let selectedIds   = new Set();       // set of selected image IDs

// ── Query Builder ─────────────────────────────────────────────────────────────

/**
 * Builds a Firestore query from current UI state.
 * NOTE: Some sort combinations (e.g. deleted+views, deleted+customName) require
 * Firestore composite indexes. Create them in the Firebase console if queries fail.
 *
 * @param {DocumentSnapshot|null} cursor - cursor doc for pagination
 * @param {'next'|'prev'} direction
 */
function _buildQuery(cursor, direction) {
  const sortVal = document.getElementById('sort-select')?.value || 'newest';
  const showDel = document.getElementById('show-deleted-toggle')?.checked ?? false;

  const sortMap = {
    newest: ['createdAt',  'desc'],
    oldest: ['createdAt',  'asc'],
    views:  ['views',      'desc'],
    nameaz: ['customName', 'asc'],
  };
  const [field, dir] = sortMap[sortVal] ?? sortMap.newest;

  const colRef = collection(db, 'uploads');
  const constraints = [];

  if (!showDel) constraints.push(where('deleted', '==', false));
  constraints.push(orderBy(field, dir));
  if (cursor) constraints.push(direction === 'next' ? startAfter(cursor) : startAt(cursor));
  constraints.push(limit(PAGE_SIZE));

  return query(colRef, ...constraints);
}

// ── Page Fetch ────────────────────────────────────────────────────────────────

async function _fetchPage(cursor = null, direction = 'next') {
  const container = document.getElementById('images-container');
  container.innerHTML = `<div class="admin-loading" role="status">
    <span class="spinner" aria-hidden="true"></span> Loading images…
  </div>`;
  _clearSelection();

  try {
    const snap = await getDocs(_buildQuery(cursor, direction));
    allDocsOnPage = snap.docs.map(d => ({ id: d.id, ...d.data(), _snap: d }));
    currentFirst  = snap.docs[0]                      ?? null;
    currentLast   = snap.docs[snap.docs.length - 1]   ?? null;
    _applyClientFilters();
    _renderPaginationControls(snap.docs.length);
  } catch (err) {
    console.error('[admin-images] fetch error:', err);
    container.innerHTML = `<div class="admin-error" role="alert">
      <span class="error-icon">⚠</span>
      <div>
        <strong>Failed to load images</strong>
        <p>${_esc(err.message)}</p>
        <button class="btn-secondary" onclick="location.reload()">Retry</button>
      </div>
    </div>`;
  }
}

// ── Client-Side Filtering ─────────────────────────────────────────────────────

function _applyClientFilters() {
  const search  = (document.getElementById('search-input')?.value  ?? '').trim().toLowerCase();
  const type    = document.getElementById('filter-type')?.value    ?? 'all';
  const privacy = document.getElementById('filter-privacy')?.value ?? 'all';
  const pw      = document.getElementById('filter-pw')?.value      ?? 'all';

  const mimeMap = {
    jpeg: ['image/jpeg', 'image/jpg'],
    png:  ['image/png'],
    gif:  ['image/gif'],
    webp: ['image/webp'],
  };

  const filtered = allDocsOnPage.filter(img => {
    // search: name, filename, slug, or ID
    if (search) {
      const haystack = [
        img.customName || '',
        img.filename   || '',
        img.customSlug || '',
        img.id,
        img.sessionId  || '',
      ].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    // type filter
    if (type !== 'all' && !mimeMap[type]?.includes(img.mimeType)) return false;

    // privacy filter
    if (privacy !== 'all' && img.privacy !== privacy) return false;

    // password filter
    if (pw === 'protected'   && !img.isPasswordProtected) return false;
    if (pw === 'unprotected' &&  img.isPasswordProtected) return false;

    return true;
  });

  _renderImages(filtered);
}

// ── Render Router ─────────────────────────────────────────────────────────────

function _renderImages(docs) {
  const container = document.getElementById('images-container');

  if (!docs.length) {
    container.className = 'images-container';
    container.innerHTML = `<div class="admin-empty" role="status">
      <div class="empty-icon" aria-hidden="true">🖼</div>
      <h3>No images found</h3>
      <p>Try adjusting your filters or search query.</p>
    </div>`;
    document.getElementById('selected-count').textContent = '0 selected';
    return;
  }

  currentView === 'grid' ? _renderGrid(docs, container) : _renderList(docs, container);
}

// ── Grid View ─────────────────────────────────────────────────────────────────

const _privacyClass = p =>
  ({ public: 'success', unlisted: 'warning', private: 'danger' })[p] || 'info';

const _FALLBACK_THUMB = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' fill='%23e5e7eb'/%3E%3Ctext x='40' y='46' text-anchor='middle' font-size='11' fill='%239ca3af'%3ENo thumb%3C/text%3E%3C/svg%3E`;

function _cardActions(img) {
  const view = `<button class="btn-icon" title="View public page" aria-label="View image"
    onclick="window._imgView('${_esc(img.id)}','${_esc(img.customSlug || '')}')">👁</button>`;
  const copy = `<button class="btn-icon" title="Copy URL" aria-label="Copy image URL"
    onclick="window._imgCopyUrl('${_esc(img.imgbbUrl || '')}')">📋</button>`;
  const detail = `<button class="btn-icon" title="Image details" aria-label="Open image details"
    onclick="window._imgDetail('${_esc(img.id)}')">ℹ️</button>`;

  if (img.deleted) {
    return view + copy + detail +
      `<button class="btn-icon btn-success" title="Restore image" aria-label="Restore image"
        onclick="window._imgRestore('${_esc(img.id)}')">♻️</button>
       <button class="btn-icon btn-danger" title="Permanently delete" aria-label="Permanently delete image"
        onclick="window._imgHardDelete('${_esc(img.id)}')">💥</button>`;
  }

  return view + copy + detail +
    `<button class="btn-icon btn-danger" title="Soft delete" aria-label="Soft delete image"
      onclick="window._imgSoftDelete('${_esc(img.id)}')">🗑</button>`;
}

function _renderGrid(docs, container) {
  container.className = 'images-container grid-view';
  container.innerHTML = docs.map(img => `
    <article class="img-card${img.deleted ? ' img-card--deleted' : ''}" data-id="${_esc(img.id)}">

      <label class="img-card__check" aria-label="Select image">
        <input type="checkbox" class="img-checkbox" data-id="${_esc(img.id)}">
      </label>

      <div class="img-card__thumb" role="button" tabindex="0"
           aria-label="Open details for ${_esc(img.customName || img.filename || 'image')}"
           onclick="window._imgDetail('${_esc(img.id)}')"
           onkeydown="if(event.key==='Enter')window._imgDetail('${_esc(img.id)}')">
        <img src="${_esc(img.imgbbThumbUrl || img.imgbbUrl || _FALLBACK_THUMB)}"
             alt="${_esc(img.customName || img.filename || 'Image thumbnail')}"
             loading="lazy"
             onerror="this.src='${_FALLBACK_THUMB}'">
      </div>

      <div class="img-card__body">
        <div class="img-card__name" title="${_esc(img.customName || img.filename || 'Untitled')}">
          ${_esc((img.customName || img.filename || 'Untitled').slice(0, 38))}
        </div>
        <div class="img-card__meta">
          <span>${_esc(_formatBytes(img.fileSize))}</span>
          <span>${_esc(img.mimeType?.split('/')[1]?.toUpperCase() || '?')}</span>
          <span>${img.views ?? 0} views</span>
        </div>
        <div class="img-card__date">${_esc(_formatDate(img.createdAt))}</div>
        <div class="img-card__badges">
          <span class="badge badge-${_privacyClass(img.privacy)}">${_esc(img.privacy || 'public')}</span>
          ${img.isPasswordProtected ? '<span class="badge badge-warning" title="Password Protected">🔒 PW</span>' : ''}
          ${img.customSlug          ? `<span class="badge badge-purple"  title="Slug: ${_esc(img.customSlug)}">🔗</span>` : ''}
          ${img.deleted             ? '<span class="badge badge-danger">Deleted</span>' : ''}
        </div>
      </div>

      <div class="img-card__actions">
        ${_cardActions(img)}
      </div>

    </article>
  `).join('');

  _bindCheckboxes();
}

// ── List View ─────────────────────────────────────────────────────────────────

function _renderList(docs, container) {
  container.className = 'images-container list-view';
  container.innerHTML = `
    <div class="table-wrap">
      <table class="admin-table" aria-label="Images table">
        <thead>
          <tr>
            <th style="width:36px">
              <input type="checkbox" id="select-all-inner"
                     aria-label="Select all visible images">
            </th>
            <th style="width:64px">Thumb</th>
            <th>Name / ID</th>
            <th>Type</th>
            <th>Size</th>
            <th>Views</th>
            <th>Privacy</th>
            <th>Uploaded</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${docs.map(img => `
            <tr class="${img.deleted ? 'row--deleted' : ''}" data-id="${_esc(img.id)}">
              <td>
                <input type="checkbox" class="img-checkbox" data-id="${_esc(img.id)}"
                       aria-label="Select ${_esc(img.customName || img.id)}">
              </td>
              <td>
                <img src="${_esc(img.imgbbThumbUrl || img.imgbbUrl || _FALLBACK_THUMB)}"
                     alt="" width="48" height="48"
                     class="list-thumb"
                     loading="lazy"
                     role="button" tabindex="0"
                     onclick="window._imgDetail('${_esc(img.id)}')"
                     onkeydown="if(event.key==='Enter')window._imgDetail('${_esc(img.id)}')"
                     onerror="this.src='${_FALLBACK_THUMB}'">
              </td>
              <td>
                <div class="list-name">
                  ${_esc((img.customName || img.filename || 'Untitled').slice(0, 50))}
                  ${img.deleted ? '<span class="badge badge-danger">Deleted</span>' : ''}
                </div>
                <div class="list-id">${_esc(img.id)}</div>
                ${img.customSlug ? `<div class="list-slug">/i/${_esc(img.customSlug)}</div>` : ''}
              </td>
              <td>${_esc(img.mimeType?.split('/')[1]?.toUpperCase() || '?')}</td>
              <td style="white-space:nowrap">${_esc(_formatBytes(img.fileSize))}</td>
              <td>${img.views ?? 0}</td>
              <td>
                <span class="badge badge-${_privacyClass(img.privacy)}">${_esc(img.privacy || 'public')}</span>
                ${img.isPasswordProtected ? '<span title="Password Protected" aria-label="Password Protected"> 🔒</span>' : ''}
              </td>
              <td class="list-date">${_esc(_formatDate(img.createdAt))}</td>
              <td>
                <div class="action-row">
                  ${_cardActions(img)}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Inner select-all (syncs with the top-level one too)
  container.querySelector('#select-all-inner')?.addEventListener('change', e => {
    container.querySelectorAll('.img-checkbox').forEach(cb => {
      cb.checked = e.target.checked;
      e.target.checked ? selectedIds.add(cb.dataset.id) : selectedIds.delete(cb.dataset.id);
    });
    _updateSelectionUI();
  });

  _bindCheckboxes();
}

// ── Checkbox Helpers ──────────────────────────────────────────────────────────

function _bindCheckboxes() {
  document.querySelectorAll('.img-checkbox').forEach(cb => {
    // restore checked state if re-render happens while items are selected
    if (selectedIds.has(cb.dataset.id)) cb.checked = true;

    cb.addEventListener('change', e => {
      e.target.checked ? selectedIds.add(e.target.dataset.id) : selectedIds.delete(e.target.dataset.id);
      _updateSelectionUI();

      // Sync top-level select-all
      const all  = document.querySelectorAll('.img-checkbox');
      const done = [...all].every(c => c.checked);
      const sa   = document.getElementById('select-all');
      if (sa) sa.checked = done;
    });
  });
}

function _updateSelectionUI() {
  const count = selectedIds.size;
  const countEl = document.getElementById('selected-count');
  const bulkBtn = document.getElementById('bulk-delete-btn');
  if (countEl) countEl.textContent = count ? `${count} selected` : '0 selected';
  if (bulkBtn) bulkBtn.disabled = count === 0;
}

function _clearSelection() {
  selectedIds.clear();
  _updateSelectionUI();
  const sa = document.getElementById('select-all');
  if (sa) sa.checked = false;
}

// ── Pagination Controls ───────────────────────────────────────────────────────

function _renderPaginationControls(docCount) {
  const ctrl = document.getElementById('pagination-controls');
  if (!ctrl) return;

  const canPrev = pageHistory.length > 0;
  const canNext = docCount === PAGE_SIZE;
  const pageNum = pageHistory.length + 1;

  ctrl.innerHTML = `
    <button class="btn-secondary" id="btn-prev" ${canPrev ? '' : 'disabled'} aria-label="Previous page">
      ← Prev
    </button>
    <span class="page-indicator" aria-live="polite">Page ${pageNum}</span>
    <button class="btn-secondary" id="btn-next" ${canNext ? '' : 'disabled'} aria-label="Next page">
      Next →
    </button>
  `;

  ctrl.querySelector('#btn-prev')?.addEventListener('click', _goToPrev);
  ctrl.querySelector('#btn-next')?.addEventListener('click', _goToNext);
}

async function _goToNext() {
  if (!currentLast) return;
  pageHistory.push(currentFirst);   // save current first for going back
  await _fetchPage(currentLast, 'next');
}

async function _goToPrev() {
  if (!pageHistory.length) return;
  const prevFirstDoc = pageHistory.pop();
  await _fetchPage(prevFirstDoc, 'prev');
}

// ── Reset Pagination + Refetch ────────────────────────────────────────────────

function _resetAndFetch() {
  pageHistory  = [];
  currentFirst = null;
  currentLast  = null;
  _fetchPage();
}

// ── Per-Image Action Handlers (global for onclick in innerHTML) ───────────────

window._imgView = (id, slug) => {
  window.open(slug ? `/i/${slug}` : `/image.html?id=${id}`, '_blank', 'noopener');
};

window._imgCopyUrl = url => {
  if (!url) { _showToast('No URL available for this image', 'error'); return; }
  navigator.clipboard.writeText(url)
    .then(()  => _showToast('URL copied to clipboard!', 'success'))
    .catch(()  => _showToast('Clipboard write failed', 'error'));
};

window._imgSoftDelete = async id => {
  if (!confirm('Soft delete this image? It can be restored later.')) return;
  try {
    await updateDoc(doc(db, 'uploads', id), { deleted: true });
    _showToast('Image soft-deleted.', 'success');
    _removeFromDOM(id);
  } catch (err) {
    console.error(err);
    _showToast('Soft delete failed: ' + err.message, 'error');
  }
};

window._imgRestore = async id => {
  try {
    await updateDoc(doc(db, 'uploads', id), { deleted: false });
    _showToast('Image restored.', 'success');
    _removeFromDOM(id);
  } catch (err) {
    console.error(err);
    _showToast('Restore failed: ' + err.message, 'error');
  }
};

window._imgHardDelete = async id => {
  if (!confirm('PERMANENTLY delete this image?\n\nThis CANNOT be undone. The ImgBB-hosted file will remain (ImgBB free tier has no delete API) but the Firestore record will be erased.')) return;
  try {
    await deleteDoc(doc(db, 'uploads', id));
    _showToast('Image permanently deleted.', 'success');
    _removeFromDOM(id);
  } catch (err) {
    console.error(err);
    _showToast('Permanent delete failed: ' + err.message, 'error');
  }
};

function _removeFromDOM(id) {
  document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
  allDocsOnPage = allDocsOnPage.filter(d => d.id !== id);
  selectedIds.delete(id);
  _updateSelectionUI();

  // Show empty state if last item removed
  if (!document.querySelectorAll('[data-id]').length) {
    const container = document.getElementById('images-container');
    container.className = 'images-container';
    container.innerHTML = `<div class="admin-empty" role="status">
      <div class="empty-icon" aria-hidden="true">🖼</div>
      <h3>No images on this page</h3>
      <p>All images were removed. Use pagination to view other pages.</p>
    </div>`;
  }
}

// ── Image Detail Modal ────────────────────────────────────────────────────────

window._imgDetail = async id => {
  const modal = document.getElementById('image-detail-modal');
  const body  = document.getElementById('modal-body');
  if (!modal || !body) return;

  modal.classList.add('open');
  modal.setAttribute('aria-modal', 'true');
  body.innerHTML = `<div class="admin-loading" role="status">
    <span class="spinner" aria-hidden="true"></span> Loading image details…
  </div>`;

  try {
    // Prefer cache, fall back to Firestore read
    let img = allDocsOnPage.find(d => d.id === id);
    if (!img) {
      const snap = await getDoc(doc(db, 'uploads', id));
      if (!snap.exists()) {
        body.innerHTML = `<div class="admin-error">Image not found in Firestore.</div>`;
        return;
      }
      img = { id: snap.id, ...snap.data() };
    }

    const siteUrl = img.slugUrl || `/image.html?id=${img.id}`;

    body.innerHTML = `
      <div class="detail-preview">
        <img src="${_esc(img.imgbbUrl || img.imgbbThumbUrl || '')}"
             alt="${_esc(img.customName || img.filename || 'Image preview')}"
             class="detail-preview__img">
      </div>

      <div class="detail-grid">
        ${_row('Document ID',              img.id)}
        ${_row('Custom Name',             img.customName  || '—')}
        ${_row('Original Filename',       img.filename    || '—')}
        ${_row('Custom Slug',             img.customSlug  || '—')}
        ${_row('Session ID',              img.sessionId   || '—')}
        ${_row('UID (logged-in user)',     img.uid         || 'null (guest)')}
        ${_row('MIME Type',               img.mimeType    || '—')}
        ${_row('File Size',               _formatBytes(img.fileSize))}
        ${_row('Dimensions',              img.width && img.height ? `${img.width} × ${img.height} px` : '—')}
        ${_row('Views',                   img.views ?? 0)}
        ${_row('Privacy',                 img.privacy     || 'public')}
        ${_row('Password Protected',      img.isPasswordProtected ? '🔒 Yes' : 'No')}
        ${_row('Expiry',                  img.expiresAt   ? _formatDate(img.expiresAt)  : 'Never')}
        ${_row('Auto-Delete After Views', img.autoDeleteAfterViews ?? '—')}
        ${_row('Album ID',                img.albumId     || '—')}
        ${_row('Tags',                    img.tags?.length ? img.tags.join(', ') : '—')}
        ${_row('Description',             img.description || '—')}
        ${_row('Compression Quality',     img.compressionQuality != null ? img.compressionQuality + '%' : '—')}
        ${_row('Bulk Upload',             img.isBulkUpload  ? 'Yes' : 'No')}
        ${_row('Bulk Session ID',         img.bulkSessionId || '—')}
        ${_row('Was Edited',              img.wasEdited     ? 'Yes' : 'No')}
        ${_row('Reported',                img.reported      ? '🚨 Yes' : 'No')}
        ${_row('Deleted (soft)',          img.deleted       ? '🗑 Yes'  : 'No')}
        ${_row('Created At',             _formatDate(img.createdAt))}
      </div>

      <div class="detail-urls">
        <div class="detail-url-label">ImgBB Direct URL</div>
        <code class="detail-url-code">${_esc(img.imgbbUrl || '—')}</code>
        <div class="detail-url-label">Site URL</div>
        <code class="detail-url-code">${_esc(location.origin + siteUrl)}</code>
        ${img.customSlug
          ? `<div class="detail-url-label">Slug URL</div>
             <code class="detail-url-code">${_esc(location.origin + '/i/' + img.customSlug)}</code>`
          : ''}
      </div>

      <div class="detail-actions">
        <button class="btn-primary"
          onclick="window._imgCopyUrl('${_esc(img.imgbbUrl || '')}')">
          📋 Copy Direct URL
        </button>
        <button class="btn-secondary"
          onclick="window._imgView('${_esc(img.id)}','${_esc(img.customSlug || '')}')">
          👁 View Public Page
        </button>
        ${img.deleted
          ? `<button class="btn-success"
               onclick="window._imgRestore('${_esc(img.id)}');
                        document.getElementById('image-detail-modal').classList.remove('open')">
               ♻️ Restore
             </button>
             <button class="btn-danger"
               onclick="window._imgHardDelete('${_esc(img.id)}');
                        document.getElementById('image-detail-modal').classList.remove('open')">
               💥 Permanent Delete
             </button>`
          : `<button class="btn-danger"
               onclick="window._imgSoftDelete('${_esc(img.id)}');
                        document.getElementById('image-detail-modal').classList.remove('open')">
               🗑 Soft Delete
             </button>`
        }
      </div>
    `;
  } catch (err) {
    console.error('[admin-images] detail modal error:', err);
    body.innerHTML = `<div class="admin-error" role="alert">
      Failed to load image details: ${_esc(err.message)}
    </div>`;
  }
};

const _row = (label, value) => `
  <div class="detail-row">
    <span class="detail-label">${_esc(label)}</span>
    <span class="detail-value">${_esc(String(value ?? '—'))}</span>
  </div>`;

// ── Bulk Delete ───────────────────────────────────────────────────────────────

async function _bulkSoftDelete() {
  if (!selectedIds.size) return;
  const count = selectedIds.size;
  if (!confirm(`Soft delete ${count} selected image(s)? They can be restored.`)) return;

  const ids = [...selectedIds];
  const results = await Promise.allSettled(
    ids.map(id => updateDoc(doc(db, 'uploads', id), { deleted: true }))
  );
  const failed  = results.filter(r => r.status === 'rejected').length;
  const success = ids.length - failed;

  _showToast(
    `${success}/${ids.length} image(s) soft-deleted.${failed ? ` ${failed} failed.` : ''}`,
    failed ? 'warning' : 'success'
  );

  ids.forEach(id => _removeFromDOM(id));
  _clearSelection();
}

// ── Modal Close Helper ────────────────────────────────────────────────────────

function _closeModal() {
  const modal = document.getElementById('image-detail-modal');
  modal?.classList.remove('open');
  modal?.removeAttribute('aria-modal');
}

// ── Main Init ─────────────────────────────────────────────────────────────────

initAdminAuth(async _user => {

  // ── Logout ────────────────────────────────────────────────────────────────
  document.getElementById('logout-btn')?.addEventListener('click', handleAdminLogout);

  // ── View Toggle ───────────────────────────────────────────────────────────
  const btnGrid = document.getElementById('view-toggle-grid');
  const btnList = document.getElementById('view-toggle-list');

  btnGrid?.addEventListener('click', () => {
    currentView = 'grid';
    btnGrid.classList.add('active');
    btnList?.classList.remove('active');
    btnGrid.setAttribute('aria-pressed', 'true');
    btnList?.setAttribute('aria-pressed', 'false');
    _applyClientFilters();
  });

  btnList?.addEventListener('click', () => {
    currentView = 'list';
    btnList.classList.add('active');
    btnGrid?.classList.remove('active');
    btnList.setAttribute('aria-pressed', 'true');
    btnGrid?.setAttribute('aria-pressed', 'false');
    _applyClientFilters();
  });

  // ── Filters that require a Firestore re-query (reset pagination) ──────────
  document.getElementById('sort-select')         ?.addEventListener('change', _resetAndFetch);
  document.getElementById('show-deleted-toggle') ?.addEventListener('change', _resetAndFetch);

  // ── Filters that only need client-side re-render ──────────────────────────
  document.getElementById('filter-type')    ?.addEventListener('change', _applyClientFilters);
  document.getElementById('filter-privacy') ?.addEventListener('change', _applyClientFilters);
  document.getElementById('filter-pw')      ?.addEventListener('change', _applyClientFilters);

  // ── Debounced search (client-side only) ───────────────────────────────────
  document.getElementById('search-input')?.addEventListener(
    'input', _debounce(_applyClientFilters, 350)
  );

  // ── Select All ────────────────────────────────────────────────────────────
  document.getElementById('select-all')?.addEventListener('change', e => {
    document.querySelectorAll('.img-checkbox').forEach(cb => {
      cb.checked = e.target.checked;
      e.target.checked ? selectedIds.add(cb.dataset.id) : selectedIds.delete(cb.dataset.id);
    });
    _updateSelectionUI();
  });

  // ── Bulk Delete ───────────────────────────────────────────────────────────
  document.getElementById('bulk-delete-btn')?.addEventListener('click', _bulkSoftDelete);

  // ── Modal: close button ───────────────────────────────────────────────────
  document.getElementById('modal-close-btn')?.addEventListener('click', _closeModal);

  // ── Modal: backdrop click ─────────────────────────────────────────────────
  document.getElementById('image-detail-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) _closeModal();
  });

  // ── Modal: Escape key ─────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') _closeModal();
  });

  // ── Initial load ──────────────────────────────────────────────────────────
  _fetchPage();
});
