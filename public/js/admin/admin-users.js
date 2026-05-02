// public/js/admin/admin-users.js
// File 23/43 — Imgify Admin: User / Session Management

import { initAdminAuth, handleAdminLogout } from './admin-auth.js';
import { db } from '../firebase-init.js';
import {
  collection, getDocs, query, doc,
  setDoc, deleteDoc, updateDoc, where,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function _formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function _showToast(msg, type = 'success') {
  let toast = document.getElementById('toast-msg');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-msg';
    toast.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;
      border-radius:8px;font-size:13.5px;font-family:var(--font-body,'DM Sans',sans-serif);
      font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.15);
      transition:opacity .3s ease;pointer-events:none;
    `;
    document.body.appendChild(toast);
  }
  const colors = {
    success: { bg: 'var(--success-light,#dcfce7)', color: 'var(--success,#166534)' },
    error:   { bg: 'var(--danger-light,#fee2e2)',  color: 'var(--danger,#991b1b)'  },
    info:    { bg: 'var(--accent-light,#e8f0fe)',  color: 'var(--accent,#1a56db)'  },
  };
  const c = colors[type] || colors.info;
  toast.style.background = c.bg;
  toast.style.color = c.color;
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

// ─── State ───────────────────────────────────────────────────────────────────

let allSessions = [];   // aggregated session objects
let filteredSessions = [];
let bannedSet = new Set();
const PAGE_SIZE = 20;
let currentPage = 1;
let debounceTimer = null;

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadData() {
  _setLoading(true);
  try {
    const [uploadsSnap, bannedSnap] = await Promise.allSettled([
      getDocs(collection(db, 'uploads')),
      getDocs(collection(db, 'bannedSessions')),
    ]);

    // Build banned set
    bannedSet.clear();
    if (bannedSnap.status === 'fulfilled') {
      bannedSnap.value.forEach(d => bannedSet.add(d.id));
    }

    // Aggregate by sessionId
    const map = new Map();
    if (uploadsSnap.status === 'fulfilled') {
      uploadsSnap.value.forEach(d => {
        const data = d.data();
        const sid = data.sessionId;
        if (!sid) return;
        if (!map.has(sid)) {
          map.set(sid, {
            sessionId: sid,
            joinDate: data.createdAt,
            uploadCount: 0,
            storageUsed: 0,
          });
        }
        const sess = map.get(sid);
        sess.uploadCount++;
        sess.storageUsed += (data.fileSize || 0);
        // track earliest createdAt
        if (data.createdAt && sess.joinDate) {
          const sessMs = sess.joinDate.toMillis ? sess.joinDate.toMillis() : 0;
          const docMs  = data.createdAt.toMillis ? data.createdAt.toMillis() : 0;
          if (docMs < sessMs) sess.joinDate = data.createdAt;
        } else if (data.createdAt) {
          sess.joinDate = data.createdAt;
        }
      });
    }

    allSessions = Array.from(map.values()).map(s => ({
      ...s,
      status: bannedSet.has(s.sessionId) ? 'banned' : 'active',
    }));

    _renderStats();
    _applyFilters();
  } catch (err) {
    console.error(err);
    _showEmpty('error', 'Failed to load session data. Check console.');
  } finally {
    _setLoading(false);
  }
}

// ─── Stats row ───────────────────────────────────────────────────────────────

function _renderStats() {
  const totalSessions = allSessions.length;
  const bannedCount   = allSessions.filter(s => s.status === 'banned').length;
  const totalUploads  = allSessions.reduce((a, s) => a + s.uploadCount, 0);
  const totalStorage  = allSessions.reduce((a, s) => a + s.storageUsed, 0);

  const el = document.getElementById('users-stats');
  if (!el) return;
  el.innerHTML = `
    <div class="stat-card">
      <span class="stat-label">Total Sessions</span>
      <span class="stat-value">${totalSessions.toLocaleString()}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Banned Sessions</span>
      <span class="stat-value" style="color:var(--danger,#991b1b)">${bannedCount.toLocaleString()}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Total Uploads</span>
      <span class="stat-value">${totalUploads.toLocaleString()}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Total Storage</span>
      <span class="stat-value">${_formatBytes(totalStorage)}</span>
    </div>
  `;
}

// ─── Filter + sort ───────────────────────────────────────────────────────────

function _applyFilters() {
  const search = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
  const status = document.getElementById('filter-status')?.value || 'all';
  const sort   = document.getElementById('sort-select')?.value   || 'newest';

  filteredSessions = allSessions.filter(s => {
    if (search && !s.sessionId.toLowerCase().startsWith(search)) return false;
    if (status === 'active' && s.status !== 'active') return false;
    if (status === 'banned' && s.status !== 'banned') return false;
    return true;
  });

  filteredSessions.sort((a, b) => {
    if (sort === 'newest') {
      const aMs = a.joinDate?.toMillis?.() ?? 0;
      const bMs = b.joinDate?.toMillis?.() ?? 0;
      return bMs - aMs;
    }
    if (sort === 'uploads') return b.uploadCount - a.uploadCount;
    if (sort === 'storage') return b.storageUsed - a.storageUsed;
    return 0;
  });

  currentPage = 1;
  _renderTable();
  _renderPagination();
}

// ─── Table render ─────────────────────────────────────────────────────────────

function _renderTable() {
  const tbody = document.getElementById('users-tbody');
  const emptyEl = document.getElementById('users-empty');
  if (!tbody) return;

  if (filteredSessions.length === 0) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = filteredSessions.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = page.map(s => {
    const sid8    = _esc(s.sessionId.slice(0, 8));
    const fullSid = _esc(s.sessionId);
    const isBanned = s.status === 'banned';
    const statusBadge = isBanned
      ? `<span class="badge badge-danger">Banned</span>`
      : `<span class="badge badge-success">Active</span>`;
    const banBtn = isBanned
      ? `<button class="btn btn-xs btn-outline" onclick="window.__unbanSession('${fullSid}')">Unban</button>`
      : `<button class="btn btn-xs btn-warning"  onclick="window.__banSession('${fullSid}')">Ban</button>`;

    return `
      <tr>
        <td><code class="mono sid-cell" title="${fullSid}">${sid8}…</code></td>
        <td>${_formatDate(s.joinDate)}</td>
        <td>${s.uploadCount.toLocaleString()}</td>
        <td>${_formatBytes(s.storageUsed)}</td>
        <td>${statusBadge}</td>
        <td class="actions-cell">
          <a href="../admin/images.html?session=${encodeURIComponent(s.sessionId)}"
             class="btn btn-xs btn-outline" target="_blank">View Uploads</a>
          ${banBtn}
          <button class="btn btn-xs btn-danger"
                  onclick="window.__deleteAllUploads('${fullSid}')">Delete All</button>
        </td>
      </tr>`;
  }).join('');
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function _renderPagination() {
  const el = document.getElementById('pagination-controls');
  if (!el) return;
  const totalPages = Math.ceil(filteredSessions.length / PAGE_SIZE);
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <button class="btn btn-sm btn-outline" id="prev-btn"
            ${currentPage === 1 ? 'disabled' : ''}>← Prev</button>
    <span class="page-info">Page ${currentPage} of ${totalPages}</span>
    <button class="btn btn-sm btn-outline" id="next-btn"
            ${currentPage === totalPages ? 'disabled' : ''}>Next →</button>
  `;
  document.getElementById('prev-btn')?.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; _renderTable(); _renderPagination(); }
  });
  document.getElementById('next-btn')?.addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; _renderTable(); _renderPagination(); }
  });
}

