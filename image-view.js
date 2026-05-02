/**
 * image-view.js
 * Public image view page logic — File 16/43
 * Handles: slug resolution, expiry, password gate, view counter,
 * auto-delete, OG meta, 5 URL formats, QR panel, report button
 */

import { db } from './firebase-init.js';
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  increment,
  serverTimestamp   // FIX: kept — still used in setupReportButton for reportedAt
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { generateQRCode, downloadQRCode } from './qrcode-helper.js';

// ─── State ───────────────────────────────────────────────────────────────────
let _imageDoc   = null;  // Firestore document data
let _imageId    = null;  // resolved imageId
let _primaryUrl = null;  // canonical URL shown to user
let _qrFg       = '#000000';
let _qrBg       = '#ffffff';
let _qrSize     = 200;
let _pwAttempts = 0;
const QR_CONTAINER_ID = 'iv-qr-canvas';

// ─── XSS-safe escape (same pattern as dashboard.js) ──────────────────────────
function _esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  let toast = document.querySelector('.imgify-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'imgify-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `imgify-toast imgify-toast-visible imgify-toast-${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('imgify-toast-visible');
  }, 3200);
}

// ─── Redirects ────────────────────────────────────────────────────────────────
function goTo404()      { window.location.href = '/404.html'; }
function goToExpired()  { window.location.href = '/expired.html'; }

// ─── Format helpers ──────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}

function trunc(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

// ─── Copy to clipboard ───────────────────────────────────────────────────────
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
  } catch {
    showToast('Copy failed — please copy manually.', 'error');
  }
}

// ─── SHA-256 via SubtleCrypto ─────────────────────────────────────────────────
async function sha256hex(str) {
  const enc    = new TextEncoder();
  const buf    = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── OG meta tag injection ───────────────────────────────────────────────────
function injectOGMeta(data, canonicalUrl) {
  const setMeta = (prop, val) => {
    let el = document.querySelector(`meta[property="${prop}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('property', prop);
      document.head.appendChild(el);
    }
    el.setAttribute('content', val || '');
  };
  const title = data.customName  || 'Imgify Image';
  const desc  = data.description || 'Shared via imgify.site — free image hosting';
  const img   = data.imgbbThumbUrl || data.imgbbUrl || '';

  setMeta('og:title',       title);
  setMeta('og:description', desc);
  setMeta('og:image',       img);
  setMeta('og:url',         canonicalUrl);
  setMeta('og:site_name',   'Imgify');
  setMeta('og:type',        'website');

  // Also update <title>
  document.title = `${title} — Imgify`;
}

