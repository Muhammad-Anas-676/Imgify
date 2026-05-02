// public/js/admin/admin-analytics.js
// File 20/43 — Imgify Admin Advanced Analytics
// ─────────────────────────────────────────────

import { initAdminAuth, handleAdminLogout } from './admin-auth.js';
import { db } from '../firebase-init.js';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getCountFromServer,
  getAggregateFromServer,
  sum,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

function _formatBytes(n) {
  if (!n || isNaN(n)) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

function _showToast(message, type = 'info') {
  const existing = document.querySelector('.imgify-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'imgify-toast';
  toast.setAttribute('role', 'alert');
  toast.textContent = message;
  const colors = {
    success: 'var(--success)',
    error: 'var(--danger)',
    warning: 'var(--warning)',
    info: 'var(--accent)'
  };
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    background: colors[type] || colors.info,
    color: '#fff',
    padding: '12px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    zIndex: '9999',
    opacity: '0',
    transform: 'translateY(8px)',
    transition: 'opacity 0.25s ease, transform 0.25s ease',
    maxWidth: '320px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)'
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('imgify-toast-visible');
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ─── Lazy CDN Script Loader ──────────────────────────────────────────────────

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';

async function _ensureChartJs() {
  if (window.Chart) return;
  await _loadScript(CHART_JS_CDN);
}

// ─── Chart instances (kept for destroy on re-render) ─────────────────────────

const _charts = {};

function _destroyChart(key) {
  if (_charts[key]) {
    _charts[key].destroy();
    _charts[key] = null;
  }
}

// ─── Date Utilities ──────────────────────────────────────────────────────────

function _startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function _daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function _dayLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Stats Cards ─────────────────────────────────────────────────────────────

async function _loadStatsCards() {
  const results = await Promise.allSettled([
    // 1. Total views sum
    (async () => {
      const snap = await getAggregateFromServer(
        query(collection(db, 'uploads'), where('deleted', '==', false)),
        { totalViews: sum('views') }
      );
      return snap.data().totalViews ?? 0;
    })(),

    // 2. Most viewed image
    (async () => {
      const snap = await getDocs(
        query(
          collection(db, 'uploads'),
          where('deleted', '==', false),
          orderBy('views', 'desc'),
          limit(1)
        )
      );
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    })(),

    // 3. Password-protected count
    (async () => {
      const snap = await getCountFromServer(
        query(
          collection(db, 'uploads'),
          where('deleted', '==', false),
          where('isPasswordProtected', '==', true)
        )
      );
      return snap.data().count;
    })(),

    // 4. Custom slug count
    (async () => {
      const snap = await getCountFromServer(collection(db, 'customSlugs'));
      return snap.data().count;
    })(),

    // 5. Albums count
    (async () => {
      const snap = await getCountFromServer(
        query(collection(db, 'albums'), where('deleted', '==', false))
      );
      return snap.data().count;
    })()
  ]);

  // Total views
  const tvEl = document.getElementById('stat-total-views');
  if (tvEl) {
    tvEl.textContent = results[0].status === 'fulfilled'
      ? Number(results[0].value).toLocaleString()
      : '—';
  }

  // Most viewed card
  const mvCard = document.getElementById('most-viewed-card');
  if (mvCard) {
    if (results[1].status === 'fulfilled' && results[1].value) {
      const img = results[1].value;
      mvCard.innerHTML = `
        <div class="analytics-mv-inner">
          <img
            src="${_esc(img.thumbnailUrl || img.url || '')}"
            alt="${_esc(img.name || 'Image')}"
            class="analytics-mv-thumb"
            onerror="this.src=''"
          />
          <div class="analytics-mv-info">
            <p class="analytics-mv-name">${_esc(img.name || img.id)}</p>
            <p class="analytics-mv-views">${Number(img.views || 0).toLocaleString()} views</p>
            <a href="/i/${_esc(img.customSlug || img.id)}" target="_blank" rel="noopener" class="analytics-mv-link">View Image ↗</a>
          </div>
        </div>`;
    } else {
      mvCard.textContent = 'No data';
    }
  }

  // Password-protected count
  const pwEl = document.getElementById('stat-pw-count');
  if (pwEl) {
    pwEl.textContent = results[2].status === 'fulfilled'
      ? Number(results[2].value).toLocaleString()
      : '—';
  }

  // Custom slug count
  const slugEl = document.getElementById('stat-slug-count');
  if (slugEl) {
    slugEl.textContent = results[3].status === 'fulfilled'
      ? Number(results[3].value).toLocaleString()
      : '—';
  }

  // Albums count
  const albumEl = document.getElementById('stat-album-count');
  if (albumEl) {
    albumEl.textContent = results[4].status === 'fulfilled'
      ? Number(results[4].value).toLocaleString()
      : '—';
  }
}

// ─── Top 10 Most Viewed Images ───────────────────────────────────────────────

async function _loadTopImages() {
  const container = document.getElementById('top-images-list');
  if (!container) return;

  container.innerHTML = '<p class="analytics-loading">Loading…</p>';

  try {
    const snap = await getDocs(
      query(
        collection(db, 'uploads'),
        where('deleted', '==', false),
        orderBy('views', 'desc'),
        limit(10)
      )
    );

    if (snap.empty) {
      container.innerHTML = '<p class="analytics-empty">No uploads yet.</p>';
      return;
    }

    const rows = snap.docs.map((doc, i) => {
      const d = doc.data();
      const rank = i + 1;
      const thumb = d.thumbnailUrl || d.url || '';
      const name = _esc(d.name || doc.id);
      const views = Number(d.views || 0).toLocaleString();
      const date = _formatDate(d.createdAt);
      const href = `/i/${_esc(d.customSlug || doc.id)}`;
      return `
        <tr class="analytics-top-row">
          <td class="analytics-rank">${rank}</td>
          <td class="analytics-thumb-cell">
            ${thumb
              ? `<img src="${_esc(thumb)}" alt="${name}" class="analytics-row-thumb" onerror="this.style.display='none'" />`
              : '<span class="analytics-no-thumb">—</span>'
            }
          </td>
          <td class="analytics-name-cell">
            <span class="analytics-img-name">${name}</span>
          </td>
          <td class="analytics-views-cell">${views}</td>
          <td class="analytics-date-cell">${_esc(date)}</td>
          <td class="analytics-link-cell">
            <a href="${href}" target="_blank" rel="noopener" class="analytics-view-link" aria-label="View image ${name}">↗</a>
          </td>
        </tr>`;
    }).join('');

    container.innerHTML = `
      <table class="analytics-top-table" aria-label="Top 10 most viewed images">
        <thead>
          <tr>
            <th>#</th>
            <th>Thumb</th>
            <th>Name</th>
            <th>Views</th>
            <th>Uploaded</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    console.error('Top images error:', err);
    container.innerHTML = '<p class="analytics-error">Failed to load top images.</p>';
  }
}

// ─── Upload Trend Chart (Day/Week/Month) ─────────────────────────────────────

let _activeTrendTab = 'day';

async function _loadUploadTrend(period = 'day') {
  _activeTrendTab = period;
  const canvas = document.getElementById('chart-upload-trend');
  if (!canvas) return;

  const wrapper = canvas.parentElement;
  const loader = wrapper?.querySelector?.('.chart-loader');
  if (loader) loader.style.display = 'block';

  try {
    await _ensureChartJs();

    let labels = [];
    let counts = [];
    const now = new Date();

    if (period === 'day') {
      // Last 14 days — group by day
      const since = _daysAgo(13);
      const snap = await getDocs(
        query(
          collection(db, 'uploads'),
          where('deleted', '==', false),
          where('createdAt', '>=', Timestamp.fromDate(since))
        )
      );

      const map = {};
      for (let i = 13; i >= 0; i--) {
        const d = _daysAgo(i);
        const key = _dayLabel(d);
        labels.push(key);
        map[key] = 0;
      }
      snap.forEach(doc => {
        const d = doc.data();
        if (d.createdAt) {
          const key = _dayLabel(d.createdAt.toDate());
          if (key in map) map[key]++;
        }
      });
      counts = labels.map(l => map[l]);

    } else if (period === 'week') {
      // Last 8 weeks — group by ISO week
      const since = _daysAgo(55);
      const snap = await getDocs(
        query(
          collection(db, 'uploads'),
          where('deleted', '==', false),
          where('createdAt', '>=', Timestamp.fromDate(since))
        )
      );

      const map = {};
      for (let i = 7; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i * 7);
        const weekStart = _startOfDay(d);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const key = _dayLabel(weekStart);
        if (!labels.includes(key)) {
          labels.push(key);
          map[key] = 0;
        }
      }
      snap.forEach(doc => {
        const d = doc.data();
        if (d.createdAt) {
          const date = d.createdAt.toDate();
          const ws = _startOfDay(date);
          ws.setDate(ws.getDate() - ws.getDay());
          const key = _dayLabel(ws);
          if (key in map) map[key]++;
        }
      });
      counts = labels.map(l => map[l]);

    } else {
      // Last 6 months — group by month
      const since = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const snap = await getDocs(
        query(
          collection(db, 'uploads'),
          where('deleted', '==', false),
          where('createdAt', '>=', Timestamp.fromDate(since))
        )
      );

      const map = {};
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        labels.push(key);
        map[key] = 0;
      }
      snap.forEach(doc => {
        const d = doc.data();
        if (d.createdAt) {
          const date = d.createdAt.toDate();
          const key = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          if (key in map) map[key]++;
        }
      });
      counts = labels.map(l => map[l]);
    }

    _destroyChart('uploadTrend');
    _charts.uploadTrend = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Uploads',
          data: counts,
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1a56db',
          backgroundColor: 'rgba(26,86,219,0.08)',
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: 'rgba(128,128,128,0.1)' }
          },
          x: {
            grid: { display: false }
          }
        }
      }
    });
  } catch (err) {
    console.error('Upload trend chart error:', err);
    if (loader) loader.style.display = 'none';
    const errEl = wrapper?.querySelector?.('.chart-error');
    if (errEl) errEl.style.display = 'block';
    return;
  }

  if (loader) loader.style.display = 'none';
}

// ─── File Type Breakdown (Doughnut) ─────────────────────────────────────────

async function _loadFileTypeChart() {
  const canvas = document.getElementById('chart-file-types');
  if (!canvas) return;

  try {
    await _ensureChartJs();

    const snap = await getDocs(
      query(collection(db, 'uploads'), where('deleted', '==', false))
    );

    const counts = { JPEG: 0, PNG: 0, GIF: 0, WebP: 0, Other: 0 };
    snap.forEach(doc => {
      const mime = (doc.data().mimeType || '').toLowerCase();
      if (mime.includes('jpeg') || mime.includes('jpg')) counts.JPEG++;
      else if (mime.includes('png')) counts.PNG++;
      else if (mime.includes('gif')) counts.GIF++;
      else if (mime.includes('webp')) counts.WebP++;
      else counts.Other++;
    });

    _destroyChart('fileTypes');
    _charts.fileTypes = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: Object.keys(counts),
        datasets: [{
          data: Object.values(counts),
          backgroundColor: [
            '#1a56db',
            '#16a34a',
            '#d97706',
            '#7c3aed',
            '#dc2626'
          ],
          borderWidth: 2,
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { padding: 16, font: { size: 13 } }
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString()} (${
                snap.size ? ((ctx.parsed / snap.size) * 100).toFixed(1) : 0
              }%)`
            }
          }
        },
        cutout: '62%'
      }
    });
  } catch (err) {
    console.error('File type chart error:', err);
    const wrapper = canvas.parentElement;
    const errEl = wrapper?.querySelector?.('.chart-error');
    if (errEl) errEl.style.display = 'block';
  }
}

