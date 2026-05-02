// public/js/albums.js
// File 14/43 — Imgify | Album CRUD for session-based (no-login) users

import { db } from './firebase-init.js';
import {
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  collection,
  query,
  where,
  orderBy,
  serverTimestamp,
  increment
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// nanoid(8) — browser-native, no dependency
function nanoid(size = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

const ALBUMS_COL = 'albums';

// ─── Init ──────────────────────────────────────────────────────────────────
// Sets up album state for the session. Currently a no-op hook — reserved for
// future caching / realtime listeners.
export function initAlbums(sessionId) {
  if (!sessionId) return null;
  return { sessionId };
}

// ─── List ──────────────────────────────────────────────────────────────────
export async function getSessionAlbums(sessionId) {
  if (!sessionId) return [];
  try {
    const q = query(
      collection(db, ALBUMS_COL),
      where('sessionId', '==', sessionId),
      where('deleted', '==', false),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('[albums] getSessionAlbums:', err);
    return [];
  }
}

// ─── Create ────────────────────────────────────────────────────────────────
export async function createAlbum(sessionId, name, description = null, privacy = 'public') {
  if (!sessionId || !name) return null;
  try {
    const albumId = nanoid(8);
    const payload = {
      albumId,
      uid: null,
      sessionId,
      name: String(name).slice(0, 80),
      description: description || null,
      coverImageId: null,
      coverImageUrl: null,
      imageCount: 0,
      privacy: ['public', 'unlisted', 'private'].includes(privacy) ? privacy : 'public',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      deleted: false
    };
    const ref = await addDoc(collection(db, ALBUMS_COL), payload);
    return { id: ref.id, ...payload };
  } catch (err) {
    console.error('[albums] createAlbum:', err);
    return null;
  }
}

// ─── Add Image ─────────────────────────────────────────────────────────────
export async function addImageToAlbum(albumId, imageId, imgbbThumbUrl) {
  if (!albumId || !imageId) return null;
  try {
    const ref = doc(db, ALBUMS_COL, albumId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;

    const existing = snap.data();
    const updates = {
      imageCount: increment(1),
      updatedAt: serverTimestamp()
    };

    // Only set cover if not already set
    if (!existing.coverImageUrl) {
      updates.coverImageId = imageId;
      updates.coverImageUrl = imgbbThumbUrl || null;
    }

    await updateDoc(ref, updates);
    return true;
  } catch (err) {
    console.error('[albums] addImageToAlbum:', err);
    return null;
  }
}

// ─── Remove Image ──────────────────────────────────────────────────────────
export async function removeImageFromAlbum(albumId) {
  if (!albumId) return null;
  try {
    const ref = doc(db, ALBUMS_COL, albumId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;

    const current = snap.data().imageCount ?? 0;
    await updateDoc(ref, {
      imageCount: current > 0 ? increment(-1) : 0,
      updatedAt: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.error('[albums] removeImageFromAlbum:', err);
    return null;
  }
}

// ─── Soft Delete ───────────────────────────────────────────────────────────
export async function deleteAlbum(albumId) {
  if (!albumId) return null;
  try {
    const ref = doc(db, ALBUMS_COL, albumId);
    await updateDoc(ref, {
      deleted: true,
      updatedAt: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.error('[albums] deleteAlbum:', err);
    return null;
  }
}