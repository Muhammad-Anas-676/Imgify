/**
 * options-panel.js — Imgify Upload Options Panel
 * File 10/43 | Author: Muhammad Anas | imgify.site
 * ES Module — imported by index.html as type="module"
 */

import { db } from './firebase-init.js';
import {
  getDoc,
  getDocs,
  doc,
  collection,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'dashboard', 'donate', 'album',
  'image', '404', 'expired',
  'i', 'assets', 'css', 'js' // FIX: Added 4 missing reserved slugs per QA Bug #16
]);

const SLUG_REGEX = /^[a-z0-9\-_]{3,60}$/;

const EXPIRY_MAP = {
  never: 'never',
  '1h':  '1h',
  '6h':  '6h',
  '24h': '24h',
  '7d':  '7d',
  '30d': '30d',
  '90d': '90d'
};

// ─── State ───────────────────────────────────────────────────────────────────

let _isBulkMode    = false;
let _slugDebounce  = null;
let _slugStatus    = 'idle'; // 'idle' | 'checking' | 'available' | 'taken' | 'invalid'
let _tags          = [];

// ─── DOM Helpers ─────────────────────────────────────────────────────────────

const $  = (id) => document.getElementById(id);
const el = (selector) => document.querySelector(selector);

// ─── SHA-256 Helper ──────────────────────────────────────────────────────────

async function sha256(str) {
  const encoder   = new TextEncoder();
  const data      = encoder.encode(str);
  const hashBuf   = await crypto.subtle.digest('SHA-256', data);
  const hashArr   = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Slug Availability Check ─────────────────────────────────────────────────

async function checkSlugAvailability(slug) {
  const statusEl = $('op-slug-status');
  if (!statusEl) return;

  if (!slug) {
    statusEl.textContent = '';
    statusEl.className   = 'op-slug-status';
    _slugStatus          = 'idle';
    return;
  }

  if (!SLUG_REGEX.test(slug) || RESERVED_SLUGS.has(slug)) {
    statusEl.textContent = '❌ Invalid — use 3–60 lowercase letters, numbers, - or _';
    statusEl.className   = 'op-slug-status op-slug-invalid';
    _slugStatus          = 'invalid';
    return;
  }

  statusEl.textContent = '⏳ Checking…';
  statusEl.className   = 'op-slug-status op-slug-checking';
  _slugStatus          = 'checking';

  try {
    const ref  = doc(db, 'customSlugs', slug);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      statusEl.textContent = '❌ Taken — choose another';
      statusEl.className   = 'op-slug-status op-slug-taken';
      _slugStatus          = 'taken';
    } else {
      statusEl.textContent = '✓ Available';
      statusEl.className   = 'op-slug-status op-slug-available';
      _slugStatus          = 'available';
    }
  } catch (err) {
    console.error('[options-panel] slug check error:', err);
    statusEl.textContent = '';
    _slugStatus          = 'idle';
  }
}

// ─── Album Loader ─────────────────────────────────────────────────────────────

async function loadAlbums() {
  const select = $('op-album');
  if (!select) return;

  const sessionId = localStorage.getItem('imgify-session');
  if (!sessionId) return;

  try {
    const q    = query(collection(db, 'albums'), where('sessionId', '==', sessionId));
    const snap = await getDocs(q);

    // Clear existing options except the default
    while (select.options.length > 1) select.remove(1);

    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (data.deleted) return;
      const opt   = document.createElement('option');
      opt.value   = docSnap.id;
      opt.text    = data.name || 'Untitled Album';
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('[options-panel] album load error:', err);
  }
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

function renderTags() {
  const container = $('op-tags-pills');
  if (!container) return;
  container.innerHTML = '';
  _tags.forEach((tag, i) => {
    const pill = document.createElement('span');
    pill.className    = 'op-tag-pill';
    pill.textContent  = tag;
    const rm          = document.createElement('button');
    rm.type           = 'button';
    rm.className      = 'op-tag-remove';
    rm.setAttribute('aria-label', `Remove tag ${tag}`);
    rm.textContent    = '×';
    rm.addEventListener('click', () => {
      _tags.splice(i, 1);
      renderTags();
    });
    pill.appendChild(rm);
    container.appendChild(pill);
  });
}

function addTag(raw) {
  const tag = raw.trim().toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 30);
  if (!tag || _tags.includes(tag) || _tags.length >= 10) return false;
  _tags.push(tag);
  renderTags();
  return true;
}

// ─── Compression Quality Visibility ──────────────────────────────────────────

function updateCompressionVisibility(filename) {
  const wrap = $('op-compression-wrap');
  if (!wrap) return;
  if (!filename) { wrap.style.display = 'none'; return; }
  const ext = filename.split('.').pop().toLowerCase();
  wrap.style.display = (ext === 'png' || ext === 'gif') ? 'none' : 'block';
}

// ─── Reset ───────────────────────────────────────────────────────────────────

