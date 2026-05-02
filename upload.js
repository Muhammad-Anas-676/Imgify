/**
 * public/js/upload.js
 * Imgify — Complete upload flow: single & bulk, drag-drop, paste, XHR progress,
 * ImgBB API, Firestore write, result panel, QR init, ZIP download.
 * ES Module. No framework.
 */

import { db }                    from './firebase-init.js';
import { SITE_URL } from './config.js';
import {
  doc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { nanoid }            from 'https://esm.run/nanoid';
import { addImageToAlbum }   from './albums.js'; // FIX: Albums integration import

// ─── Collection names (mirrors PRD schema) ────────────────────────────────────
const COLLECTIONS = {
  UPLOADS:      'uploads',
  CUSTOM_SLUGS: 'customSlugs',
  ALBUMS:       'albums',
};

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_FILES     = 10;
const MAX_SIZE      = 32 * 1024 * 1024; // 32 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']);
const EXPIRY_MAP    = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, '30d': 2592000, '90d': 7776000 };

// Module-level state
let pendingFiles = [];

// ─── Session ──────────────────────────────────────────────────────────────────
function getSessionId() {
  let sid = localStorage.getItem('imgify-session');
  if (!sid) {
    sid = nanoid(16);
    localStorage.setItem('imgify-session', sid);
  }
  return sid;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function computeExpiresAt(expiry) {
  if (!expiry || expiry === 'never') return null;
  const secs = EXPIRY_MAP[expiry];
  return secs ? new Date(Date.now() + secs * 1000) : null;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  let wrap = document.getElementById('imgify-toasts');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'imgify-toasts';
    wrap.setAttribute('aria-live', 'polite');
    wrap.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(wrap);
  }
  const t = document.createElement('div');
  const colors = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--accent)' };
  t.style.cssText = `
    background:var(--bg-primary);border:1px solid var(--border);
    border-left:3px solid ${colors[type] || colors.info};
    border-radius:var(--radius-md);padding:12px 16px;
    font-family:var(--font-body);font-size:14px;color:var(--text-primary);
    box-shadow:0 4px 16px rgba(0,0,0,.12);max-width:320px;
    animation:slideInToast .22s ease;pointer-events:all;
  `;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .22s,transform .22s';
    t.style.opacity = '0'; t.style.transform = 'translateX(12px)';
    setTimeout(() => t.remove(), 230);
  }, 3000);
}

// ─── Validation ───────────────────────────────────────────────────────────────
function validateFiles(files) {
  const valid = [], errors = [];
  const list = Array.from(files).slice(0, MAX_FILES);
  if (files.length > MAX_FILES)
    errors.push(`Max ${MAX_FILES} files per upload. Only first ${MAX_FILES} accepted.`);
  for (const f of list) {
    if (!ALLOWED_TYPES.has(f.type))
      errors.push(`"${f.name}" is not a supported image type.`);
    else if (f.size > MAX_SIZE)
      errors.push(`"${f.name}" exceeds 32 MB (${formatBytes(f.size)}).`);
    else
      valid.push(f);
  }
  return { valid, errors };
}

// ─── File helpers ─────────────────────────────────────────────────────────────
function getImageDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({ width: 0, height: 0 }); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function compressImage(file, quality) {
  // PNG and GIF are lossless — skip compression
  if (file.type === 'image/png' || file.type === 'image/gif') return file;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], file.name, { type: file.type }) : file),
        file.type, quality / 100
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ─── Progress cards ───────────────────────────────────────────────────────────
function createProgressCard(file, cardId) {
  const el = document.createElement('div');
  el.id = cardId;
  el.className = 'upload-progress-card';
  el.innerHTML = `
    <div class="upc-info">
      <span class="upc-name">${esc(file.name)}</span>
      <span class="upc-size">${formatBytes(file.size)}</span>
      <span class="upc-badge upc-badge--waiting" role="status">Waiting</span>
    </div>
    <div class="upc-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="upc-bar-fill" style="width:0%"></div>
    </div>
  `;
  return el;
}