// ─── Daily Views Trend Chart ─────────────────────────────────────────────────

async function _loadViewsTrendChart() {
  const canvas = document.getElementById('chart-views-trend');
  if (!canvas) return;

  try {
    await _ensureChartJs();

    const since = _daysAgo(13);
    const snap = await getDocs(
      query(
        collection(db, 'uploads'),
        where('deleted', '==', false),
        where('createdAt', '>=', Timestamp.fromDate(since))
      )
    );

    const labels = [];
    const map = {};
    for (let i = 13; i >= 0; i--) {
      const d = _daysAgo(i);
      const key = _dayLabel(d);
      labels.push(key);
      map[key] = 0;
    }

    snap.forEach(doc => {
      const d = doc.data();
      if (d.createdAt && d.views) {
        const key = _dayLabel(d.createdAt.toDate());
        if (key in map) map[key] += Number(d.views || 0);
      }
    });

    const viewCounts = labels.map(l => map[l]);

    _destroyChart('viewsTrend');
    _charts.viewsTrend = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Views',
          data: viewCounts,
          borderColor: '#16a34a',
          backgroundColor: 'rgba(22,163,74,0.08)',
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: 'rgba(128,128,128,0.1)' }
          },
          x: { grid: { display: false } }
        }
      }
    });
  } catch (err) {
    console.error('Views trend chart error:', err);
    const wrapper = canvas.parentElement;
    const errEl = wrapper?.querySelector?.('.chart-error');
    if (errEl) errEl.style.display = 'block';
  }
}