// ─── OG Preview Card render ───────────────────────────────────────────────────
function renderOGPreview(data) {
  const title = _esc(trunc(data.customName  || 'Imgify Image', 60));
  const desc  = _esc(trunc(data.description || 'Shared via imgify.site — free image hosting', 100));
  const thumb = _esc(data.imgbbThumbUrl || data.imgbbUrl || '');

  const wrap = document.getElementById('iv-og-preview');
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="og-tabs">
      <button class="og-tab active" data-platform="whatsapp" onclick="window.__ivOGTab(this,'whatsapp')">WhatsApp</button>
      <button class="og-tab" data-platform="twitter"  onclick="window.__ivOGTab(this,'twitter')">Twitter / X</button>
      <button class="og-tab" data-platform="facebook" onclick="window.__ivOGTab(this,'facebook')">Facebook</button>
    </div>

    <div class="og-card og-whatsapp" id="og-whatsapp">
      <img src="${thumb}" class="og-thumb" alt="thumbnail" loading="lazy">
      <div class="og-text">
        <div class="og-title">${title}</div>
        <div class="og-desc">${desc}</div>
        <div class="og-domain">🌐 imgify.site</div>
      </div>
    </div>

    <div class="og-card og-twitter" id="og-twitter" hidden>
      <img src="${thumb}" class="og-hero-img" alt="thumbnail" loading="lazy">
      <div class="og-body">
        <div class="og-title">${title}</div>
        <div class="og-desc">${desc}</div>
        <div class="og-domain">🌐 imgify.site</div>
      </div>
    </div>

    <div class="og-card og-facebook" id="og-facebook" hidden>
      <img src="${thumb}" class="og-hero-img" alt="thumbnail" loading="lazy">
      <div class="og-body">
        <div class="og-domain-upper">IMGIFY.SITE</div>
        <div class="og-title">${title}</div>
        <div class="og-desc">${desc}</div>
      </div>
    </div>
  `;
}

window.__ivOGTab = function(btn, platform) {
  document.querySelectorAll('.og-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  ['whatsapp','twitter','facebook'].forEach(p => {
    const card = document.getElementById(`og-${p}`);
    if (card) card.hidden = (p !== platform);
  });
};

// ─── QR Panel ─────────────────────────────────────────────────────────────────
async function renderQRPanel(url, name) {
  const panel = document.getElementById('iv-qr-panel');
  if (!panel) return;

  panel.innerHTML = `
    <div class="qr-panel">
      <div id="${QR_CONTAINER_ID}" class="qr-canvas-wrap" aria-label="QR code"></div>
      <div class="qr-controls">
        <label class="qr-control-label">
          <span>QR Color</span>
          <input type="color" id="iv-qr-fg" value="${_qrFg}" aria-label="QR foreground color">
        </label>
        <label class="qr-control-label">
          <span>Background</span>
          <input type="color" id="iv-qr-bg" value="${_qrBg}" aria-label="QR background color">
        </label>
        <div class="size-seg" role="group" aria-label="QR size">
          <button class="size-btn active" data-size="128" onclick="window.__ivQRSize(this,128)">S</button>
          <button class="size-btn" data-size="200" onclick="window.__ivQRSize(this,200)">M</button>
          <button class="size-btn" data-size="300" onclick="window.__ivQRSize(this,300)">L</button>
        </div>
      </div>
      <button class="btn btn-secondary" onclick="window.__ivQRDownload()" aria-label="Download QR code as PNG">
        ⬇ Download QR PNG
      </button>
    </div>
  `;

  // Generate initial QR
  await generateQRCode(QR_CONTAINER_ID, url, { fg: _qrFg, bg: _qrBg, size: _qrSize });

  // Debounced color regeneration
  let _debTimer;
  const regenQR = () => {
    clearTimeout(_debTimer);
    _debTimer = setTimeout(async () => {
      await generateQRCode(QR_CONTAINER_ID, url, { fg: _qrFg, bg: _qrBg, size: _qrSize });
    }, 300);
  };

  document.getElementById('iv-qr-fg').addEventListener('input', e => {
    _qrFg = e.target.value; regenQR();
  });
  document.getElementById('iv-qr-bg').addEventListener('input', e => {
    _qrBg = e.target.value; regenQR();
  });

  // Store url+name for download closure
  window.__ivQRUrl  = url;
  window.__ivQRName = name;
}

window.__ivQRSize = async function(btn, size) {
  _qrSize = size;
  document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  await generateQRCode(QR_CONTAINER_ID, window.__ivQRUrl, { fg: _qrFg, bg: _qrBg, size });
};

window.__ivQRDownload = function() {
  downloadQRCode(QR_CONTAINER_ID, (window.__ivQRName || 'imgify') + '-qr');
};

// ─── URL Copy Formats ─────────────────────────────────────────────────────────
function renderURLFormats(data, primaryUrl) {
  const container = document.getElementById('iv-url-formats');
  if (!container) return;

  const name    = data.customName || 'image';
  const fullUrl = data.imgbbUrl   || primaryUrl;
  const thumb   = data.imgbbThumbUrl || fullUrl;

  const formats = [
    { label: 'Direct Link',    value: primaryUrl,                                     icon: '🔗' },
    { label: 'HTML Embed',     value: `<img src="${fullUrl}" alt="${name}">`,           icon: '🖼' },
    { label: 'Markdown',       value: `![${name}](${primaryUrl})`,                    icon: '📝' },
    { label: 'BBCode',         value: `[img]${fullUrl}[/img]`,                        icon: '📋' },
    { label: 'Thumbnail URL',  value: thumb,                                           icon: '🔍' },
  ];

  container.innerHTML = formats.map((f, i) => `
    <div class="url-format-row">
      <span class="url-format-label">${f.icon} ${_esc(f.label)}</span>
      <input type="text" class="url-input" value="${_esc(f.value)}" readonly
             aria-label="${_esc(f.label)} URL" id="url-fmt-${i}">
      <button class="btn btn-secondary btn-sm copy-btn"
              onclick="window.__ivCopy(${i},'url-fmt-${i}')"
              aria-label="Copy ${_esc(f.label)}">Copy</button>
    </div>
  `).join('');
}

window.__ivCopy = async function(_, inputId) {
  const inp = document.getElementById(inputId);
  const btn = inp?.nextElementSibling;
  if (inp && btn) await copyText(inp.value, btn);
};

// ─── Report Button ────────────────────────────────────────────────────────────
function setupReportButton() {
  const btn = document.getElementById('iv-report-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const reasons = [
      'Abusive/Harmful Content',
      'Copyright Infringement',
      'Spam or Scam',
      'Explicit/Adult Content',
      'Other'
    ];
    const reasonStr = prompt(
      `Report this image?\n\nSelect a reason:\n${reasons.map((r,i)=>`${i+1}. ${r}`).join('\n')}\n\nEnter number:`
    );
    if (!reasonStr) return;
    const idx    = parseInt(reasonStr, 10) - 1;
    const reason = reasons[idx] || reasons[4];

    try {
      const reportId = Math.random().toString(36).slice(2, 10);
      await addDoc(collection(db, 'reports'), {
        reportId,
        imageId:   _imageId,
        imageName: _imageDoc?.customName || null,
        imageUrl:  _imageDoc?.imgbbUrl   || null,
        reason,
        status:    'open',
        reportedAt: serverTimestamp()  // serverTimestamp legitimately used here
      });
      btn.disabled    = true;
      btn.textContent = '✓ Reported';
      showToast('Report submitted. Our team will review it.', 'success');
    } catch (err) {
      console.error('[image-view] report error:', err);
      showToast('Failed to submit report. Please try again.', 'error');
    }
  });
}

// ─── Render Full Image View ───────────────────────────────────────────────────
async function renderImageView(data, primaryUrl) {
  const container = document.getElementById('iv-main');
  if (!container) return;

  const tags = Array.isArray(data.tags) ? data.tags : [];

  container.innerHTML = `
    <div class="iv-image-wrap">
      <img
        src="${_esc(data.imgbbUrl)}"
        alt="${_esc(data.customName || 'Image')}"
        class="iv-full-image"
        loading="eager"
      >
    </div>

    <div class="iv-meta-card card">
      <div class="iv-meta-grid">
        <div class="iv-meta-cell">
          <span class="iv-meta-label">File Name</span>
          <span class="iv-meta-value">${_esc(data.customName || '—')}</span>
        </div>
        <div class="iv-meta-cell">
          <span class="iv-meta-label">File Size</span>
          <span class="iv-meta-value">${formatBytes(data.fileSize)}</span>
        </div>
        <div class="iv-meta-cell">
          <span class="iv-meta-label">Uploaded</span>
          <span class="iv-meta-value">${formatDate(data.createdAt)}</span>
        </div>
        <div class="iv-meta-cell">
          <span class="iv-meta-label">Views</span>
          <span class="iv-meta-value">${data.views ?? 0}</span>
        </div>
        ${data.privacy ? `
        <div class="iv-meta-cell">
          <span class="iv-meta-label">Privacy</span>
          <span class="iv-meta-value badge badge-${data.privacy === 'public' ? 'success' : 'warning'}">
            ${_esc(data.privacy)}
          </span>
        </div>` : ''}
        ${data.isPasswordProtected ? `
        <div class="iv-meta-cell">
          <span class="iv-meta-label">Protection</span>
          <span class="iv-meta-value badge badge-danger">🔒 Password</span>
        </div>` : ''}
      </div>

      ${data.description ? `
      <div class="iv-description">
        <span class="iv-meta-label">Description</span>
        <p>${_esc(data.description)}</p>
      </div>` : ''}

      ${tags.length ? `
      <div class="iv-tags">
        ${tags.map(t => `<span class="tag-pill">${_esc(t)}</span>`).join('')}
      </div>` : ''}
    </div>

    <div class="iv-section card">
      <h2 class="iv-section-title">Share This Image</h2>
      <div id="iv-url-formats" class="iv-url-formats"></div>
    </div>

    <div class="iv-section card">
      <h2 class="iv-section-title">QR Code</h2>
      <div id="iv-qr-panel"></div>
    </div>

    <div class="iv-section card">
      <h2 class="iv-section-title">Preview Card</h2>
      <p class="iv-section-hint">See how this image looks when shared.</p>
      <div id="iv-og-preview" class="og-preview-wrap"></div>
    </div>

    <div class="iv-actions">
      <a href="${_esc(data.imgbbUrl)}" download class="btn btn-secondary" aria-label="Download image">
        ⬇ Download Image
      </a>
      <button id="iv-report-btn" class="btn btn-danger-outline" aria-label="Report this image">
        ⚑ Report
      </button>
    </div>

    <div id="ad-content" class="ad-slot"></div>
  `;

  // Render sub-sections
  renderURLFormats(data, primaryUrl);
  renderOGPreview(data);
  setupReportButton();

  // QR panel (async — generates QR)
  await renderQRPanel(primaryUrl, data.customName || 'imgify');
}

// ─── "Image No Longer Available" UI ──────────────────────────────────────────
// FIX: Replaces the blocked Firestore deleted:true write for autoDelete threshold
function showImageUnavailable() {
  const container = document.getElementById('iv-main');
  if (!container) return;
  container.innerHTML = `
    <div class="iv-unavailable" role="alert" style="
      text-align:center;
      padding:4rem 2rem;
      font-family:var(--font-body);
    ">
      <div style="font-size:3rem;margin-bottom:1rem;">🚫</div>
      <h2 style="font-family:var(--font-display);margin-bottom:0.5rem;">
        Image No Longer Available
      </h2>
      <p style="color:var(--text-secondary);">
        This image has reached its maximum view limit and is no longer accessible.
      </p>
      <a href="/" class="btn btn-primary" style="margin-top:1.5rem;">
        Upload a New Image
      </a>
    </div>
  `;
}

// ─── Password Gate ────────────────────────────────────────────────────────────
function getLockoutKey()  { return `imgify-pw-lockout-${_imageId}`; }
function getAttemptsKey() { return `imgify-pw-attempts-${_imageId}`; }

function isLockedOut() {
  const lockoutTs = parseInt(localStorage.getItem(getLockoutKey()) || '0', 10);
  return lockoutTs > Date.now();
}

function getLockoutRemaining() {
  const lockoutTs = parseInt(localStorage.getItem(getLockoutKey()) || '0', 10);
  return Math.max(0, Math.ceil((lockoutTs - Date.now()) / 1000));
}

function renderPasswordGate() {
  const container = document.getElementById('iv-main');
  if (!container) return;

  const locked = isLockedOut();

  container.innerHTML = `
    <div class="password-overlay" id="pw-overlay">
      <div class="password-card" role="dialog" aria-labelledby="pw-title">
        <div class="pw-icon">🔒</div>
        <h2 id="pw-title">Password Protected</h2>
        <p>Enter the password to view this image.</p>
        <div class="pw-input-wrap">
          <input
            type="password"
            id="pw-input"
            placeholder="Enter password"
            autocomplete="current-password"
            aria-label="Image password"
            ${locked ? 'disabled' : ''}
          >
          <button
            id="pw-submit"
            class="btn btn-primary"
            onclick="window.__ivVerifyPW()"
            aria-label="Unlock image"
            ${locked ? 'disabled' : ''}
          >Unlock</button>
        </div>
        <p id="pw-error" class="pw-error" aria-live="polite" hidden></p>
        ${locked ? `<p class="pw-lockout">Too many attempts. Try again in <span id="pw-countdown">${getLockoutRemaining()}</span>s.</p>` : ''}
      </div>
    </div>
  `;

  // Enter key support
  document.getElementById('pw-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') window.__ivVerifyPW();
  });

  // Lockout countdown
  if (locked) {
    const tick = setInterval(() => {
      const rem = getLockoutRemaining();
      const el  = document.getElementById('pw-countdown');
      if (el) el.textContent = rem;
      if (rem <= 0) {
        clearInterval(tick);
        renderPasswordGate(); // re-render unlocked state
      }
    }, 1000);
  }
}

function shakeInput() {
  const inp = document.getElementById('pw-input');
  if (!inp) return;
  inp.classList.remove('shake');
  void inp.offsetWidth; // reflow
  inp.classList.add('shake');
}

window.__ivVerifyPW = async function() {
  if (isLockedOut()) return;
  const pwInput = document.getElementById('pw-input');
  const pwError = document.getElementById('pw-error');
  if (!pwInput) return;

  const entered = pwInput.value.trim();
  if (!entered) {
    if (pwError) { pwError.textContent = 'Please enter a password.'; pwError.hidden = false; }
    return;
  }

  const hash = await sha256hex(entered);
  if (hash === _imageDoc.passwordHash) {
    // ✅ Correct
    localStorage.removeItem(getAttemptsKey());
    localStorage.removeItem(getLockoutKey());
    await renderImageView(_imageDoc, _primaryUrl);
    injectOGMeta(_imageDoc, _primaryUrl);
  } else {
    // ❌ Wrong
    _pwAttempts++;
    const attemptsKey = getAttemptsKey();
    const stored      = parseInt(localStorage.getItem(attemptsKey) || '0', 10) + 1;
    localStorage.setItem(attemptsKey, stored);

    shakeInput();
    pwInput.value = '';

    const remaining = 3 - stored;
    if (remaining <= 0) {
      localStorage.setItem(getLockoutKey(), Date.now() + 30000);
      localStorage.removeItem(attemptsKey);
      renderPasswordGate();
    } else {
      if (pwError) {
        pwError.textContent = `Incorrect password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`;
        pwError.hidden = false;
      }
    }
  }
};

// ─── View Counter + Auto-Delete ───────────────────────────────────────────────
async function incrementViews(imageId, data) {
  try {
    // FIX: Only send { views: increment(1) } — stripped updatedAt, deleted, deletedAt
    // Firestore rule: affectedKeys().hasOnly(['views']) — extra fields cause permission-denied
    await updateDoc(doc(db, 'uploads', imageId), {
      views: increment(1)
    });

    // Update local copy so displayed view count is accurate
    const newViews = (data.views || 0) + 1;
    _imageDoc = { ..._imageDoc, views: newViews };

    // FIX: Auto-delete graceful fallback — public users cannot write deleted:true per rules.
    // Show "unavailable" UI instead of attempting the blocked Firestore write.
    if (data.autoDeleteAfterViews && newViews >= data.autoDeleteAfterViews) {
      console.warn(
        `[image-view] Image "${imageId}" has reached its autoDelete threshold ` +
        `(${newViews}/${data.autoDeleteAfterViews} views). ` +
        `Soft-delete requires admin action or a Cloud Function (planned for v2).`
      );
      showImageUnavailable();
    }
  } catch (err) {
    // Silent fail — view counter is non-critical UX
    console.error('[image-view] view increment error:', err);
  }
}

// ─── Not Found handler ────────────────────────────────────────────────────────
function showNotFound() {
  goTo404();
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
export async function initImageView() {
  // 1. Resolve imageId from ?id= or /i/{slug}
  const urlParams = new URLSearchParams(window.location.search);
  let imageId     = urlParams.get('id');

  if (!imageId) {
    // Try slug path: /i/my-photo  (firebase.json rewrites /i/** → image.html)
    const pathParts     = window.location.pathname.split('/').filter(Boolean);
    const potentialSlug = pathParts[pathParts.length - 1];

    if (potentialSlug && potentialSlug !== 'image.html') {
      try {
        const slugDoc = await getDoc(doc(db, 'customSlugs', potentialSlug));
        if (slugDoc.exists()) {
          imageId = slugDoc.data().imageId;
        } else {
          showNotFound(); return;
        }
      } catch (err) {
        console.error('[image-view] slug lookup error:', err);
        showNotFound(); return;
      }
    }
  }

  if (!imageId) { showNotFound(); return; }
  _imageId = imageId;

  // 2. Fetch Firestore document
  let snap;
  try {
    snap = await getDoc(doc(db, 'uploads', imageId));
  } catch (err) {
    console.error('[image-view] Firestore fetch error:', err);
    showNotFound(); return;
  }

  if (!snap.exists()) { showNotFound(); return; }

  const data = snap.data();
  _imageDoc  = data;

  // 3. Deleted check
  if (data.deleted === true) { showNotFound(); return; }

  // 4. Expiry check
  if (data.expiresAt) {
    const expiry = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
    if (Date.now() > expiry.getTime()) {
      goToExpired(); return;
    }
  }

  // 5. Increment views (fire-and-don't-await-block — non-critical)
  incrementViews(imageId, data);

  // 6. Build canonical URL (slug-based if available, else ?id=)
  const baseUrl = 'https://imgify.site';
  const siteUrl = data.siteUrl || `${baseUrl}/image.html?id=${imageId}`;
  const slugUrl = data.customSlug ? `${baseUrl}/i/${data.customSlug}` : null;
  _primaryUrl   = slugUrl || siteUrl;

  // 7. Set OG meta immediately (for JS-enabled crawlers)
  injectOGMeta(data, _primaryUrl);

  // 8. Password gate or full render
  if (data.isPasswordProtected) {
    renderPasswordGate();
  } else {
    await renderImageView(data, _primaryUrl);
  }
}