function updateProgressCard(cardId, pct, statusLabel) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const fill  = card.querySelector('.upc-bar-fill');
  const badge = card.querySelector('.upc-badge');
  const track = card.querySelector('.upc-bar-track');
  if (fill)  fill.style.width  = `${pct}%`;
  if (track) track.setAttribute('aria-valuenow', pct);
  if (badge) {
    badge.textContent = statusLabel;
    badge.className   = `upc-badge upc-badge--${statusLabel.toLowerCase().replace(/\s+/g,'-')}`;
  }
}

// ─── ImgBB upload (XHR for real progress events) ──────────────────────────────
function uploadToImgBB(base64, name, expirationSeconds, onProgress) {
  return new Promise((resolve, reject) => {
    // Simulated progress since fetch does not support upload progress events
    let pct = 0;
    const timer = setInterval(() => {
      pct = Math.min(pct + 10, 90);
      if (onProgress) onProgress(pct);
    }, 200);

    fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: base64,
        name,
        expiration: expirationSeconds || null
      })
    })
      .then(r => r.json())
      .then(res => {
        clearInterval(timer);
        if (onProgress) onProgress(100);
        if (res.success) resolve(res.data);
        else reject(new Error(res.error?.message || 'ImgBB upload failed'));
      })
      .catch(() => {
        clearInterval(timer);
        reject(new Error('Network error during upload'));
      });
  });
}

// ─── Firestore write ──────────────────────────────────────────────────────────
async function writeImageDoc(imageId, imgbbData, file, dims, options, bulkMeta) {
  const sessionId = getSessionId();
  const expiresAt = computeExpiresAt(options.expiry);

  const docData = {
    imageId,
    sessionId,
    uid:                  null,
    filename:             file.name,
    customName:           options.customName || file.name.replace(/\.[^/.]+$/, ''),
    customSlug:           options.customSlug  || null,
    mimeType:             file.type,
    fileSize:             file.size,
    width:                dims.width,
    height:               dims.height,
    imgbbUrl:             imgbbData.display_url || imgbbData.url,
    imgbbDeleteUrl:       imgbbData.delete_url  || null,
    imgbbThumbUrl:        imgbbData.thumb?.url  || imgbbData.display_url || imgbbData.url,
    siteUrl:              `${SITE_URL}/image.html?id=${imageId}`,
    slugUrl:              options.customSlug ? `${SITE_URL}/i/${options.customSlug}` : null,
    privacy:              options.privacy           || 'public',
    isPasswordProtected:  !!(options.passwordHash),
    passwordHash:         options.passwordHash      || null,
    description:          options.description       || null,
    tags:                 options.tags              || [],
    compressionQuality:   options.compressionQuality ?? 85,
    expiresAt:            expiresAt ? Timestamp.fromDate(expiresAt) : null,
    autoDeleteAfterViews: null,
    views:                0,
    deleted:              false,
    reported:             false,
    albumId:              options.albumId            || null,
    isBulkUpload:         bulkMeta?.isBulk           || false,
    bulkSessionId:        bulkMeta?.bulkSessionId    || null,
    wasEdited:            options.wasEdited           || false,
    createdAt:            serverTimestamp(),
  };

  await setDoc(doc(db, COLLECTIONS.UPLOADS, imageId), docData);

  // Reserve custom slug in customSlugs collection
  if (options.customSlug) {
    await setDoc(doc(db, COLLECTIONS.CUSTOM_SLUGS, options.customSlug), {
      imageId,
      createdAt: serverTimestamp(),
    });
  }

  return docData;
}

// ─── Result panel ─────────────────────────────────────────────────────────────
function copyRow(label, value, id) {
  return `
    <div class="result-copy-row">
      <span class="result-copy-label">${esc(label)}</span>
      <input id="${id}" class="result-copy-input font-mono" type="text" value="${esc(value)}" readonly aria-label="${esc(label)}">
      <button class="btn btn-sm btn-secondary" data-copy="${id}" aria-label="Copy ${esc(label)}">Copy</button>
    </div>`;
}

function wirecopybtn(btn) {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.copy);
    if (!input) return;
    copyToClipboard(input.value);
    btn.textContent = '✓';
    setTimeout(() => (btn.textContent = 'Copy'), 2000);
  });
}