// ─── Geographic Placeholder ───────────────────────────────────────────────────

function _renderGeoPlaceholder() {
  const el = document.getElementById('geo-placeholder');
  if (!el) return;

  el.innerHTML = `
    <div class="geo-placeholder-inner" aria-label="Geographic data placeholder">
      <div class="geo-map-svg">
        <svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="img">
          <rect width="400" height="200" rx="8" fill="var(--bg-tertiary)" />
          <!-- Simplified continents — decorative placeholder -->
          <!-- North America -->
          <path d="M60 40 Q80 30 100 45 Q120 60 115 90 Q100 110 80 105 Q55 100 50 70 Z"
                fill="var(--border-strong)" opacity="0.6"/>
          <!-- South America -->
          <path d="M90 115 Q105 110 115 125 Q120 150 108 170 Q90 180 78 165 Q65 145 72 125 Z"
                fill="var(--border-strong)" opacity="0.6"/>
          <!-- Europe -->
          <path d="M168 35 Q188 28 200 42 Q208 55 200 70 Q188 78 170 72 Q155 62 158 47 Z"
                fill="var(--border-strong)" opacity="0.6"/>
          <!-- Africa -->
          <path d="M168 82 Q188 78 198 98 Q205 125 195 155 Q180 172 162 160 Q145 140 148 110 Q152 88 168 82 Z"
                fill="var(--border-strong)" opacity="0.6"/>
          <!-- Asia -->
          <path d="M208 25 Q260 18 300 35 Q330 50 325 80 Q310 105 270 100 Q230 95 210 75 Q198 55 208 25 Z"
                fill="var(--border-strong)" opacity="0.6"/>
          <!-- Australia -->
          <path d="M295 125 Q322 118 335 135 Q345 155 332 168 Q312 178 295 163 Q280 145 285 130 Z"
                fill="var(--border-strong)" opacity="0.6"/>
          <!-- Overlay badge -->
          <rect x="130" y="78" width="140" height="44" rx="6" fill="var(--bg-primary)" opacity="0.92"/>
          <text x="200" y="97" text-anchor="middle" font-family="DM Sans, sans-serif"
                font-size="11" fill="var(--text-muted)" font-weight="600" letter-spacing="0.05em">
            COMING IN V2
          </text>
          <text x="200" y="113" text-anchor="middle" font-family="DM Sans, sans-serif"
                font-size="9.5" fill="var(--text-hint)">
            IP Geolocation
          </text>
        </svg>
      </div>
      <p class="geo-note">
        Geographic distribution requires IP geolocation via a Cloud Function — planned for v2.<br>
        The layout slot is reserved and ready for drop-in upgrade.
      </p>
    </div>`;
}

