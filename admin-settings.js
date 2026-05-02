// public/js/admin/admin-settings.js
// File 25/43 — Imgify Admin Settings
// Reads/writes config/siteSettings in Firestore
// Tabs: General | Ads & Affiliates | Donation

import { initAdminAuth, handleAdminLogout } from './admin-auth.js';
import { db } from '../firebase-init.js';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── Helpers (self-contained) ────────────────────────────────────────────────

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
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function _formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function _showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText =
      'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const colors = {
    success: 'var(--success)',
    error: 'var(--danger)',
    warning: 'var(--warning)',
    info: 'var(--accent)'
  };
  toast.style.cssText = `
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-left: 4px solid ${colors[type] || colors.info};
    color: var(--text-primary);
    padding: 12px 16px;
    border-radius: var(--radius-md);
    font-size: 14px;
    font-family: var(--font-body);
    min-width: 260px;
    max-width: 360px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    animation: slideIn 0.2s ease;
    cursor: pointer;
  `;
  toast.textContent = message;
  toast.onclick = () => toast.remove();
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ─── State ────────────────────────────────────────────────────────────────────

const SETTINGS_REF = () => doc(db, 'config', 'siteSettings');

let affiliateLinks = []; // in-memory array for dynamic CRUD

// ─── Tab Management ───────────────────────────────────────────────────────────

