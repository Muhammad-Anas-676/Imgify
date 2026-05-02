/**
 * admin-dash.js — File 19/43
 * Imgify Admin Dashboard — Overview stats + recent activity
 * ES Module | Firebase Firestore modular SDK 10.12.0 CDN
 * Path: public/js/admin/admin-dash.js
 */

import { initAdminAuth, handleAdminLogout } from './admin-auth.js';
import { db } from '../firebase-init.js';

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getAggregateFromServer,
  sum,
  doc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */

function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function _formatDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    year:   'numeric',
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit'
  });
}

function _formatBytes(n) {
  const num = Number(n);
  if (!num || isNaN(num)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, val = num;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function _showToast(message, type = 'info') {
  let toast = document.querySelector('.imgify-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'imgify-toast';
    document.body.appendChild(toast);
  }
  toast.textContent  = message;
  toast.dataset.type = type;
  toast.classList.add('imgify-toast-visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('imgify-toast-visible'), 3500);
}

function _setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/* ══════════════════════════════════════════════════════
   STATS — REALTIME via onSnapshot
══════════════════════════════════════════════════════ */

function _subscribeStats() {
  const uploadsRef = collection(db, 'uploads');
  const albumsRef  = collection(db, 'albums');
  const reportsRef = collection(db, 'reports');

  const uploadsActiveQ = query(uploadsRef, where('deleted', '==', false));
  const albumsActiveQ  = query(albumsRef,  where('deleted', '==', false));
  const reportsOpenQ   = query(reportsRef, where('status', '==', 'open'));

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayUploadsQ = query(
    uploadsRef,
    where('deleted',   '==', false),
    where('createdAt', '>=', todayMidnight)
  );
  const pwQ = query(
    uploadsRef,
    where('deleted',             '==', false),
    where('isPasswordProtected', '==', true)
  );

  const unsubs = [];

  // Total uploads
  unsubs.push(onSnapshot(uploadsActiveQ, snap => {
    _setEl('stat-total-uploads', snap.size.toLocaleString());

    getAggregateFromServer(uploadsActiveQ, { totalSize: sum('fileSize') })
      .then(agg => _setEl('stat-storage', _formatBytes(agg.data().totalSize ?? 0)))
      .catch(err => console.error('[admin-dash] storage aggregate error:', err));
  }, err => console.error('[admin-dash] uploads snapshot error:', err)));

  // Total albums
  unsubs.push(onSnapshot(albumsActiveQ, snap => {
    _setEl('stat-total-albums', snap.size.toLocaleString());
  }, err => console.error('[admin-dash] albums snapshot error:', err)));

  // Open reports
  unsubs.push(onSnapshot(reportsOpenQ, snap => {
    _setEl('stat-pending-reports', snap.size.toLocaleString());
  }, err => console.error('[admin-dash] reports snapshot error:', err)));

  // Today's uploads
  unsubs.push(onSnapshot(todayUploadsQ, snap => {
    _setEl('stat-today-uploads', snap.size.toLocaleString());
  }, err => console.error('[admin-dash] today uploads snapshot error:', err)));

  // Password-protected count
  unsubs.push(onSnapshot(pwQ, snap => {
    _setEl('stat-password-protected', snap.size.toLocaleString());
  }, err => console.error('[admin-dash] pw-protected snapshot error:', err)));

  return () => unsubs.forEach(fn => fn());
}

/* ══════════════════════════════════════════════════════
   RECENT UPLOADS — REALTIME via onSnapshot
══════════════════════════════════════════════════════ */

function _subscribeRecentUploads() {
  const listEl = document.getElementById('recent-uploads-list');
  if (!listEl) return () => {};

  listEl.innerHTML = '<div class="admin-list-loading">Loading…</div>';

  const q = query(
    collection(db, 'uploads'),
    where('deleted', '==', false),
    orderBy('createdAt', 'desc'),
    limit(5)
  );

  const unsub = onSnapshot(q, snap => {
    if (snap.empty) {
      listEl.innerHTML = '<div class="admin-list-empty">No uploads yet.</div>';
      return;
    }

    const rows = snap.docs.map(docSnap => {
      const d        = docSnap.data();
      const id       = docSnap.id;
      const thumb    = _esc(d.imgbbThumbUrl || d.imgbbUrl || '');
      const filename = _esc(d.customName    || d.filename || 'Untitled');
      const date     = _formatDate(d.createdAt);
      const size     = _formatBytes(d.fileSize);
      const viewUrl  = `/image.html?id=${_esc(id)}`;
      const safeId   = _esc(id);

      return `
        <div class="admin-list-item" id="upload-row-${safeId}" data-id="${safeId}">
          <div class="admin-list-thumb">
            ${thumb
              ? `<img src="${thumb}" alt="${filename}" loading="lazy" width="48" height="48">`
              : `<div class="admin-list-thumb-placeholder" aria-hidden="true">🖼</div>`
            }
          </div>
          <div class="admin-list-meta">
            <a class="admin-list-name"
               href="${viewUrl}" target="_blank" rel="noopener noreferrer">
              ${filename}
            </a>
            <span class="admin-list-date">${date} &middot; ${size}</span>
          </div>
          <div class="admin-list-actions">
            <a class="admin-btn admin-btn-sm admin-btn-ghost"
               href="${viewUrl}" target="_blank" rel="noopener noreferrer"
               aria-label="View ${filename}">View</a>
            <button class="admin-btn admin-btn-sm admin-btn-danger"
                    data-id="${safeId}" data-action="delete-upload"
                    aria-label="Delete ${filename}">Delete</button>
          </div>
        </div>`.trim();
    });

    listEl.innerHTML = rows.join('\n');

    listEl.querySelectorAll('[data-action="delete-upload"]').forEach(btn => {
      btn.addEventListener('click', () => _handleDeleteUpload(btn.dataset.id));
    });

  }, err => {
    console.error('[admin-dash] _subscribeRecentUploads error:', err);
    listEl.innerHTML = '<div class="admin-list-error">Failed to load recent uploads.</div>';
  });

  return unsub;
}

/* ══════════════════════════════════════════════════════
   SOFT DELETE — UPLOAD
══════════════════════════════════════════════════════ */

async function _handleDeleteUpload(id) {
  if (!id) return;
  if (!confirm(
    'Soft-delete this image?\n\n' +
    'The Firestore record will be marked deleted. ' +
    'The ImgBB CDN URL will remain live (free tier limitation).'
  )) return;

  try {
    await updateDoc(doc(db, 'uploads', id), { deleted: true });
    _showToast('Image deleted successfully.', 'success');
  } catch (err) {
    console.error('[admin-dash] _handleDeleteUpload error:', err);
    _showToast('Delete failed. Check console.', 'error');
  }
}

/* ══════════════════════════════════════════════════════
   RECENT REPORTS — REALTIME via onSnapshot
   FIX: orderBy and date display now use 'reportedAt' — the actual
   field name written by image-view.js — not the non-existent 'createdAt'.
   The old orderBy('createdAt') caused Firestore to throw FirebaseError
   on the compound where()+orderBy() query, crashing this entire widget.
══════════════════════════════════════════════════════ */

function _subscribeRecentReports() {
  const listEl = document.getElementById('recent-reports-list');
  if (!listEl) return () => {};

  listEl.innerHTML = '<div class="admin-list-loading">Loading…</div>';

  const q = query(
    collection(db, 'reports'),
    where('status', '==', 'open'),
    orderBy('reportedAt', 'desc'),
    limit(5)
  );

  const unsub = onSnapshot(q, snap => {
    if (snap.empty) {
      listEl.innerHTML = '<div class="admin-list-empty">No open reports. 🎉</div>';
      return;
    }

    const REASON_LABELS = {
      spam:          'Spam',
      inappropriate: 'Inappropriate',
      copyright:     'Copyright',
      other:         'Other'
    };

    const rows = snap.docs.map(docSnap => {
      const d      = docSnap.data();
      const rid    = docSnap.id;
      const safeId = _esc(rid);
      const reason = REASON_LABELS[d.reason] ?? _esc(String(d.reason ?? 'Unknown'));
      const imgId  = _esc(d.imageId ?? '');
      const date   = _formatDate(d.reportedAt);

      const raw    = String(d.details ?? '').trim();
      const detail = raw.length > 0
        ? _esc(raw.slice(0, 80)) + (raw.length > 80 ? '…' : '')
        : '<span class="admin-list-hint">No additional details</span>';

      return `
        <div class="admin-list-item" id="report-row-${safeId}">
          <div class="admin-list-badge admin-badge-${_esc(d.reason ?? 'other')}"
               title="Report type: ${_esc(reason)}">
            ${_esc(reason)}
          </div>
          <div class="admin-list-meta">
            <span class="admin-list-name">${detail}</span>
            <span class="admin-list-date">
              ${date}${imgId ? ` &middot; Image&nbsp;<code>${imgId}</code>` : ''}
            </span>
          </div>
          <div class="admin-list-actions">
            <a class="admin-btn admin-btn-sm admin-btn-accent"
               href="/admin/reports.html?highlight=${safeId}"
               aria-label="Review report">Review</a>
          </div>
        </div>`.trim();
    });

    listEl.innerHTML = rows.join('\n');

  }, err => {
    console.error('[admin-dash] _subscribeRecentReports error:', err);
    listEl.innerHTML = '<div class="admin-list-error">Failed to load reports.</div>';
  });

  return unsub;
}

/* ══════════════════════════════════════════════════════
   INIT — Entry Point
══════════════════════════════════════════════════════ */

function initDashboard(user) {
  document.getElementById('admin-logout-btn')
    ?.addEventListener('click', handleAdminLogout);

  const emailEl = document.getElementById('admin-user-email');
  if (emailEl && user?.email) emailEl.textContent = user.email;

  const unsubStats         = _subscribeStats();
  const unsubRecentUploads = _subscribeRecentUploads();
  const unsubRecentReports = _subscribeRecentReports();

  return function unsubscribeAll() {
    unsubStats();
    unsubRecentUploads();
    unsubRecentReports();
  };
}

initAdminAuth((user) => {
  initDashboard(user);
});