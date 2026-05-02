// public/js/ads-manager.js
// ES Module — Dynamic ad + affiliate script injection from Firestore config

import { db } from './firebase-init.js';
import { getDoc, doc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/**
 * Parse an admin-pasted script string and inject each <script> tag
 * safely via document.createElement — never innerHTML.
 *
 * @param {string} scriptContent  Raw HTML string (e.g. "<script src='...'></script>")
 * @param {string} target         'head' | 'body-end' | CSS selector string
 */
function injectAdScript(scriptContent, target) {
  if (!scriptContent?.trim()) return;

  // Use a detached div purely to parse the HTML into a DOM tree.
  // querySelectorAll('script') then re-creates elements properly.
  const parser = new DOMParser();
  const parsed = parser.parseFromString(scriptContent, 'text/html');
  const scripts = parsed.querySelectorAll('script');

  if (!scripts.length) return;

  let targetEl;
  if (target === 'head') {
    targetEl = document.head;
  } else if (target === 'body-end') {
    targetEl = document.body;
  } else {
    targetEl = document.querySelector(target);
  }

  if (!targetEl) return; // placement container not present on this page — silent skip

  scripts.forEach(parsedScript => {
    const el = document.createElement('script');

    // Copy all attributes first (async, data-*, crossorigin, etc.)
    Array.from(parsedScript.attributes).forEach(attr => {
      el.setAttribute(attr.name, attr.value);
    });

    // External script vs inline script
    if (parsedScript.src) {
      el.src = parsedScript.src;
    } else {
      el.textContent = parsedScript.textContent;
    }

    targetEl.appendChild(el);
  });
}

/**
 * Render affiliate banners into their designated placement slots.
 *
 * Placement values: 'header' | 'footer' | 'sidebar' | 'content'
 * Target selectors: [data-affiliate-placement="header"] etc.
 *
 * @param {Array} links  Array of affiliate link objects from Firestore
 */
function renderAffiliateBanners(links) {
  if (!Array.isArray(links) || !links.length) return;

  const enabledLinks = links.filter(l => l.enabled);
  if (!enabledLinks.length) return;

  enabledLinks.forEach(link => {
    if (!link.url || !link.placement) return;

    const container = document.querySelector(
      `[data-affiliate-placement="${link.placement}"]`
    );
    if (!container) return; // slot not on this page — skip silently

    const anchor = document.createElement('a');
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer sponsored';
    anchor.setAttribute('aria-label', link.name || 'Sponsored link');

    if (link.bannerUrl) {
      const img = document.createElement('img');
      img.src = link.bannerUrl;
      img.alt = link.name || 'Sponsored';
      img.style.cssText = 'max-width:100%;height:auto;display:block;';
      anchor.appendChild(img);
    } else {
      // Text fallback if no banner image provided
      anchor.textContent = link.name || 'Sponsored';
      anchor.style.cssText = 'display:inline-block;padding:8px 16px;';
    }

    container.appendChild(anchor);
  });
}

/**
 * Show/hide the footer donation link based on Firestore config.
 *
 * @param {boolean} enabled
 */
function toggleDonationLink(enabled) {
  // FIX #08: removeAttribute('hidden') alone can't override CSS display:none
  // Must also remove inline display and add visibility class
  if (!enabled) return;
  const el = document.getElementById('footer-donate-link');
  if (el) {
    el.removeAttribute('hidden');
    el.style.removeProperty('display');
    el.classList.add('is-visible');
  }
}

/**
 * Main entry point — call once per page.
 * Reads config/siteSettings from Firestore and injects everything.
 */
export async function initAds() {
  // FIX #07: Admin-page guard — ads never run on /admin/* pages (Build Prompt Rule #11)
  if (window.location.pathname.includes('/admin')) return;

  let snap;
  try {
    snap = await getDoc(doc(db, 'config', 'siteSettings'));
  } catch (err) {
    // Firestore unavailable or offline — fail silently, never break the page
    return;
  }

  if (!snap.exists()) return;

  const settings = snap.data();

  // ── Ad Scripts ─────────────────────────────────────────────────────────────
  if (settings.ads?.adsEnabled === true) {
    injectAdScript(settings.ads.headerScript,  'head');
    injectAdScript(settings.ads.footerScript,  'body-end');
    injectAdScript(settings.ads.sidebarScript, '[data-ad-placement="sidebar"]');
    injectAdScript(settings.ads.contentScript, '[data-ad-placement="in-content"]');
  }

  // ── Affiliate Banners ───────────────────────────────────────────────────────
  if (settings.affiliate?.affiliateEnabled === true) {
    renderAffiliateBanners(settings.affiliate.links);
  }

  // ── Donation Footer Link ────────────────────────────────────────────────────
  toggleDonationLink(settings.donationLinks?.donationEnabled === true);
}