function _initTabs() {
  const tabs = document.querySelectorAll('.settings-tab-btn');
  const panels = document.querySelectorAll('.settings-tab-panel');

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${target}`)?.classList.add('active');
    });
  });

  // Activate first tab by default
  if (tabs.length) tabs[0].click();
}

// ─── Load Settings ────────────────────────────────────────────────────────────

async function _loadSettings() {
  const settingsRef = SETTINGS_REF();
  let data = null;
  let exists = false;

  try {
    const snap = await getDoc(settingsRef);
    exists = snap.exists();
    if (exists) data = snap.data();
  } catch (err) {
    console.error('Failed to load siteSettings:', err);
    _showToast('Failed to load settings from Firestore.', 'error');
    return;
  }

  if (!exists) {
    const notice = document.getElementById('first-time-notice');
    if (notice) notice.removeAttribute('hidden');
  }

  _populateGeneral(data || {});
  _populateAds(data || {});
  _populateDonation(data || {});
}

// ─── General Tab ─────────────────────────────────────────────────────────────

function _populateGeneral(d) {
  _setVal('siteName', d.siteName || '');
  _setVal('tagline', d.tagline || '');
  _setVal('maxFileSizeMB', d.maxFileSizeMB ?? 10);
  _setVal('defaultExpiry', d.defaultExpiry || 'never');
  _setVal('bannedFileTypes', d.bannedFileTypes || '');
  _setChecked('allowUploads', d.allowUploads !== false); // default true
  _setChecked('maintenanceMode', d.maintenanceMode === true);
}

async function _saveGeneral() {
  const btn = document.getElementById('save-general-btn');
  _setBtnLoading(btn, true);
  try {
    await setDoc(SETTINGS_REF(), {
      siteName: _getVal('siteName'),
      tagline: _getVal('tagline'),
      maxFileSizeMB: Number(_getVal('maxFileSizeMB')) || 10,
      defaultExpiry: _getVal('defaultExpiry'),
      bannedFileTypes: _getVal('bannedFileTypes'),
      allowUploads: _getChecked('allowUploads'),
      maintenanceMode: _getChecked('maintenanceMode'),
      updatedAt: serverTimestamp()
    }, { merge: true });
    _showToast('General settings saved.', 'success');
  } catch (err) {
    console.error(err);
    _showToast('Failed to save general settings.', 'error');
  } finally {
    _setBtnLoading(btn, false);
  }
}

// ─── Ads & Affiliate Tab ──────────────────────────────────────────────────────

function _populateAds(d) {
  const ads = d.ads || {};
  _setChecked('adsEnabled', ads.adsEnabled === true);
  _setVal('headerScript', ads.headerScript || '');
  _setVal('footerScript', ads.footerScript || '');
  _setVal('sidebarScript', ads.sidebarScript || '');
  _setVal('contentScript', ads.inContentScript || '');

  const aff = d.affiliate || {};
  _setChecked('affiliateEnabled', aff.affiliateEnabled === true);
  affiliateLinks = Array.isArray(aff.links) ? aff.links.map(l => ({ ...l })) : [];
  _renderAffiliateLinks();
}

async function _saveAds() {
  const btn = document.getElementById('save-ads-btn');
  _setBtnLoading(btn, true);
  try {
    await setDoc(SETTINGS_REF(), {
      ads: {
        adsEnabled: _getChecked('adsEnabled'),
        headerScript: _getVal('headerScript'),
        footerScript: _getVal('footerScript'),
        sidebarScript: _getVal('sidebarScript'),
        contentScript: _getVal('inContentScript')
      },
      affiliate: {
        affiliateEnabled: _getChecked('affiliateEnabled'),
        links: _collectAffiliateLinks()
      },
      updatedAt: serverTimestamp()
    }, { merge: true });
    _showToast('Ads & affiliate settings saved.', 'success');
  } catch (err) {
    console.error(err);
    _showToast('Failed to save ads settings.', 'error');
  } finally {
    _setBtnLoading(btn, false);
  }
}

// ─── Affiliate Link CRUD ──────────────────────────────────────────────────────

window.__addAffiliateLink = function () {
  affiliateLinks.push({
    id: `aff_${Date.now()}`,
    name: '',
    url: '',
    bannerUrl: '',
    placement: 'sidebar',
    enabled: true
  });
  _renderAffiliateLinks();
};

window.__removeAffiliateLink = function (index) {
  affiliateLinks.splice(index, 1);
  _renderAffiliateLinks();
};

function _renderAffiliateLinks() {
  const container = document.getElementById('affiliate-links-list');
  if (!container) return;

  if (affiliateLinks.length === 0) {
    container.innerHTML = `
      <p class="aff-empty-msg" style="color:var(--text-muted);font-size:14px;padding:12px 0;">
        No affiliate links yet. Click "+ Add Affiliate Link" to add one.
      </p>`;
    return;
  }

  container.innerHTML = affiliateLinks.map((link, i) => `
    <div class="aff-card" data-index="${i}" style="
      background:var(--bg-secondary);
      border:1px solid var(--border);
      border-radius:var(--radius-md);
      padding:16px;
      margin-bottom:12px;
      position:relative;
    ">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:13px;font-weight:600;color:var(--text-muted);">Link #${i + 1}</span>
        <button
          onclick="window.__removeAffiliateLink(${i})"
          class="btn btn-danger btn-sm"
          aria-label="Remove affiliate link ${i + 1}"
          style="padding:4px 10px;font-size:12px;"
        >Remove</button>
      </div>
      <div class="aff-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input
            type="text"
            class="form-input aff-name"
            data-index="${i}"
            value="${_esc(link.name)}"
            placeholder="e.g. Hostinger"
            aria-label="Affiliate name"
          />
        </div>
        <div class="form-group">
          <label class="form-label">Affiliate URL</label>
          <input
            type="url"
            class="form-input aff-url"
            data-index="${i}"
            value="${_esc(link.url)}"
            placeholder="https://your-affiliate-link.com"
            aria-label="Affiliate URL"
          />
        </div>
        <div class="form-group">
          <label class="form-label">Banner Image URL</label>
          <input
            type="url"
            class="form-input aff-banner"
            data-index="${i}"
            value="${_esc(link.bannerUrl)}"
            placeholder="https://example.com/banner.png"
            aria-label="Banner image URL"
          />
        </div>
        <div class="form-group">
          <label class="form-label">Placement</label>
          <select class="form-input aff-placement" data-index="${i}" aria-label="Placement">
            <option value="header" ${link.placement === 'header' ? 'selected' : ''}>Header</option>
            <option value="footer" ${link.placement === 'footer' ? 'selected' : ''}>Footer</option>
            <option value="sidebar" ${link.placement === 'sidebar' ? 'selected' : ''}>Sidebar</option>
            <option value="content" ${link.placement === 'content' ? 'selected' : ''}>In-Content</option>
          </select>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;align-items:center;gap:10px;">
        <label class="toggle-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text-secondary);">
          <input
            type="checkbox"
            class="toggle-input aff-enabled"
            data-index="${i}"
            ${link.enabled ? 'checked' : ''}
            aria-label="Enable this affiliate link"
          />
          <span class="toggle-track"></span>
          Enabled
        </label>
      </div>
    </div>
  `).join('');

  // Attach live-sync listeners on all affiliate inputs
  container.querySelectorAll('[data-index]').forEach(el => {
    el.addEventListener('input', _syncAffiliateField);
    el.addEventListener('change', _syncAffiliateField);
  });
}

function _syncAffiliateField(e) {
  const el = e.target;
  const idx = parseInt(el.dataset.index, 10);
  if (isNaN(idx) || !affiliateLinks[idx]) return;

  if (el.classList.contains('aff-name')) affiliateLinks[idx].name = el.value;
  else if (el.classList.contains('aff-url')) affiliateLinks[idx].url = el.value;
  else if (el.classList.contains('aff-banner')) affiliateLinks[idx].bannerUrl = el.value;
  else if (el.classList.contains('aff-placement')) affiliateLinks[idx].placement = el.value;
  else if (el.classList.contains('aff-enabled')) affiliateLinks[idx].enabled = el.checked;
}

function _collectAffiliateLinks() {
  // Sync one final pass from DOM before returning (handles any unsync'd inputs)
  const container = document.getElementById('affiliate-links-list');
  if (container) {
    container.querySelectorAll('[data-index]').forEach(el => {
      const idx = parseInt(el.dataset.index, 10);
      if (isNaN(idx) || !affiliateLinks[idx]) return;
      if (el.classList.contains('aff-name')) affiliateLinks[idx].name = el.value;
      else if (el.classList.contains('aff-url')) affiliateLinks[idx].url = el.value;
      else if (el.classList.contains('aff-banner')) affiliateLinks[idx].bannerUrl = el.value;
      else if (el.classList.contains('aff-placement')) affiliateLinks[idx].placement = el.value;
      else if (el.classList.contains('aff-enabled')) affiliateLinks[idx].enabled = el.checked;
    });
  }
  return affiliateLinks.map(l => ({
    id: l.id || `aff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: l.name || '',
    url: l.url || '',
    bannerUrl: l.bannerUrl || '',
    placement: l.placement || 'sidebar',
    enabled: l.enabled !== false
  }));
}