// ─── Actions ─────────────────────────────────────────────────────────────────

window.__banSession = async function(sid) {
  if (!confirm(`Ban session ${sid.slice(0,8)}…?\nThis session won't be able to upload.`)) return;
  try {
    await setDoc(doc(db, 'bannedSessions', sid), {
      sessionId: sid,
      bannedAt: serverTimestamp(),
      reason: null,
    });
    bannedSet.add(sid);
    _updateSessionStatus(sid, 'banned');
    _renderStats();
    _showToast('Session banned.', 'success');
  } catch (err) {
    console.error(err);
    _showToast('Failed to ban session.', 'error');
  }
};

window.__unbanSession = async function(sid) {
  if (!confirm(`Unban session ${sid.slice(0,8)}…?`)) return;
  try {
    await deleteDoc(doc(db, 'bannedSessions', sid));
    bannedSet.delete(sid);
    _updateSessionStatus(sid, 'active');
    _renderStats();
    _showToast('Session unbanned.', 'success');
  } catch (err) {
    console.error(err);
    _showToast('Failed to unban session.', 'error');
  }
};

window.__deleteAllUploads = async function(sid) {
  if (!confirm(`Delete ALL uploads for session ${sid.slice(0,8)}…?\nThis cannot be undone.`)) return;
  try {
    const snap = await getDocs(
      query(collection(db, 'uploads'), where('sessionId', '==', sid))
    );
    if (snap.empty) { _showToast('No uploads found for this session.', 'info'); return; }

    const results = await Promise.allSettled(
      snap.docs.map(d => updateDoc(doc(db, 'uploads', d.id), { deleted: true }))
    );
    const deleted = results.filter(r => r.status === 'fulfilled').length;
    const failed  = results.length - deleted;

    // Update local state
    const sess = allSessions.find(s => s.sessionId === sid);
    if (sess) { sess.uploadCount = 0; sess.storageUsed = 0; }
    _renderStats();
    _applyFilters();

    _showToast(
      `${deleted} upload${deleted !== 1 ? 's' : ''} deleted${failed ? ` (${failed} failed)` : ''}.`,
      failed ? 'error' : 'success'
    );
  } catch (err) {
    console.error(err);
    _showToast('Failed to delete uploads.', 'error');
  }
};

// Update a session's status in allSessions + filteredSessions without full reload
function _updateSessionStatus(sid, status) {
  [allSessions, filteredSessions].forEach(arr => {
    const s = arr.find(x => x.sessionId === sid);
    if (s) s.status = status;
  });
  _renderTable();
}

// ─── UI utilities ─────────────────────────────────────────────────────────────

function _setLoading(on) {
  const el = document.getElementById('users-loading');
  const tableWrap = document.getElementById('users-table-wrap');
  if (el) el.style.display = on ? 'flex' : 'none';
  if (tableWrap) tableWrap.style.display = on ? 'none' : '';
}

function _showEmpty(type, msg) {
  const emptyEl = document.getElementById('users-empty');
  if (!emptyEl) return;
  emptyEl.innerHTML = type === 'error'
    ? `<div class="empty-state error"><p>${_esc(msg)}</p></div>`
    : `<div class="empty-state"><p>${_esc(msg)}</p></div>`;
  emptyEl.style.display = 'block';
}

// ─── Event bindings ───────────────────────────────────────────────────────────

function _bindControls() {
  document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(_applyFilters, 350);
  });
  document.getElementById('filter-status')?.addEventListener('change', _applyFilters);
  document.getElementById('sort-select')?.addEventListener('change', _applyFilters);
  document.getElementById('logout-btn')?.addEventListener('click', handleAdminLogout);
  document.getElementById('refresh-btn')?.addEventListener('click', loadData);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

initAdminAuth(async () => {
  _bindControls();
  await loadData();
});
