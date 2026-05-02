<div align="center">

<img src="public/assets/logo.svg" alt="Imgify Logo" width="80" />

# Imgify

**Zero-friction image hosting. Upload → Get URL → Done.**

[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.3.0-green?style=flat-square)](#)
[![Deploy](https://img.shields.io/badge/deploy-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com)
[![Firebase](https://img.shields.io/badge/backend-Firebase-orange?style=flat-square&logo=firebase)](https://firebase.google.com)
[![Domain](https://img.shields.io/badge/live-imgify.site-blueviolet?style=flat-square)](https://imgify.site)

</div>

---

## Overview

Imgify is a production-grade, self-hosted image hosting platform built with vanilla HTML5, CSS3, and ES6 modules — no frameworks, no bloat. Users upload images and instantly receive shareable URLs. Admins get a full-featured dashboard for content moderation, analytics, and monetization controls.

> Built for performance, designed for simplicity, engineered for scale.

---

## Feature Set

| Category | Features |
|---|---|
| **Upload** | Drag & drop, bulk upload (up to 20 files), per-file progress bars |
| **Editor** | Canvas-based crop, rotate, flip, brightness/contrast adjust |
| **Sharing** | Direct URL, QR code with color customization, OG preview card |
| **Privacy** | Password-protected images, custom slugs, expiry dates |
| **Albums** | Group images into collections, ZIP download |
| **Admin** | Dashboard, analytics charts, user management, content moderation |
| **Monetization** | Google AdSense integration, affiliate links, donation page |
| **Auth** | Firebase Auth — admin-only, anonymous sessions for users |

---

## Tech Stack

```
Frontend    →  Vanilla HTML5 + CSS3 + ES6 Modules
Auth        →  Firebase Authentication
Database    →  Cloud Firestore
Image CDN   →  ImgBB API (32MB/image, unlimited storage)
Hosting     →  Vercel (outputDirectory: public)
Charts      →  Chart.js
Icons       →  Lucide Icons
QR Codes    →  qrcode.js (CDN, lazy-loaded)
ZIP         →  JSZip (CDN, lazy-loaded)
```

---

## Project Structure

```
Imgify/
├── vercel.json           # Vercel config — outputDirectory: public
├── firebase.json         # Firebase config
├── firestore.rules       # Firestore security rules
├── package.json          # type: module
├── .gitignore
│
├── api/
│   └── upload.js         # Vercel serverless function (Node 20.x)
│
└── public/
    ├── index.html         # Homepage / upload page
    ├── dashboard.html     # User image dashboard
    ├── image.html         # Single image view + share
    ├── album.html         # Album view
    ├── donate.html        # Donation page
    ├── 404.html           # Error page
    │
    ├── admin/             # Admin panel (auth-gated)
    │   ├── index.html     # Admin dashboard
    │   ├── images.html
    │   ├── albums.html
    │   ├── users.html
    │   ├── reports.html
    │   ├── settings.html
    │   └── login.html
    │
    ├── js/
    │   ├── config.js           # ⚠️ All keys & constants — never commit
    │   ├── firebase-init.js    # Firebase SDK bootstrap
    │   ├── theme.js            # Dark/light mode
    │   ├── upload.js           # Core upload logic
    │   ├── dashboard.js
    │   ├── image-view.js
    │   ├── album-view.js
    │   ├── editor.js
    │   ├── options-panel.js
    │   ├── qrcode-helper.js
    │   ├── ads-manager.js
    │   └── admin/
    │       ├── admin-auth.js
    │       ├── admin-dash.js
    │       ├── admin-images.js
    │       ├── admin-albums.js
    │       ├── admin-users.js
    │       ├── admin-reports.js
    │       ├── admin-settings.js
    │       └── admin-analytics.js
    │
    ├── css/
    │   ├── global.css
    │   ├── layout.css
    │   ├── components.css
    │   ├── pages.css
    │   └── admin.css
    │
    └── assets/
        ├── favicon.ico
        ├── logo.svg
        └── og-image.png
```

---

## Setup Guide

### Prerequisites

- Node.js 20+
- Firebase project (free Spark plan works)
- ImgBB account (free)
- Vercel account (free)

---

### A — Firebase Setup

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. **Add project** → name it `imgify` → disable Analytics → **Create project**
3. Click `</>` (Web) → register app as `imgify-web` → copy the `firebaseConfig` object → paste into `public/js/config.js`

**Enable Firestore:**
- Build → Firestore Database → **Create database** → Production mode
- Region: `asia-south1` (Mumbai — closest to Pakistan)

**Enable Authentication:**
- Build → Authentication → Get Started → Email/Password → **Enable**

**Create admin user:**
- Authentication → Users → **Add user**
- Note the **UID** shown

**Create admin Firestore document:**
```
Collection : users
Document ID: <paste UID>
Fields:
  uid       (string)  → <the UID>
  email     (string)  → your email
  role      (string)  → admin
  createdAt (timestamp) → now
```

**Create site settings document:**
```
Collection : config
Document ID: siteSettings
Fields: (see Firebase schema in PRD v1.5)
  ads.adsEnabled        → false
  donationLinks.enabled → false
```

---

### B — ImgBB API Key

1. Sign up at [imgbb.com](https://imgbb.com)
2. Go to [api.imgbb.com](https://api.imgbb.com) → **Get API key**
3. Paste into `config.js` as `IMGBB_API_KEY`

> Free tier: 32MB/image · Unlimited storage · No deletion via API

---

### C — config.js Setup

> ⚠️ `config.js` is in `.gitignore` — never commit it to a public repo.

```js
export const FIREBASE_CONFIG = {
  apiKey:            "your-api-key",
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project-id",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "your-sender-id",
  appId:             "your-app-id",
};

export const IMGBB_API_KEY = "your-imgbb-key";
```

---

### D — Deploy to Vercel

1. Push repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import `Imgify`
3. Configure:
   ```
   Framework Preset  → Other
   Output Directory  → public
   ```
4. Click **Deploy**

**Custom domain:**
- Vercel Dashboard → Project → Settings → Domains → Add `imgify.site`
- Update DNS at your registrar with Vercel's provided records

---

### E — Ads Manager (Post AdSense Approval)

1. Site must be live on a real domain before applying
2. Apply at [adsense.google.com](https://adsense.google.com) → approval takes 7–14 days
3. After approval → Admin → Settings → **Ads Manager**:
   - Paste AdSense publisher script
   - Configure sidebar / in-content ad units
   - Toggle **Ads Master** → ON → Save

> `ads-manager.js` injects scripts on every page. Toggle OFF anytime to pause all ads instantly.

---

### F — Donation & Affiliate Setup

**Donations:**
- Admin → Settings → Donation Settings → Enable → fill EasyPaisa / JazzCash / Payoneer details → Save

**Affiliate Links:**
- Admin → Settings → Affiliate Links Manager → **+ Add New** → fill name, URL, placement → Enable

---

## Launch Checklist

```
Infrastructure
  ✅  config.js filled with real Firebase + ImgBB values
  ✅  .gitignore verified — config.js excluded
  ✅  Firestore rules deployed
  ✅  config/siteSettings document created in Firestore
  ✅  Admin user created (Firebase Auth + Firestore doc with role: admin)
  ✅  Site deployed on Vercel with outputDirectory: public
  ✅  Custom domain connected + HTTPS working

Feature Verification
  ✅  Upload single image → URL generated and copyable
  ✅  Bulk upload 3 images → per-file progress bars work
  ✅  Editor: crop image → verify cropped version uploads
  ✅  Custom slug → verify /i/slug URL resolves
  ✅  Password-protect image → verify gate appears in incognito
  ✅  QR code → generate → download PNG
  ✅  OG preview card → verify WhatsApp / Twitter / Facebook mocks
  ✅  Create album → add images → ZIP download works
  ✅  Visit /admin/login.html → login with admin credentials
  ✅  Admin analytics → all charts render
  ✅  Admin settings → test ad script injection → toggle ON/OFF
  ✅  Donation page → /donate.html shows configured payment methods
  ✅  Session persistence → close browser → reopen → auto-login works
```

---

## Security Notes

- `public/js/config.js` is in `.gitignore` — **never push it to a public repo**
- Firebase API keys are safe to expose client-side — real security lives in **Firestore Rules**
- Admin routes are protected by Firebase Auth token verification
- All image URLs are ImgBB-hosted — no storage cost on your end

---

## Author

**Muhammad Anas**
[imgify.site](https://imgify.site) · [github.com/Muhammad-Anas-676](https://github.com/Muhammad-Anas-676)

---

<div align="center">
<sub>Built with zero frameworks. Just clean HTML, CSS, and JavaScript.</sub>
</div>