// ─── Donation Tab ─────────────────────────────────────────────────────────────

function _populateDonation(d) {
  const don = d.donationLinks || {};
  _setChecked('donationEnabled', don.donationEnabled === true);
  _setVal('donationHeadline', don.headline || '');
  _setVal('donationSubtext', don.subtext || '');

  const ep = don.easypaisa || {};
  _setVal('easypaisaNumber', ep.number || '');
  _setVal('easypaisaInstructions', ep.instructions || '');

  const jc = don.jazzcash || {};
  _setVal('jazzcashNumber', jc.number || '');
  _setVal('jazzcashInstructions', jc.instructions || '');

  const po = don.payoneer || {};
  _setVal('payoneerEmail', po.email || '');
  _setVal('payoneerInstructions', po.instructions || '');
}

async function _saveDonation() {
  const btn = document.getElementById('save-donation-btn');
  _setBtnLoading(btn, true);
  try {
    await setDoc(SETTINGS_REF(), {
      donationLinks: {
        donationEnabled: _getChecked('donationEnabled'),
        headline: _getVal('donationHeadline'),
        subtext: _getVal('donationSubtext'),
        easypaisa: {
          number: _getVal('easypaisaNumber'),
          instructions: _getVal('easypaisaInstructions')
        },
        jazzcash: {
          number: _getVal('jazzcashNumber'),
          instructions: _getVal('jazzcashInstructions')
        },
        payoneer: {
          email: _getVal('payoneerEmail'),
          instructions: _getVal('payoneerInstructions')
        }
      },
      updatedAt: serverTimestamp()
    }, { merge: true });
    _showToast('Donation settings saved.', 'success');
  } catch (err) {
    console.error(err);
    _showToast('Failed to save donation settings.', 'error');
  } finally {
    _setBtnLoading(btn, false);
  }
}

// ─── DOM Utilities ────────────────────────────────────────────────────────────

function _setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function _getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function _setChecked(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = checked;
}

function _getChecked(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

function _setBtnLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Saving…' : (btn.dataset.label || 'Save Settings');
}

// ─── Event Bindings ───────────────────────────────────────────────────────────

function _bindEvents() {
  // Save buttons
  document.getElementById('save-general-btn')?.addEventListener('click', _saveGeneral);
  document.getElementById('save-ads-btn')?.addEventListener('click', _saveAds);
  document.getElementById('save-donation-btn')?.addEventListener('click', _saveDonation);

  // Add affiliate link button
  document.getElementById('add-affiliate-btn')?.addEventListener('click', () => {
    window.__addAffiliateLink();
  });

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', handleAdminLogout);

  // Preserve button labels for loading state restore
  document.querySelectorAll('[id$="-btn"]').forEach(btn => {
    if (btn.textContent) btn.dataset.label = btn.textContent.trim();
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

initAdminAuth(async (user) => {
  _initTabs();
  _bindEvents();
  await _loadSettings();
});
