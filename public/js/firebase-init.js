/**
 * @file firebase-init.js // FIX: Renamed from Firebase-init.js → firebase-init.js (case-sensitive Linux fix, Bug #01)
 * @description Initialises Firebase once and exports the shared app, db, and auth
 *              instances used by every other module in the Imgify platform.
 *
 * CDN base reference (from config.js CDN_FIREBASE_BASE):
 *   https://www.gstatic.com/firebasejs/10.12.0/
 *
 * NOTE: ESM static `import` statements require string literals — the base URL
 *       cannot be interpolated at import-declaration level.  CDN_FIREBASE_BASE
 *       is imported purely for documentation / runtime verification purposes.
 *
 * @module firebase-init
 * @author Muhammad Anas
 */

// ─── Config ──────────────────────────────────────────────────────────────────
import { FIREBASE_CONFIG, CDN_FIREBASE_BASE } from './config.js';

// ─── Firebase SDK — modular ESM from CDN (10.x) ──────────────────────────────
import {
  initializeApp,
  getApps,
  getApp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';

import {
  getFirestore,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ─── Runtime CDN sanity-check (dev-only, no-op in production) ────────────────
if (import.meta.env?.MODE === 'development') {
  const expectedBase = 'https://www.gstatic.com/firebasejs/10.12.0/';
  if (CDN_FIREBASE_BASE !== expectedBase) {
    console.warn(
      `[firebase-init] CDN_FIREBASE_BASE mismatch.\n` +
      `  config.js says : ${CDN_FIREBASE_BASE}\n` +
      `  imports use    : ${expectedBase}\n` +
      `  Update import statements if you bump the SDK version.`
    );
  }
}

// ─── Initialise ──────────────────────────────────────────────────────────────
/**
 * The Firebase app instance.
 * Guarded against double-init (safe for HMR / hot-reload environments).
 *
 * @type {import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js').FirebaseApp}
 */
const app = getApps().length === 0
  ? initializeApp(FIREBASE_CONFIG)
  : getApp();

/**
 * The Firestore database instance.
 * Used by upload.js, dashboard.js, image-view.js, album-view.js,
 * ads-manager.js, and all admin-*.js modules.
 *
 * @type {import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js').Firestore}
 */
const db = getFirestore(app);

/**
 * The Firebase Auth instance.
 * Used exclusively by admin-auth.js — no public-user auth exists in Imgify.
 *
 * @type {import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js').Auth}
 */
const auth = getAuth(app);

// ─── Persistence — async IIFE (must be awaited before admin checks run) ──────
/**
 * Applies browserLocalPersistence so the admin session survives tab/browser
 * closure.  Called once at module evaluation time; subsequent page loads
 * inherit the persisted session automatically via onAuthStateChanged().
 *
 * @returns {Promise<void>}
 */
(async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (err) {
    // Non-fatal: persistence may be unsupported in certain iframe contexts.
    console.warn('[firebase-init] setPersistence failed:', err.message);
  }
})();

// ─── Exports ─────────────────────────────────────────────────────────────────

/** @type {import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js').FirebaseApp} */
export { app };

/** @type {import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js').Firestore} */
export { db };

/** @type {import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js').Auth} */
export { auth };

/**
 * Default export for consumers that prefer destructuring from a single import.
 *
 * @example
 * import Firebase from './firebase-init.js';
 * const { db, auth } = Firebase;
 *
 * @type {{ app: FirebaseApp, db: Firestore, auth: Auth }}
 */
export default { app, db, auth };
