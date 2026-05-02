// ============================================================
// admin-reports.js — File 24/43
// Imgify Admin Panel — Abuse Reports Manager
// ============================================================

import { initAdminAuth, handleAdminLogout } from './admin-auth.js';
import { db } from '../firebase-init.js';
import {
  collection,
  getDocs,
  doc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Helpers (self-contained) ─────────────────────────────────
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
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-PK', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  } catch {
    return '—';
  }
}

function _formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function _showToast(message, type = 'success') {
  const existing = document.getElementById('admin-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'admin-toast';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');

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

  Object.assign(toast.style, {
    position:     'fixed',
    bottom:       '24px',
    right:        '24px',
    padding:      '12px 18px',
    borderRadius: '8px',
    background:   colors[type] || colors.success,
    color:        textColors[type] || textColors.success,
    fontWeight:   '500',
    fontSize:     '13.5px',
    zIndex:       '9999',
    boxShadow:    '0 4px 16px rgba(0,0,0,0.12)',
    border:       `1px solid ${textColors[type] || textColors.success}33`,
    transition:   'opacity 0.3s ease',
    maxWidth:     '320px'
  });

  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── State ─────────────────────────────────────────────────────
let allReports = [];
let debounceTimer = null;

// ── Init ──────────────────────────────────────────────────────
initAdminAuth(async (user) => {
  setupLogout();
  setupFilters();
  await loadReports();
});

function setupLogout() {
  const btn = document.getElementById('logout-btn');
  if (btn) btn.addEventListener('click', handleAdminLogout);
}

// ── Load all reports from Firestore (once) ───────────────────
async function loadReports() {
  const tableBody  = document.getElementById('reports-table-body');
  const emptyState = document.getElementById('reports-empty');
  const errorState = document.getElementById('reports-error');
  const statsEl    = document.getElementById('reports-stats');
  const loadingEl  = document.getElementById('reports-loading');

  try {
    if (loadingEl) loadingEl.style.display = 'flex';
    if (tableBody) tableBody.innerHTML = '';

    const snap = await getDocs(collection(db, 'reports'));

    allReports = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (loadingEl) loadingEl.style.display = 'none';

    renderStats();
    applyFilters();
  } catch (err) {
    console.error('Failed to load reports:', err);
    if (loadingEl) loadingEl.style.display = 'none';
    if (errorState) {
      errorState.style.display = 'flex';
      errorState.innerHTML = `
        <div style="text-align:center;padding:48px 24px;">
          <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
          <p style="color:var(--text-muted);font-size:14px;">Failed to load reports. Check console for details.</p>
          <button onclick="window.location.reload()" style="margin-top:16px;padding:8px 18px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">Retry</button>
        </div>`;
    }
  }
}

// ── Stats row ─────────────────────────────────────────────────
function renderStats() {
  const statsEl = document.getElementById('reports-stats');
  if (!statsEl) return;

  const total      = allReports.length;
  const open       = allReports.filter(r => r.status === 'open').length;
  const resolved   = allReports.filter(r => r.status === 'resolved').length;
  const dismissed  = allReports.filter(r => r.status === 'dismissed').length;

  statsEl.innerHTML = `
    <div class="stat-card">
      <span class="stat-label">Total Reports</span>
      <span class="stat-value">${total}</span>
    </div>
    <div class="stat-card stat-card--warning">
      <span class="stat-label">Open</span>
      <span class="stat-value">${open}</span>
    </div>
    <div class="stat-card stat-card--success">
      <span class="stat-label">Resolved</span>
      <span class="stat-value">${resolved}</span>
    </div>
    <div class="stat-card stat-card--muted">
      <span class="stat-label">Dismissed</span>
      <span class="stat-value">${dismissed}</span>
    </div>
  `;
}

// ── Filters (client-side only) ────────────────────────────────
function setupFilters() {
  const statusFilter = document.getElementById('filter-status');
  const searchInput  = document.getElementById('search-input');

  if (statusFilter) statusFilter.addEventListener('change', applyFilters);

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilters, 350);
    });
  }
}

function applyFilters() {
  const statusFilter = document.getElementById('filter-status');
  const searchInput  = document.getElementById('search-input');

  const statusVal = statusFilter ? statusFilter.value : 'all';
  const searchVal = searchInput  ? searchInput.value.trim().toLowerCase() : '';

  let filtered = [...allReports];

  if (statusVal !== 'all') {
    filtered = filtered.filter(r => r.status === statusVal);
  }

  if (searchVal) {
    filtered = filtered.filter(r =>
      (r.imageName || '').toLowerCase().includes(searchVal) ||
      (r.reason    || '').toLowerCase().includes(searchVal)
    );
  }

  renderTable(filtered);
}

