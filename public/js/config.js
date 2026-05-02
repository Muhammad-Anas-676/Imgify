// ⚠ SECURITY WARNING: Add config.js to .gitignore before committing.
// This file contains API keys and must NEVER be pushed to a public repository.
// Add this line to your .gitignore: public/js/config.js

// =============================================================================
// IMGIFY — Runtime Configuration
// Single source of truth for all constants, keys, and feature flags.
// ALL other JS files import from this file. Never duplicate these values.
// Author: Muhammad Anas | Domain: imgify.site
// =============================================================================

// ---------------------------------------------------------------------------
// FIREBASE CONFIGURATION
// Used in: firebase-init.js (imported as FIREBASE_CONFIG)
// Get these values from: Firebase Console → Project Settings → Your apps → SDK setup
// ---------------------------------------------------------------------------
/** @type {Object} Firebase project config — replace ALL placeholder values */
export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyC0L_2kkytRGFwueHE9IhFrdyFlUhrC3ho",
  authDomain:        "imgify-50db2.firebaseapp.com",         // e.g. your-project.firebaseapp.com
  projectId:         "imgify-50db2",           // e.g. imgify-prod
  storageBucket:     "imgify-50db2.firebasestorage.app",       // e.g. your-project.appspot.com
  messagingSenderId: "704292642187",  // numeric string
  appId:             "1:704292642187:web:927532aed7af365128638e",               // 1:xxx:web:xxx format
  measurementId:     "G-5Y5C12R1GR",       // G-XXXXXXXXXX (optional, Analytics)
};

// ---------------------------------------------------------------------------
// IMGBB API
// Used in: upload.js (image upload endpoint)
// Get your key from: https://api.imgbb.com → "Get API key"
// ---------------------------------------------------------------------------
/** @type {string} ImgBB API key — free tier: 32MB/image, unlimited storage */
export const IMGBB_API_KEY = "YOUR_IMGBB_API_KEY";

// ---------------------------------------------------------------------------
// SITE METADATA
// Used in: all pages for OG tags, footer branding, admin emails
// ---------------------------------------------------------------------------
/** @type {string} Human-readable site name used throughout the UI */
export const SITE_NAME = "Imgify";

/** @type {string} Canonical public URL — no trailing slash */
export const SITE_URL = "https://imgify.site";

/** @type {string} Short tagline used in hero section and OG meta description */
export const SITE_TAGLINE = "Upload. Share. Done. — Zero friction image hosting.";

/** @type {string} Admin contact email — shown in footer and error pages */
export const ADMIN_EMAIL = "admin@imgify.site";

// ---------------------------------------------------------------------------
// FEATURE FLAGS
// Used in: all JS modules to conditionally render/enable features
// Set to true/false to toggle features without touching individual modules.
// Note: FEATURE_ADS acts as master switch — Firestore config/siteSettings
//       can override this at runtime (Firestore wins when both are set).
// ---------------------------------------------------------------------------
/** @type {boolean} Enable client-side Canvas image editor (crop/rotate/flip/adjust) */
export const FEATURE_EDITOR = true;

/** @type {boolean} Enable multi-file bulk upload with per-file progress bars */
export const FEATURE_BULK_UPLOAD = true;

/** @type {boolean} Enable Albums / Collections (grouping + ZIP download) */
export const FEATURE_ALBUMS = true;

/** @type {boolean} Allow users to enter a custom slug for their image URL */
export const FEATURE_CUSTOM_SLUGS = true;

/** @type {boolean} Allow images to be password-protected (client-side SHA-256) */
export const FEATURE_PASSWORD_PROTECT = true;

/** @type {boolean} Enable QR code generation with color customization + PNG download */
export const FEATURE_QR_CODE = true;

/** @type {boolean} Show Open Graph preview card (WhatsApp / Twitter / Facebook mock) */
export const FEATURE_OG_PREVIEW = true;

/** @type {boolean} Enable /donate.html page + "Support Us" link in footer */
export const FEATURE_DONATION = true;

/** @type {boolean} Master ads switch — Firestore ads.adsEnabled overrides at runtime */
export const FEATURE_ADS = false;

// ---------------------------------------------------------------------------
// UPLOAD LIMITS
// Used in: upload.js, options-panel.js
// ---------------------------------------------------------------------------
/** @type {number} Maximum allowed file size per image in megabytes */
export const MAX_FILE_SIZE_MB = 32;

/** @type {number} Maximum number of files allowed in a single bulk upload batch */
export const MAX_BULK_FILES = 20;

/** @type {string[]} Accepted MIME types for file input validation */
export const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
];

/** @type {number} Default image expiry in days — 0 means never expires */
export const DEFAULT_EXPIRY_DAYS = 0;

// ---------------------------------------------------------------------------
// CDN URLs
// Used in: qrcode-helper.js (CDN_QRCODE), albums.js / upload.js (CDN_JSZIP),
//          firebase-init.js (CDN_FIREBASE_BASE)
// These are centralized here so any CDN version bump requires only one edit.
// ---------------------------------------------------------------------------
/** @type {string} JSZip CDN — lazy-loaded only after bulk upload success */
export const CDN_JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

/** @type {string} qrcode.js CDN — lazy-loaded only when result panel renders */
export const CDN_QRCODE = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";

/** @type {string} Firebase SDK 10.x ESM CDN base URL — append module filename to use */
export const CDN_FIREBASE_BASE = "https://www.gstatic.com/firebasejs/10.12.0/";

// ---------------------------------------------------------------------------
// SESSION / STORAGE KEYS
// Used in: theme.js (THEME_KEY), admin-auth.js (SESSION_KEY)
// Centralizing these prevents key mismatch bugs across modules.
// ---------------------------------------------------------------------------
/** @type {string} localStorage key for persisting the anonymous session token */
export const SESSION_KEY = "imgify-session";

/** @type {string} localStorage key for persisting the user's theme preference */
export const THEME_KEY = "imgify-theme";

// ---------------------------------------------------------------------------
// DEFAULT EXPORT — convenience object for wildcard imports
// Usage: import config from './config.js'; then config.SITE_NAME etc.
// ---------------------------------------------------------------------------
export default {
  FIREBASE_CONFIG,
  IMGBB_API_KEY,
  SITE_NAME,
  SITE_URL,
  SITE_TAGLINE,
  ADMIN_EMAIL,
  FEATURE_EDITOR,
  FEATURE_BULK_UPLOAD,
  FEATURE_ALBUMS,
  FEATURE_CUSTOM_SLUGS,
  FEATURE_PASSWORD_PROTECT,
  FEATURE_QR_CODE,
  FEATURE_OG_PREVIEW,
  FEATURE_DONATION,
  FEATURE_ADS,
  MAX_FILE_SIZE_MB,
  MAX_BULK_FILES,
  ALLOWED_TYPES,
  DEFAULT_EXPIRY_DAYS,
  CDN_JSZIP,
  CDN_QRCODE,
  CDN_FIREBASE_BASE,
  SESSION_KEY,
  THEME_KEY,
};