function resetOptionsPanel() {
  // Name
  const nameInput = $('op-custom-name');
  if (nameInput) nameInput.value = '';

  // Expiry
  const expiry = $('op-expiry');
  if (expiry) expiry.value = 'never';

  // Privacy
  document.querySelectorAll('.op-privacy-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === 'public');
    btn.setAttribute('aria-pressed', btn.dataset.value === 'public' ? 'true' : 'false');
  });

  // Password
  const pw = $('op-password');
  if (pw) pw.value = '';

  // Slug
  const slug = $('op-custom-slug');
  if (slug) slug.value = '';
  const slugStatus = $('op-slug-status');
  if (slugStatus) { slugStatus.textContent = ''; slugStatus.className = 'op-slug-status'; }
  _slugStatus = 'idle';

  // Album
  const album = $('op-album');
  if (album) album.value = '';

  // Tags
  _tags = [];
  renderTags();
  const tagInput = $('op-tag-input');
  if (tagInput) tagInput.value = '';

  // Description
  const desc = $('op-description');
  if (desc) desc.value = '';

  // Compression
  const range = $('op-compression');
  if (range) range.value = 85;
  const rangeLabel = $('op-compression-label');
  if (rangeLabel) rangeLabel.textContent = '85%';

  // Bulk mode
  _isBulkMode = false;
  const slugWrap = $('op-slug-wrap');
  if (slugWrap) slugWrap.style.display = 'block';
  const bulkTip = $('op-bulk-tip');
  if (bulkTip) bulkTip.style.display = 'none';

  // Compression hidden by default until file selected
  const compWrap = $('op-compression-wrap');
  if (compWrap) compWrap.style.display = 'none';
}

// ─── onFilesSelected (called by upload.js) ───────────────────────────────────

window.onFilesSelected = function(files) {
  if (!files || files.length === 0) return;

  // Prefill name with first file's name (no extension)
  const firstName = files[0].name.replace(/\.[^.]+$/, '');
  const nameInput = $('op-custom-name');
  if (nameInput && !nameInput.value) nameInput.value = firstName.slice(0, 100);

  // Show/hide compression based on first file's type
  updateCompressionVisibility(files[0].name);

  // Bulk mode
  _isBulkMode = files.length > 1;
  const slugWrap = $('op-slug-wrap');
  const bulkTip  = $('op-bulk-tip');

  if (_isBulkMode) {
    if (slugWrap) slugWrap.style.display = 'none';
    if (bulkTip)  bulkTip.style.display  = 'block';
    // Clear slug state
    const slug = $('op-custom-slug');
    if (slug) slug.value = '';
    _slugStatus = 'idle';
  } else {
    if (slugWrap) slugWrap.style.display = 'block';
    if (bulkTip)  bulkTip.style.display  = 'none';
  }
};

// ─── getUploadOptions (exported — called by upload.js before upload) ──────────

export async function getUploadOptions() {
  const customName = ($('op-custom-name')?.value || '').trim().slice(0, 100) || null;

  const expiryEl = $('op-expiry');
  const expiry   = EXPIRY_MAP[expiryEl?.value] || 'never';

  const activePrivacy = el('.op-privacy-btn.active');
  const privacy       = activePrivacy?.dataset.value || 'public';

  const pwRaw      = $('op-password')?.value || '';
  let   passwordHash       = null;
  let   isPasswordProtected = false;
  if (pwRaw) {
    passwordHash        = await sha256(pwRaw);
    isPasswordProtected = true;
  }

  const slugEl   = $('op-custom-slug');
  let   customSlug = null;
  if (!_isBulkMode && slugEl?.value) {
    const slugVal = slugEl.value.trim();
    if (_slugStatus === 'available') customSlug = slugVal;
  }

  const albumEl = $('op-album');
  const albumId = albumEl?.value || null;

  const tags = [..._tags];

  const descEl      = $('op-description');
  const description = descEl?.value?.trim().slice(0, 500) || null;

  const rangeEl          = $('op-compression');
  const compressionQuality = parseInt(rangeEl?.value || '85', 10);

  const wasEdited = !!(window.imgifyWasEdited);

  return {
    customName,
    expiry,
    privacy,
    isPasswordProtected,
    passwordHash,
    customSlug,
    albumId,
    tags,
    description,
    compressionQuality,
    wasEdited
  };
}

// ─── initOptionsPanel ─────────────────────────────────────────────────────────

export function initOptionsPanel() {
  // ── Privacy segmented control ──
  document.querySelectorAll('.op-privacy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.op-privacy-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    });
  });

  // ── Custom slug with debounced Firestore check ──
  const slugInput = $('op-custom-slug');
  if (slugInput) {
    slugInput.addEventListener('input', () => {
      clearTimeout(_slugDebounce);
      const val = slugInput.value.trim().toLowerCase();
      slugInput.value = val; // normalise in place
      _slugDebounce = setTimeout(() => checkSlugAvailability(val), 400);
    });
  }

  // ── Tags input ──
  const tagInput = $('op-tag-input');
  if (tagInput) {
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        if (addTag(tagInput.value)) tagInput.value = '';
      }
    });
    tagInput.addEventListener('blur', () => {
      if (tagInput.value.trim()) {
        if (addTag(tagInput.value)) tagInput.value = '';
      }
    });
  }

  // ── Compression range label ──
  const compressionRange = $('op-compression');
  const compressionLabel = $('op-compression-label');
  if (compressionRange && compressionLabel) {
    compressionRange.addEventListener('input', () => {
      compressionLabel.textContent = compressionRange.value + '%';
    });
  }

  // ── Upload Now button ──
  const uploadBtn = $('op-upload-btn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', () => {
      if (typeof window.imgifyTriggerUpload === 'function') {
        window.imgifyTriggerUpload();
      }
    });
  }

  // ── Load albums ──
  loadAlbums();

  // ── Register window resets ──
  window.resetOptionsPanel = resetOptionsPanel;

  // ── Initial hide for compression + bulk tip ──
  const compWrap = $('op-compression-wrap');
  if (compWrap) compWrap.style.display = 'none';
  const bulkTip = $('op-bulk-tip');
  if (bulkTip) bulkTip.style.display = 'none';
}

// ─── Default export ───────────────────────────────────────────────────────────

export default { initOptionsPanel, getUploadOptions };

// ─── Auto-init ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', initOptionsPanel);