// ─── Tab Toggle Wiring ────────────────────────────────────────────────────────

function _wireTabToggles() {
  const tabs = ['day', 'week', 'month'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-${t}`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      tabs.forEach(id => {
        const el = document.getElementById(`tab-${id}`);
        if (el) {
          el.classList.toggle('active', id === t);
          el.setAttribute('aria-selected', id === t ? 'true' : 'false');
        }
      });
      _loadUploadTrend(t);
    });
  });
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

initAdminAuth(async (user) => {
  // Logout button
  document.getElementById('admin-logout-btn')
    ?.addEventListener('click', handleAdminLogout);

  // Wire trend tab toggles first (sync, no await)
  _wireTabToggles();

  // Geo placeholder (sync)
  _renderGeoPlaceholder();

  // Run all async sections in parallel — one failure never blocks others
  const [statsResult, topImagesResult, uploadTrendResult, fileTypesResult, viewsTrendResult] =
    await Promise.allSettled([
      _loadStatsCards(),
      _loadTopImages(),
      _loadUploadTrend('day'),
      _loadFileTypeChart(),
      _loadViewsTrendChart()
    ]);

  // Log any section-level failures without crashing the page
  if (statsResult.status === 'rejected') {
    console.error('Stats cards failed:', statsResult.reason);
    _showToast('Some stat cards failed to load.', 'warning');
  }
  if (topImagesResult.status === 'rejected') {
    console.error('Top images failed:', topImagesResult.reason);
  }
  if (uploadTrendResult.status === 'rejected') {
    console.error('Upload trend failed:', uploadTrendResult.reason);
  }
  if (fileTypesResult.status === 'rejected') {
    console.error('File type chart failed:', fileTypesResult.reason);
  }
  if (viewsTrendResult.status === 'rejected') {
    console.error('Views trend failed:', viewsTrendResult.reason);
  }
});