// ── Render table ──────────────────────────────────────────────
function renderTable(reports) {
  const tableBody  = document.getElementById('reports-table-body');
  const emptyState = document.getElementById('reports-empty');

  if (!tableBody) return;

  if (reports.length === 0) {
    tableBody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tableBody.innerHTML = reports.map(r => buildRow(r)).join('');
}

function buildRow(r) {
  const statusBadge = getStatusBadge(r.status);
  const thumb = r.thumbUrl
    ? `<img src="${_esc(r.thumbUrl)}" alt="Thumbnail for ${_esc(r.imageName)}" class="report-thumb" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22 viewBox=%220 0 48 48%22%3E%3Crect width=%2248%22 height=%2248%22 fill=%22%23eee%22/%3E%3Ctext x=%2224%22 y=%2228%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2212%22%3E?%3C/text%3E%3C/svg%3E'" />`
    : `<div class="report-thumb report-thumb--placeholder" aria-label="No thumbnail">?</div>`;

  return `
    <tr id="report-row-${_esc(r.id)}" data-report-id="${_esc(r.id)}">
      <td class="col-thumb">${thumb}</td>
      <td class="col-name">
        <span class="image-name" title="${_esc(r.imageName)}">${_esc(r.imageName) || '—'}</span>
        <span class="image-id">ID: ${_esc(r.imageId)}</span>
      </td>
      <td class="col-reason">
        <span class="reason-text" title="${_esc(r.reason)}">${_esc(r.reason) || '—'}</span>
      </td>
      <td class="col-date">${_formatDate(r.reportedAt)}</td>
      <td class="col-status">${statusBadge}</td>
      <td class="col-actions">
        <div class="action-group">
          <button
            class="btn-action btn-view"
            onclick="window.__viewImage('${_esc(r.imageId)}')"
            title="View public image page"
            aria-label="View image ${_esc(r.imageName)}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            View
          </button>
          <button
            class="btn-action btn-delete"
            onclick="window.__deleteImage('${_esc(r.id)}', '${_esc(r.imageId)}')"
            title="Soft-delete image and resolve report"
            aria-label="Delete image and resolve report"
            ${r.status === 'resolved' ? 'disabled' : ''}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
            Delete
          </button>
          <button
            class="btn-action btn-dismiss"
            onclick="window.__dismissReport('${_esc(r.id)}')"
            title="Dismiss this report"
            aria-label="Dismiss report"
            ${r.status !== 'open' ? 'disabled' : ''}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            Dismiss
          </button>
        </div>
      </td>
    </tr>
  `;
}

function getStatusBadge(status) {
  const map = {
    open:      `<span class="status-badge status-badge--open">Open</span>`,
    resolved:  `<span class="status-badge status-badge--resolved">Resolved</span>`,
    dismissed: `<span class="status-badge status-badge--dismissed">Dismissed</span>`
  };
  return map[status] || `<span class="status-badge status-badge--dismissed">${_esc(status)}</span>`;
}

// ── Update a row in-place ─────────────────────────────────────
function updateRowStatus(reportId, newStatus) {
  const idx = allReports.findIndex(r => r.id === reportId);
  if (idx !== -1) {
    allReports[idx].status = newStatus;
  }

  const row = document.getElementById(`report-row-${reportId}`);
  if (!row) return;

  const r = allReports[idx];
  if (!r) return;

  // Update status cell
  const statusCell = row.querySelector('.col-status');
  if (statusCell) statusCell.innerHTML = getStatusBadge(newStatus);

  // Update action buttons
  const btnDelete  = row.querySelector('.btn-delete');
  const btnDismiss = row.querySelector('.btn-dismiss');
  if (btnDelete)  btnDelete.disabled  = newStatus === 'resolved';
  if (btnDismiss) btnDismiss.disabled = newStatus !== 'open';

  renderStats();
}

// ── Global action handlers ────────────────────────────────────
window.__viewImage = function(imageId) {
  if (!imageId) return;
  window.open(`/i/${imageId}`, '_blank');
};

window.__deleteImage = async function(reportId, imageId) {
  if (!reportId || !imageId) return;

  const confirmed = window.confirm(
    'Delete this image? This marks the upload as deleted (soft delete) and resolves the report. This cannot be undone.'
  );
  if (!confirmed) return;

  const row = document.getElementById(`report-row-${reportId}`);
  if (row) row.style.opacity = '0.5';

  try {
    await Promise.allSettled([
      updateDoc(doc(db, 'uploads', imageId), { deleted: true }),
      updateDoc(doc(db, 'reports', reportId), { status: 'resolved' })
    ]);

    updateRowStatus(reportId, 'resolved');
    if (row) row.style.opacity = '1';
    _showToast('Image deleted and report resolved.', 'success');
  } catch (err) {
    console.error('Delete image failed:', err);
    if (row) row.style.opacity = '1';
    _showToast('Failed to delete image. Try again.', 'error');
  }
};

window.__dismissReport = async function(reportId) {
  if (!reportId) return;

  const row = document.getElementById(`report-row-${reportId}`);
  if (row) row.style.opacity = '0.5';

  try {
    await updateDoc(doc(db, 'reports', reportId), { status: 'dismissed' });
    updateRowStatus(reportId, 'dismissed');
    if (row) row.style.opacity = '1';
    _showToast('Report dismissed.', 'info');
  } catch (err) {
    console.error('Dismiss report failed:', err);
    if (row) row.style.opacity = '1';
    _showToast('Failed to dismiss report. Try again.', 'error');
  }
};