function renderResultPanel(results) {
  const panel = document.getElementById('result-panel-mount'); // FIX: renamed from 'result-panel'
  if (!panel) return;

  const successful = results.filter(r => !r.error);
  panel.innerHTML = '';

  // ── Header
  const hdr = document.createElement('div');
  hdr.className = 'result-header';
  hdr.innerHTML = `
    <h2 class="result-title">
      ${successful.length === results.length ? '✓' : '⚠'} 
      ${successful.length} of ${results.length} image${results.length > 1 ? 's' : ''} uploaded
    </h2>
    <p class="result-subtitle">Your ${successful.length > 1 ? 'images are' : 'image is'} live and ready to share.</p>
  `;
  panel.appendChild(hdr);

  // ── Per-image rows
  results.forEach((item, idx) => {
    const row = document.createElement('div');

    if (item.error) {
      row.className = 'result-item result-item--error';
      row.innerHTML = `
        <span class="result-item-name">${esc(item.filename)}</span>
        <span class="badge badge-error">Failed: ${esc(item.error)}</span>`;
      panel.appendChild(row);
      return;
    }

    const primaryUrl = item.slugUrl || item.siteUrl;
    row.className = 'result-item';
    row.innerHTML = `
      <div class="result-item-head">
        <img class="result-thumb" src="${esc(item.imgbbThumbUrl)}" alt="${esc(item.customName)}" loading="lazy">
        <div class="result-item-meta">
          <span class="result-item-name">${esc(item.customName)}</span>
          <span class="result-item-size">${formatBytes(item.fileSize)} · ${item.width}×${item.height}px</span>
          ${item.slugUrl ? `<span class="badge badge-accent">Custom URL: /i/${esc(item.customSlug)}</span>` : ''}
        </div>
      </div>
      <div class="result-copy-list">
        ${copyRow('Direct Link',   primaryUrl,                                                           `copy-link-${idx}`)}
        ${copyRow('HTML Embed',    `<img src="${item.imgbbUrl}" alt="${item.customName}">`,              `copy-html-${idx}`)}
        ${copyRow('Markdown',      `![${item.customName}](${item.siteUrl})`,                            `copy-md-${idx}`)}
        ${copyRow('BBCode',        `[img]${item.imgbbUrl}[/img]`,                                       `copy-bb-${idx}`)}
        ${copyRow('Thumbnail URL', item.imgbbThumbUrl,                                                  `copy-thumb-${idx}`)}
      </div>
      <div class="qr-section">
        <div class="qr-canvas-wrap" id="qr-canvas-${idx}"></div>
        <div class="qr-controls">
          <label class="qr-ctrl-label">
            <span>QR Color</span>
            <input type="color" id="qr-fg-${idx}" value="#000000" aria-label="QR foreground color">
          </label>
          <label class="qr-ctrl-label">
            <span>Background</span>
            <input type="color" id="qr-bg-${idx}" value="#ffffff" aria-label="QR background color">
          </label>
          <div class="size-seg" role="group" aria-label="QR size">
            <button class="size-seg-btn active" data-size="128" data-qi="${idx}">S</button>
            <button class="size-seg-btn"        data-size="200" data-qi="${idx}">M</button>
            <button class="size-seg-btn"        data-size="300" data-qi="${idx}">L</button>
          </div>
          <button class="btn btn-sm btn-secondary" data-dl-qr="${idx}" data-dl-name="${esc(item.customName)}">⬇ Download QR</button>
        </div>
      </div>
    `;
    panel.appendChild(row);
  });

  // ── Bulk actions
  if (successful.length >= 2) {
    const bulk = document.createElement('div');
    bulk.className = 'bulk-result-actions';
    bulk.innerHTML = `
      <button class="btn btn-secondary" id="copy-all-urls">📋 Copy All URLs</button>
      <button class="btn btn-primary"   id="download-zip-btn">⬇ Download All as ZIP</button>
      <p class="bulk-summary">${successful.length} images uploaded successfully in this session.</p>
    `;
    panel.appendChild(bulk);

    document.getElementById('copy-all-urls')?.addEventListener('click', () => {
      const text = successful.map(r => r.slugUrl || r.siteUrl).join('\n');
      copyToClipboard(text);
      showToast('All URLs copied!');
    });

    document.getElementById('download-zip-btn')?.addEventListener('click', () => downloadZip(successful));
  }

  // ── Upload another
  const again = document.createElement('button');
  again.className = 'btn btn-secondary upload-another-btn';
  again.textContent = '↩ Upload Another Image';
  again.addEventListener('click', resetUploadUI);
  panel.appendChild(again);

  panel.hidden = false;

  // Wire copy buttons
  panel.querySelectorAll('[data-copy]').forEach(wirecopybtn);

  // Wire QR panels
  successful.forEach((item, idx) => {
    initQRPanel(idx, item.slugUrl || item.siteUrl, item.customName);
  });
}

