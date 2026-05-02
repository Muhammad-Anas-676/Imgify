/**
 * Imgify — admin-auth.js
 * File 18 / 43 | public/js/admin/admin-auth.js
 * Author: Muhammad Anas | imgify.site
 *
 * Admin auth guard module.
 * Every admin page imports initAdminAuth(callback) and calls it.
 * handleAdminLogout() is exported for logout buttons.
 */

import { auth, db } from '../firebase-init.js';
import {
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Toast helper ──────────────────────────────────────────────────────────────

function _showToast(message, type = 'error') {
  let toast = document.querySelector('.imgify-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'imgify-toast';
    document.body.appendChild(toast);
  }

  toast.classList.remove('imgify-toast--success', 'imgify-toast--error', 'imgify-toast--info');
  toast.classList.add(`imgify-toast--${type}`);
  toast.textContent = message;
  toast.classList.add('imgify-toast-visible');

  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.classList.remove('imgify-toast-visible');
  }, 3500);
}

// ── Loader overlay ────────────────────────────────────────────────────────────

function _showLoader() {
  let loader = document.getElementById('admin-auth-loader');
  if (loader) return;
  loader = document.createElement('div');
  loader.id = 'admin-auth-loader';
  loader.style.cssText = `
    position: fixed;
    inset: 0;
    background: var(--bg-primary, #0d0d0d);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    transition: opacity 0.25s ease;
  `;
  loader.innerHTML = `
    <div style="
      width: 36px;
      height: 36px;
      border: 3px solid var(--border, #2a2a2a);
      border-top-color: var(--accent, #4b7ef5);
      border-radius: 50%;
      animation: admin-auth-spin 0.75s linear infinite;
    "></div>
    <style>
      @keyframes admin-auth-spin {
        to { transform: rotate(360deg); }
      }
    </style>
  `;
  document.body.appendChild(loader);
}

function _hideLoader() {
  const loader = document.getElementById('admin-auth-loader');
  if (!loader) return;
  loader.style.opacity = '0';
  setTimeout(() => loader.remove(), 300);
}

// ── Core guard ────────────────────────────────────────────────────────────────

/**
 * initAdminAuth(onAdminReady)
 *
 * Call this at the top of every admin page script.
 * Blocks the page behind a loader until Firebase Auth state resolves.
 *
 * Flow:
 *   No user             → redirect /admin/login
 *   User + role≠admin  → signOut → show "Access denied" toast → redirect
 *   User + role=admin  → hide loader → call onAdminReady(user)
 *
 * @param {function(import('firebase/auth').User): void} onAdminReady
 */
export async function initAdminAuth(onAdminReady) {
  _showLoader();

  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    console.warn('[admin-auth] setPersistence warning:', e.message);
  }

  onAuthStateChanged(auth, async (user) => {
    // ── No user: send to login ───────────────────────────────────────────────
    if (!user) {
      _hideLoader();
      window.location.href = '/admin/login';
      return;
    }

    // ── User exists: verify admin role in Firestore ──────────────────────────
    try {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);

      const role = userSnap.exists() ? userSnap.data()?.role : null;

      if (role !== 'admin') {
        await signOut(auth);
        _hideLoader();
        _showToast('Access denied. Admin privileges required.', 'error');
        setTimeout(() => {
          window.location.href = '/admin/login';
        }, 2000);
        return;
      }

      // ── Admin confirmed ──────────────────────────────────────────────────
      _hideLoader();
      onAdminReady(user);

    } catch (err) {
      console.error('[admin-auth] Role check failed:', err);
      await signOut(auth).catch(() => {});
      _hideLoader();
      _showToast('Authentication error. Please try again.', 'error');
      setTimeout(() => {
        window.location.href = '/admin/login';
      }, 2000);
    }
  });
}

// ── Logout ────────────────────────────────────────────────────────────────────

/**
 * handleAdminLogout()
 *
 * Attach to logout buttons on any admin page.
 * Signs out Firebase Auth then redirects to login.
 */
export async function handleAdminLogout() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('[admin-auth] Logout error:', err);
  } finally {
    window.location.href = '/admin/login';
  }
}