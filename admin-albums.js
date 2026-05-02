// public/js/admin/admin-albums.js
// File 22/43 — Imgify Admin Album Management
// ES Module — Full CRUD for albums collection

import { initAdminAuth, handleAdminLogout } from './admin-auth.js';
import { db } from '../firebase-init.js';
import {
  collection, query, where, orderBy, limit,
  startAfter, startAt, getDocs, getDoc, addDoc,
  updateDoc, deleteDoc, doc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { nanoid } from 'https://esm.run/nanoid'; // FIX #17: ESM build — named exports work correctly

// ─── Helpers ───────────────────────────────────────────────────────────────

function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function _formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function _showToast(message, type = 'info') {
  const existing = document.getElementById('admin-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'admin-toast';
  const colors = {
    success: 'var(--success-light)',
    error:   'var(--danger-light)',
    info:    'var(--accent-light)',
    warning: 'var(--warning-light)'
  };
  const textColors = {
    success: 'var(--success)',
    error:   'var(--danger)',
    info:    'var(--accent)',
    warning: 'var(--warning)'
  };
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    background: ${colors[type] || colors.info};
    color: ${textColors[type] || textColors.info};
    padding: 12px 20px; border-radius: 8px;
    font-family: var(--font-body); font-size: 14px; font-weight: 500;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    animation: slideInRight 0.25s ease;
  `;
  toast.textContent = message;

  if (!document.getElementById('toast-keyframes')) {
    const style = document.createElement('style');
    style.id = 'toast-keyframes';
    style.textContent = `
      @keyframes slideInRight {
        from { opacity: 0; transform: translateX(20px); }
        to   { opacity: 1; transform: translateX(0); }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ─── State ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;
let pageStack = [];        // array of first-doc snapshots for each page
let lastDocSnap = null;
let currentPageIndex = 0;
let showDeleted = false;
let currentFilter = { privacy: 'all', search: '', sort: 'newest' };
let allPageDocs = [];      // docs fetched for current page (for client-side filter)
let debounceTimer = null;
let coverPickerAlbumId = null;

// ─── Logout ─────────────────────────────────────────────────────────────────

window.__albumLogout = () => handleAdminLogout();

// ─── Stats ──────────────────────────────────────────────────────────────────

async function loadStats() {
  const statsEl = document.getElementById('album-stats');
  if (!statsEl) return;

  try {
    const snap = await getDocs(query(
      collection(db, 'albums'),
      where('deleted', '==', false)
    ));
    let totalAlbums = 0, totalImages = 0, publicCount = 0;
    snap.forEach(d => {
      const data = d.data();
      totalAlbums++;
      totalImages += (data.imageCount || 0);
      if (data.privacy === 'public') publicCount++;
    });
    statsEl.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${totalAlbums}</div>
        <div class="stat-label">Total Albums</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalImages.toLocaleString()}</div>
        <div class="stat-label">Total Images</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${publicCount}</div>
        <div class="stat-label">Public Albums</div>
      </div>
    `;
  } catch (err) {
    console.error('Stats error:', err);
    if (statsEl) statsEl.innerHTML = '<p style="color:var(--danger);font-size:13px;">Failed to load stats.</p>';
  }
}

// ─── Query ──────────────────────────────────────────────────────────────────

function buildQuery(cursor = null, direction = 'next') {
  const constraints = [collection(db, 'albums')];

  if (!showDeleted) {
    constraints.push(where('deleted', '==', false));
  }

  // Sort applied at Firestore level for index-compatible sorts
  // We always fetch newest-first from Firestore; client-side re-sorts for other options
  constraints.push(orderBy('createdAt', 'desc'));
  constraints.push(limit(PAGE_SIZE));

  if (cursor) {
    if (direction === 'next') {
      constraints.push(startAfter(cursor));
    } else {
      constraints.push(startAt(cursor));
    }
  }

  return query(...constraints);
}

// ─── Client-side filter + sort ──────────────────────────────────────────────

function applyFilters(docs) {
  let filtered = [...docs];

  // Privacy filter
  if (currentFilter.privacy !== 'all') {
    filtered = filtered.filter(d => d.privacy === currentFilter.privacy);
  }

  // Search filter
  if (currentFilter.search.trim()) {
    const term = currentFilter.search.trim().toLowerCase();
    filtered = filtered.filter(d =>
      (d.name || '').toLowerCase().includes(term) ||
      (d.sessionId || '').toLowerCase().includes(term)
    );
  }

  // Sort
  switch (currentFilter.sort) {
    case 'oldest':
      filtered.sort((a, b) => {
        const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return at - bt;
      });
      break;
    case 'most-images':
      filtered.sort((a, b) => (b.imageCount || 0) - (a.imageCount || 0));
      break;
    case 'name-az':
      filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
    default: // newest — already sorted by Firestore
      break;
  }

  return filtered;
}

// ─── Render Table ───────────────────────────────────────────────────────────

function renderTable(docs) {
  const tbody = document.getElementById('albums-tbody');
  const emptyEl = document.getElementById('albums-empty');
  if (!tbody) return;

  const filtered = applyFilters(docs);

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  tbody.innerHTML = filtered.map(album => {
    const isDeleted = album.deleted === true;
    const coverHtml = album.coverImageUrl
      ? `<img src="${_esc(album.coverImageUrl)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:6px;">`
      : `<div style="width:48px;height:48px;border-radius:6px;background:var(--bg-tertiary);display:flex;align-items:center;justify-content:center;font-size:18px;">🖼</div>`;

    const privacyBadge = {
      public:   `<span class="badge badge-success">Public</span>`,
      unlisted: `<span class="badge badge-warning">Unlisted</span>`,
      private:  `<span class="badge badge-neutral">Private</span>`
    }[album.privacy] || `<span class="badge badge-neutral">${_esc(album.privacy)}</span>`;

    const sessionDisplay = album.sessionId ? album.sessionId.substring(0, 8) : '—';

    const rowStyle = isDeleted ? 'opacity:0.55;background:var(--danger-light);' : '';

    return `
      <tr id="row-${_esc(album.firestoreId)}" style="${rowStyle}" data-id="${_esc(album.firestoreId)}">
        <td>${coverHtml}</td>
        <td>
          <div style="font-weight:500;color:var(--text-primary);">${_esc(album.name)}</div>
          ${album.description ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${_esc(album.description.substring(0, 60))}${album.description.length > 60 ? '…' : ''}</div>` : ''}
          ${isDeleted ? `<span class="badge badge-danger" style="margin-top:4px;">Deleted</span>` : ''}
        </td>
        <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);">${_esc(sessionDisplay)}</td>
        <td style="text-align:center;">${album.imageCount ?? 0}</td>
        <td>${privacyBadge}</td>
        <td style="font-size:13px;color:var(--text-muted);">${_formatDate(album.createdAt)}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-xs btn-secondary" onclick="window.__albumView('${_esc(album.albumId)}')">View</button>
            ${!isDeleted ? `
              <button class="btn btn-xs btn-secondary" onclick="window.__albumEditStart('${_esc(album.firestoreId)}')">Edit</button>
              <button class="btn btn-xs btn-secondary" onclick="window.__albumSetCover('${_esc(album.firestoreId)}','${_esc(album.albumId)}')">🖼 Cover</button>
              <button class="btn btn-xs btn-danger" onclick="window.__albumSoftDelete('${_esc(album.firestoreId)}')">Delete</button>
            ` : `
              <button class="btn btn-xs btn-success" onclick="window.__albumRestore('${_esc(album.firestoreId)}')">Restore</button>
              <button class="btn btn-xs btn-danger" onclick="window.__albumPermDelete('${_esc(album.firestoreId)}')">Perm. Delete</button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ─── Fetch Page ─────────────────────────────────────────────────────────────

async function fetchPage(cursor = null, direction = 'next') {
  const tbody = document.getElementById('albums-tbody');
  const emptyEl = document.getElementById('albums-empty');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted);">Loading…</td></tr>`;
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    const q = buildQuery(cursor, direction);
    const snap = await getDocs(q);

    allPageDocs = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));

    if (snap.docs.length > 0) {
      lastDocSnap = snap.docs[snap.docs.length - 1];
    } else {
      lastDocSnap = null;
    }

    renderTable(allPageDocs);
    updatePaginationControls(snap.docs.length);

  } catch (err) {
    console.error('Fetch error:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--danger);">Error loading albums. Check console.</td></tr>`;
  }
}

// ─── Pagination Controls ────────────────────────────────────────────────────

function updatePaginationControls(fetchedCount) {
  const el = document.getElementById('pagination-controls');
  if (!el) return;

  const hasPrev = currentPageIndex > 0;
  const hasNext = fetchedCount === PAGE_SIZE;

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <button class="btn btn-secondary btn-sm" onclick="window.__albumPagePrev()" ${hasPrev ? '' : 'disabled'}>← Prev</button>
      <span style="font-size:13px;color:var(--text-muted);">Page ${currentPageIndex + 1}</span>
      <button class="btn btn-secondary btn-sm" onclick="window.__albumPageNext()" ${hasNext ? '' : 'disabled'}>Next →</button>
    </div>
  `;
}

window.__albumPageNext = async () => {
  if (!lastDocSnap) return;
  pageStack.push(lastDocSnap);
  currentPageIndex++;
  await fetchPage(lastDocSnap, 'next');
};

window.__albumPagePrev = async () => {
  if (currentPageIndex === 0) return;
  currentPageIndex--;
  pageStack.pop();
  const prevCursor = pageStack.length > 0 ? pageStack[pageStack.length - 1] : null;
  // For page 0 no cursor needed
  if (currentPageIndex === 0) {
    await fetchPage(null);
  } else {
    await fetchPage(prevCursor, 'next');
  }
};

function resetPagination() {
  pageStack = [];
  lastDocSnap = null;
  currentPageIndex = 0;
}

// ─── View Album ─────────────────────────────────────────────────────────────

window.__albumView = (albumId) => {
  window.open(`/album.html?id=${encodeURIComponent(albumId)}`, '_blank');
};

// ─── Soft Delete ─────────────────────────────────────────────────────────────

window.__albumSoftDelete = async (firestoreId) => {
  if (!confirm('Soft-delete this album? Images will NOT be deleted.')) return;
  try {
    await updateDoc(doc(db, 'albums', firestoreId), {
      deleted: true,
      updatedAt: serverTimestamp()
    });
    _showToast('Album deleted.', 'success');
    resetPagination();
    await fetchPage();
    await loadStats();
  } catch (err) {
    console.error(err);
    _showToast('Error deleting album.', 'error');
  }
};

// ─── Restore ────────────────────────────────────────────────────────────────

window.__albumRestore = async (firestoreId) => {
  try {
    await updateDoc(doc(db, 'albums', firestoreId), {
      deleted: false,
      updatedAt: serverTimestamp()
    });
    _showToast('Album restored.', 'success');
    resetPagination();
    await fetchPage();
    await loadStats();
  } catch (err) {
    console.error(err);
    _showToast('Error restoring album.', 'error');
  }
};

// ─── Permanent Delete ────────────────────────────────────────────────────────

window.__albumPermDelete = async (firestoreId) => {
  const modal = document.getElementById('confirm-delete-modal');
  if (modal) {
    modal.style.display = 'flex';
    window.__confirmPermDeleteId = firestoreId;
  } else {
    if (!confirm('PERMANENTLY delete this album? This cannot be undone.')) return;
    await _doPermDelete(firestoreId);
  }
};

window.__confirmPermDelete = async () => {
  const modal = document.getElementById('confirm-delete-modal');
  if (modal) modal.style.display = 'none';
  if (window.__confirmPermDeleteId) {
    await _doPermDelete(window.__confirmPermDeleteId);
    window.__confirmPermDeleteId = null;
  }
};

window.__cancelPermDelete = () => {
  const modal = document.getElementById('confirm-delete-modal');
  if (modal) modal.style.display = 'none';
  window.__confirmPermDeleteId = null;
};

async function _doPermDelete(firestoreId) {
  try {
    await deleteDoc(doc(db, 'albums', firestoreId));
    _showToast('Album permanently deleted.', 'success');
    resetPagination();
    await fetchPage();
    await loadStats();
  } catch (err) {
    console.error(err);
    _showToast('Error deleting album.', 'error');
  }
}

// ─── Inline Edit ─────────────────────────────────────────────────────────────

window.__albumEditStart = (firestoreId) => {
  const row = document.getElementById(`row-${CSS.escape(firestoreId)}`);
  if (!row) return;

  const album = allPageDocs.find(a => a.firestoreId === firestoreId);
  if (!album) return;

  const nameTd   = row.cells[1];
  const actionTd = row.cells[6];

  nameTd.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px;">
      <input id="edit-name-${_esc(firestoreId)}" type="text" class="form-input" value="${_esc(album.name)}" maxlength="80" placeholder="Album name" style="font-size:13px;padding:6px 10px;" />
      <textarea id="edit-desc-${_esc(firestoreId)}" class="form-input" rows="2" maxlength="500" placeholder="Description (optional)" style="font-size:13px;padding:6px 10px;resize:vertical;">${_esc(album.description || '')}</textarea>
      <select id="edit-privacy-${_esc(firestoreId)}" class="form-input" style="font-size:13px;padding:6px 10px;">
        <option value="public"   ${album.privacy === 'public'   ? 'selected' : ''}>Public</option>
        <option value="unlisted" ${album.privacy === 'unlisted' ? 'selected' : ''}>Unlisted</option>
        <option value="private"  ${album.privacy === 'private'  ? 'selected' : ''}>Private</option>
      </select>
    </div>
  `;

  actionTd.innerHTML = `
    <div style="display:flex;gap:6px;">
      <button class="btn btn-xs btn-primary" onclick="window.__albumEditSave('${_esc(firestoreId)}')">Save</button>
      <button class="btn btn-xs btn-secondary" onclick="window.__albumEditCancel()">Cancel</button>
    </div>
  `;
};

window.__albumEditSave = async (firestoreId) => {
  const nameInput    = document.getElementById(`edit-name-${CSS.escape(firestoreId)}`);
  const descInput    = document.getElementById(`edit-desc-${CSS.escape(firestoreId)}`);
  const privacyInput = document.getElementById(`edit-privacy-${CSS.escape(firestoreId)}`);

  if (!nameInput) return;

  const name = nameInput.value.trim();
  if (!name) { _showToast('Album name is required.', 'warning'); return; }

  try {
    await updateDoc(doc(db, 'albums', firestoreId), {
      name,
      description: descInput?.value.trim() || null,
      privacy:     privacyInput?.value || 'public',
      updatedAt:   serverTimestamp()
    });
    _showToast('Album updated.', 'success');
    resetPagination();
    await fetchPage();
  } catch (err) {
    console.error(err);
    _showToast('Error updating album.', 'error');
  }
};

window.__albumEditCancel = () => {
  renderTable(allPageDocs);
};

// ─── Cover Picker ─────────────────────────────────────────────────────────────

window.__albumSetCover = async (firestoreId, albumId) => {
  coverPickerAlbumId = firestoreId;
  const modal = document.getElementById('cover-picker-modal');
  const grid  = document.getElementById('cover-picker-grid');
  if (!modal || !grid) return;

  grid.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Loading images…</p>';
  modal.style.display = 'flex';

  try {
    const q = query(
      collection(db, 'uploads'),
      where('albumId', '==', albumId),
      where('deleted', '==', false),
      limit(20)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      grid.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No images in this album yet.</p>';
      return;
    }

    grid.innerHTML = snap.docs.map(d => {
      const img = d.data();
      const thumb = img.imgbbThumbUrl || img.imgbbUrl || '';
      return `
        <div style="cursor:pointer;border:2px solid transparent;border-radius:8px;overflow:hidden;transition:border-color 0.15s;"
             onmouseover="this.style.borderColor='var(--accent)'"
             onmouseout="this.style.borderColor='transparent'"
             onclick="window.__albumPickCover('${_esc(d.id)}','${_esc(thumb)}')">
          <img src="${_esc(thumb)}" alt="" style="width:80px;height:80px;object-fit:cover;display:block;" loading="lazy" />
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
    grid.innerHTML = '<p style="color:var(--danger);font-size:13px;">Error loading images.</p>';
  }
};

window.__albumPickCover = async (imageId, thumbUrl) => {
  if (!coverPickerAlbumId) return;
  try {
    await updateDoc(doc(db, 'albums', coverPickerAlbumId), {
      coverImageId:  imageId,
      coverImageUrl: thumbUrl,
      updatedAt:     serverTimestamp()
    });
    _showToast('Cover image updated.', 'success');
    window.__closeCoverPicker();
    resetPagination();
    await fetchPage();
  } catch (err) {
    console.error(err);
    _showToast('Error setting cover image.', 'error');
  }
};

window.__closeCoverPicker = () => {
  const modal = document.getElementById('cover-picker-modal');
  if (modal) modal.style.display = 'none';
  coverPickerAlbumId = null;
};

// ─── Create Album Modal ───────────────────────────────────────────────────────

window.__openCreateModal = () => {
  const modal = document.getElementById('create-album-modal');
  if (modal) {
    modal.style.display = 'flex';
    const nameInput = document.getElementById('create-name');
    if (nameInput) nameInput.focus();
  }
};

window.__closeCreateModal = () => {
  const modal = document.getElementById('create-album-modal');
  if (modal) modal.style.display = 'none';
  _resetCreateForm();
};

function _resetCreateForm() {
  const nameInput = document.getElementById('create-name');
  const descInput = document.getElementById('create-desc');
  const privRadios = document.querySelectorAll('input[name="create-privacy"]');
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  privRadios.forEach(r => { r.checked = r.value === 'public'; });
}

window.__submitCreateAlbum = async () => {
  const nameInput = document.getElementById('create-name');
  const descInput = document.getElementById('create-desc');
  const privacyRadio = document.querySelector('input[name="create-privacy"]:checked');
  const btn = document.getElementById('create-submit-btn');

  const name = nameInput?.value.trim();
  if (!name) { _showToast('Album name is required.', 'warning'); nameInput?.focus(); return; }

  const privacy = privacyRadio?.value || 'public';
  const description = descInput?.value.trim() || null;

  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

  try {
    await addDoc(collection(db, 'albums'), {
      albumId:      nanoid(8),
      uid:          null,
      sessionId:    null,
      name,
      description,
      privacy,
      imageCount:   0,
      coverImageId: null,
      coverImageUrl: null,
      deleted:      false,
      createdAt:    serverTimestamp(),
      updatedAt:    serverTimestamp()
    });
    _showToast('Album created!', 'success');
    window.__closeCreateModal();
    resetPagination();
    await fetchPage();
    await loadStats();
  } catch (err) {
    console.error(err);
    _showToast('Error creating album.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Album'; }
  }
};

// ─── Filters & Search ────────────────────────────────────────────────────────

function setupFilters() {
  const privacyFilter = document.getElementById('filter-privacy');
  const searchInput   = document.getElementById('search-input');
  const sortSelect    = document.getElementById('sort-select');
  const showDelToggle = document.getElementById('show-deleted-toggle');

  if (privacyFilter) {
    privacyFilter.addEventListener('change', () => {
      currentFilter.privacy = privacyFilter.value;
      renderTable(allPageDocs);
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      currentFilter.sort = sortSelect.value;
      renderTable(allPageDocs);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentFilter.search = searchInput.value;
        renderTable(allPageDocs);
      }, 350);
    });
  }

  if (showDelToggle) {
    showDelToggle.addEventListener('change', async () => {
      showDeleted = showDelToggle.checked;
      resetPagination();
      await fetchPage();
    });
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

initAdminAuth(async (user) => {
  // Wire up logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', window.__albumLogout);

  // Wire up create button
  const createBtn = document.getElementById('create-album-btn');
  if (createBtn) createBtn.addEventListener('click', window.__openCreateModal);

  // Wire up modal close via backdrop click
  const createModal = document.getElementById('create-album-modal');
  if (createModal) {
    createModal.addEventListener('click', (e) => {
      if (e.target === createModal) window.__closeCreateModal();
    });
  }

  const coverModal = document.getElementById('cover-picker-modal');
  if (coverModal) {
    coverModal.addEventListener('click', (e) => {
      if (e.target === coverModal) window.__closeCoverPicker();
    });
  }

  const confirmModal = document.getElementById('confirm-delete-modal');
  if (confirmModal) {
    confirmModal.addEventListener('click', (e) => {
      if (e.target === confirmModal) window.__cancelPermDelete();
    });
  }

  // Wire up confirm delete modal buttons
  const confirmYesBtn = document.getElementById('confirm-delete-yes');
  const confirmNoBtn  = document.getElementById('confirm-delete-no');
  if (confirmYesBtn) confirmYesBtn.addEventListener('click', window.__confirmPermDelete);
  if (confirmNoBtn)  confirmNoBtn.addEventListener('click',  window.__cancelPermDelete);

  // Wire up create form submit
  const createSubmitBtn = document.getElementById('create-submit-btn');
  if (createSubmitBtn) createSubmitBtn.addEventListener('click', window.__submitCreateAlbum);

  // Wire up cover picker close
  const closeCoverBtn = document.getElementById('close-cover-picker');
  if (closeCoverBtn) closeCoverBtn.addEventListener('click', window.__closeCoverPicker);

  // Wire up create modal close button
  const closeCreateBtn = document.getElementById('close-create-modal');
  if (closeCreateBtn) closeCreateBtn.addEventListener('click', window.__closeCreateModal);

  setupFilters();

  await Promise.allSettled([
    loadStats(),
    fetchPage()
  ]);
});