// ─── Clipboard ────────────────────────────────────────────────────────────────
function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  } else {
    legacyCopy(text);
  }
}

function legacyCopy(text) {
  const ta = Object.assign(document.createElement('textarea'), {
    value: text, style: 'position:fixed;top:-9999px;left:-9999px;opacity:0;'
  });
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch { /* silently fail */ }
  ta.remove();
}

// ─── QR Panel ─────────────────────────────────────────────────────────────────
async function initQRPanel(idx, url, name) {
  try {
    const { generateQRCode, downloadQRCode } = await import('./qrcode-helper.js');

    let qrOpts = { fg: '#000000', bg: '#ffffff', size: 200 };
    await generateQRCode(`qr-canvas-${idx}`, url, qrOpts);

    const regen = () => generateQRCode(`qr-canvas-${idx}`, url, qrOpts);

    document.getElementById(`qr-fg-${idx}`)?.addEventListener('input', (e) => { qrOpts.fg = e.target.value; regen(); });
    document.getElementById(`qr-bg-${idx}`)?.addEventListener('input', (e) => { qrOpts.bg = e.target.value; regen(); });

    document.querySelectorAll(`[data-qi="${idx}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll(`[data-qi="${idx}"]`).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        qrOpts.size = parseInt(btn.dataset.size, 10);
        regen();
      });
    });

    document.querySelector(`[data-dl-qr="${idx}"]`)?.addEventListener('click', () => {
      downloadQRCode(`qr-canvas-${idx}`, name || 'imgify-qr');
    });

  } catch (err) {
    console.warn('QR helper unavailable:', err);
    const wrap = document.getElementById(`qr-canvas-${idx}`);
    if (wrap) { wrap.closest('.qr-section')?.remove(); }
  }
}

// ─── ZIP Download (lazy JSZip) ────────────────────────────────────────────────
async function downloadZip(items) {
  const btn = document.getElementById('download-zip-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparing ZIP…'; }

  try {
    if (!window.JSZip) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src     = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload  = res;
        s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    const zip = new window.JSZip();

    for (const item of items) {
      try {
        const resp = await fetch(item.imgbbUrl);
        const blob = await resp.blob();
        const ext  = item.filename.split('.').pop() || 'jpg';
        zip.file(`${item.customName}.${ext}`, blob);
      } catch { /* skip failed individual files */ }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const a       = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(zipBlob),
      download: 'imgify-upload.zip',
    });
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('ZIP downloaded successfully!');
  } catch (err) {
    console.error('ZIP error:', err);
    showToast('ZIP download failed. Please try again.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Download All as ZIP'; }
  }
}

// ─── UI Reset ─────────────────────────────────────────────────────────────────
function resetUploadUI() {
  pendingFiles = [];

  const uploadZone    = document.getElementById('upload-zone');       // FIX: renamed from 'dropzone'
  const optionsPanel  = document.getElementById('options-panel-mount'); // FIX: renamed from 'options-panel'
  const progressPanel = document.getElementById('bulk-queue-mount');   // FIX: renamed from 'progress-panel'
  const resultPanel   = document.getElementById('result-panel-mount'); // FIX: renamed from 'result-panel'
  const fileInput     = document.getElementById('file-input');
  const dzThumb       = document.getElementById('dropzone-thumb');     // FIX: optional — may not exist
  const dzLabel       = document.getElementById('dropzone-label');     // FIX: optional — may not exist

  if (uploadZone)    uploadZone.hidden       = false;
  document.getElementById('upload-error')?.setAttribute('hidden', ''); // FIX: optional chaining — may not exist
  if (fileInput)     fileInput.value         = '';
  if (dzThumb)      { dzThumb.src = ''; dzThumb.hidden = true; }
  if (dzLabel)       dzLabel.textContent     = 'Drag & drop images here, click to browse, or paste (Ctrl+V)';

  if (optionsPanel) {
    optionsPanel.style.maxHeight = '0';
    optionsPanel.classList.remove('open');
  }
  if (progressPanel) {
    progressPanel.innerHTML = '';
    progressPanel.hidden    = true;
  }
  if (resultPanel) {
    resultPanel.innerHTML = '';
    resultPanel.hidden    = true;
  }

  // Notify options-panel to reset its own state
  window.resetOptionsPanel?.();
}

// ─── Core upload orchestration ────────────────────────────────────────────────
export async function uploadFiles(files) {
  if (!files?.length) return;

  const { valid, errors } = validateFiles(Array.from(files));

  // FIX: optional chaining — upload-error may not exist in index.html
  const errEl = document.getElementById('upload-error');
  if (errors.length && errEl) {
    errEl.textContent = errors.join(' ');
    errEl.hidden      = false;
  }

  if (!valid.length) {
    showToast('No valid files to upload.', 'error');
    return;
  }

  // Collect options from options-panel module
  let options = {};
  try {
    const mod = await import('./options-panel.js');
    options   = mod.getUploadOptions?.() || {};
  } catch { /* options-panel not loaded, use defaults */ }

  const isBulk        = valid.length > 1;
  const bulkSessionId = isBulk ? nanoid(8) : null;

  // Slug disabled in bulk mode
  if (isBulk) options.customSlug = null;

  // ── Transition UI to upload state
  const uploadZone    = document.getElementById('upload-zone');        // FIX: renamed from 'dropzone'
  const optionsPanel  = document.getElementById('options-panel-mount'); // FIX: renamed from 'options-panel'
  const progressPanel = document.getElementById('bulk-queue-mount');   // FIX: renamed from 'progress-panel'
  const resultPanel   = document.getElementById('result-panel-mount'); // FIX: renamed from 'result-panel'

  if (uploadZone)    uploadZone.hidden       = true;
  if (optionsPanel) { optionsPanel.style.maxHeight = '0'; optionsPanel.classList.remove('open'); }
  if (resultPanel)   resultPanel.hidden      = true;
  if (progressPanel) { progressPanel.hidden = false; progressPanel.innerHTML = ''; }

  // Pre-render all progress cards
  valid.forEach((file, i) => {
    progressPanel?.appendChild(createProgressCard(file, `upload-card-${i}`));
  });

  const results = [];

  // ── Upload each file sequentially
  for (let i = 0; i < valid.length; i++) {
    const file   = valid[i];
    const cardId = `upload-card-${i}`;

    updateProgressCard(cardId, 0, 'Compressing');

    try {
      const quality    = options.compressionQuality ?? 85;
      const compressed = await compressImage(file, quality);
      const base64     = await fileToBase64(compressed);
      const dims       = await getImageDimensions(file);

      // Custom name with suffix for bulk
      let customName = options.customName || file.name.replace(/\.[^/.]+$/, '');
      if (isBulk) customName = `${customName}-${i + 1}`;
      const fileOptions = { ...options, customName };

      const expSecs = fileOptions.expiry && fileOptions.expiry !== 'never'
        ? EXPIRY_MAP[fileOptions.expiry] || null
        : null;

      updateProgressCard(cardId, 5, 'Uploading');

      const imgbbData = await uploadToImgBB(base64, customName, expSecs, (pct) => {
        // XHR progress: map 5–90%
        updateProgressCard(cardId, 5 + Math.round(pct * 0.85), 'Uploading');
      });

      updateProgressCard(cardId, 92, 'Saving');

      const imageId = nanoid(8);
      const docData = await writeImageDoc(imageId, imgbbData, file, dims, fileOptions, {
        isBulk, bulkSessionId,
      });

      // FIX: Albums integration — link image to album after successful Firestore write
      if (fileOptions.albumId) {
        try {
          await addImageToAlbum(fileOptions.albumId, imageId, docData.imgbbThumbUrl);
        } catch (albumErr) {
          console.warn('[upload.js] addImageToAlbum failed (non-fatal):', albumErr);
        }
      }

      updateProgressCard(cardId, 100, 'Done');
      results.push(docData);

    } catch (err) {
      console.error(`[upload.js] File "${file.name}" failed:`, err);
      updateProgressCard(cardId, 0, 'Error');
      results.push({ filename: file.name, error: err.message || 'Upload failed' });
    }

    // Rate-limit buffer between files
    if (isBulk && i < valid.length - 1) await sleep(200);
  }

  // ── Render result panel (even if some failed)
  renderResultPanel(results);

  const successCount = results.filter(r => !r.error).length;
  if (successCount === 0) {
    showToast('All uploads failed. Please try again.', 'error');
  } else if (successCount < results.length) {
    showToast(`${successCount} of ${results.length} uploaded. Some files failed.`, 'info');
  } else {
    showToast(`${successCount} image${successCount > 1 ? 's' : ''} uploaded successfully! ✓`);
  }
}

// ─── File selection handler ────────────────────────────────────────────────────
function handleFileSelection(files) {
  const { valid, errors } = validateFiles(Array.from(files));

  // FIX: optional chaining — upload-error may not exist in index.html
  const errEl = document.getElementById('upload-error');
  if (errEl) {
    if (errors.length) { errEl.textContent = errors[0]; errEl.hidden = false; }
    else                errEl.hidden = true;
  }

  if (!valid.length) return;

  pendingFiles = valid;

  // Show preview — all three elements may not exist, guard with ?.
  const uploadZone = document.getElementById('upload-zone');         // FIX: renamed from 'dropzone'
  const dzThumb    = document.getElementById('dropzone-thumb');      // FIX: optional chaining — may not exist
  const dzLabel    = document.getElementById('dropzone-label');      // FIX: optional chaining — may not exist

  if (valid.length === 1) {
    if (dzThumb) {
      dzThumb.src    = URL.createObjectURL(valid[0]);
      dzThumb.hidden = false;
    }
    if (dzLabel) dzLabel.textContent = `${valid[0].name} — ${formatBytes(valid[0].size)}`;
  } else {
    if (dzLabel) dzLabel.textContent = `${valid.length} files selected — configure options below and click Upload.`;
  }

  // Open options panel
  const optionsPanel = document.getElementById('options-panel-mount'); // FIX: renamed from 'options-panel'
  if (optionsPanel) {
    optionsPanel.style.maxHeight = '1200px';
    optionsPanel.classList.add('open');
    // Notify options-panel of selection (it handles bulk-mode UI adjustments)
    window.onFilesSelected?.(valid);
  } else {
    // No options panel — upload immediately
    uploadFiles(valid);
  }
}

// ─── Public trigger (called by options-panel.js upload button) ────────────────
window.imgifyTriggerUpload = () => {
  if (pendingFiles.length) uploadFiles(pendingFiles);
  else showToast('Please select an image first.', 'info');
};

// ─── initUpload — wire all upload UI events ────────────────────────────────────
export function initUpload() {
  const uploadZone = document.getElementById('upload-zone');  // FIX: renamed from 'dropzone'
  const fileInput  = document.getElementById('file-input');

  if (!uploadZone || !fileInput) {
    console.warn('[upload.js] #upload-zone or #file-input not found in DOM'); // FIX: updated warning msg
    return;
  }

  // Drag over
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', (e) => {
    if (!uploadZone.contains(e.relatedTarget)) uploadZone.classList.remove('drag-over');
  });

  // Drop
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFileSelection(e.dataTransfer.files);
  });

  // Click to browse (avoid triggering on inner buttons/inputs)
  uploadZone.addEventListener('click', (e) => {
    if (!['BUTTON', 'INPUT', 'A'].includes(e.target.tagName)) fileInput.click();
  });

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFileSelection(fileInput.files);
  });

  // Paste from clipboard (Ctrl+V)
  document.addEventListener('paste', (e) => {
    const imageFiles = Array.from(e.clipboardData?.items || [])
      .filter(item => item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (imageFiles.length) handleFileSelection(imageFiles);
  });

  // Upload button on options panel (fallback if options-panel.js doesn't wire it)
  const uploadBtn = document.getElementById('upload-btn');
  uploadBtn?.addEventListener('click', window.imgifyTriggerUpload);
}

// ─── Exports ──────────────────────────────────────────────────────────────────
export { uploadFiles as default };

// Auto-init
document.addEventListener('DOMContentLoaded', initUpload);
