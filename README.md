# Imgify — Image Hosting Platform

> Upload → Get URL → Done. Zero friction. Zero accounts for users.

**Version:** 1.3 | **Author:** Muhammad Anas | **Domain:** imgify.site

---

## Stack at a Glance

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML5 + CSS3 + ES6 (no framework) |
| Auth | Firebase Auth (admin only) |
| Database | Firebase Firestore |
| Image CDN | ImgBB API |
| Hosting | Firebase Hosting |
| Charts | Chart.js |
| Icons | Lucide Icons |

---

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Section A: Firebase Project Setup
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Go to https://console.firebase.google.com
2. Click **"Add project"** → enter project name `imgify` → Continue
3. Disable Google Analytics (not needed) → **Create project**
4. Click the **Web** icon (`</>`), register app as `imgify-web`
5. Copy the `firebaseConfig` object shown — paste into `public/js/config.js`
6. **Enable Firestore:**
   - Left menu → Build → Firestore Database → **Create database**
   - → Start in **production mode**
   - → Choose region closest to Pakistan: **asia-south1 (Mumbai)**
7. **Enable Authentication:**
   - Left menu → Build → Authentication → **Get Started**
   - → Sign-in method → **Email/Password** → Enable → Save
8. **Create admin user:**
   - Authentication → Users → **Add user**
   - Email: `your-email@gmail.com` | Password: strong password
   - Note the **UID** shown (copy it)
9. **Create admin Firestore document:**
   - Firestore → Start collection → Collection ID: `users`
   - Document ID: paste the UID you copied
   - Add fields:
     | Field | Type | Value |
     |---|---|---|
     | uid | string | (the UID) |
     | email | string | your email |
     | role | string | **admin** |
     | createdAt | timestamp | now |
10. **Create config/siteSettings document:**
    - Firestore → New collection → `config`
    - Document ID: `siteSettings`
    - Add all fields from PRD v1.5 Firebase Schema section
    - Set `ads.adsEnabled: false` initially (enable after AdSense approval)
    - Set `donationLinks.donationEnabled: false` initially
11. **Enable Firebase Hosting:**
    - Left menu → Build → Hosting → **Get Started**
    - Install Firebase CLI:
      ```bash
      npm install -g firebase-tools
      ```
    - In project folder:
      ```bash
      firebase login
      firebase init hosting
      ```
    - Select `public` as hosting folder when asked
12. **Deploy Firestore rules:**
    ```bash
    firebase deploy --only firestore:rules
    ```
13. **Deploy site:**
    ```bash
    firebase deploy --only hosting
    ```

---

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Section B: ImgBB API Key Setup
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Go to https://imgbb.com → Sign up for free account
2. After login, go to https://api.imgbb.com
3. Click **"Get API key"** — your key will be shown immediately
4. Copy the key, paste into `config.js` as the `IMGBB_API_KEY` value
5. Free tier limits:
   - Max image size: **32MB** per upload
   - Storage: **unlimited**
   - Rate limit: generous for hobby/small production use
   - Deletion: **NOT supported** via API (free tier limitation)
6. Test: upload one image through your site and verify the URL works

---

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Section C: Ads Manager Setup (v1.3)
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Your site **MUST** be live on a real domain before applying for AdSense
2. Go to https://adsense.google.com → Sign in → Enter `imgify.site`
3. Complete the site verification step AdSense provides
4. Wait for approval — typically **7 to 14 days**
5. After approval, go to AdSense → Ads → By ad unit → **Create ad units**
6. For auto-ads: copy the AdSense publisher script (contains your `pub-ID`)
7. In Imgify Admin → Settings → **Ads Manager** tab:
   - a. Paste the full AdSense publisher script into **"Header Ad Script"**
   - b. Paste individual ad unit codes into Sidebar / In-Content as needed
   - c. Toggle **"Ads Master"** to ON
   - d. Click **Save**
8. `ads-manager.js` will now inject these scripts on every page load — no code changes required. Toggle OFF anytime to disable all ads instantly.

---

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Section D: Affiliate & Donation Setup
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Affiliate Links

1. Admin → Settings → **Affiliate Links Manager** tab
2. Click **"+ Add New Affiliate Link"**
3. Fill:
   - Name (e.g. `Hostinger`)
   - URL (your affiliate URL with tracking code)
   - Banner Image URL (optional)
   - Placement (`header` / `footer` / `sidebar` / `content`)
4. Enable the toggle for each link
5. Enable **"Affiliate Master"** toggle
6. Save — banners appear on all user-facing pages immediately

### Donation Page

1. Admin → Settings → **Donation Settings** tab
2. Enable **"Donation Toggle"**
3. Fill:
   - EasyPaisa number + instructions
   - JazzCash number + instructions
   - Payoneer email + instructions
4. Set custom headline and subtext if desired
5. Save — `/donate.html` now shows configured payment methods + **"Support Us ☕"** link appears in all page footers

---

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Section E: Custom Domain Setup
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Firebase Console → Hosting → **Add custom domain**
2. Enter: `imgify.site` → Continue
3. Firebase will give you 2 DNS records (A records or TXT for verification)
4. Log in to your domain registrar → Add the DNS records Firebase shows
5. DNS propagation takes **24–48 hours** (usually much faster)
6. HTTPS/SSL is automatic — Firebase provisions it free via Let's Encrypt
7. Verify: visit `https://imgify.site` — site should load securely

---

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Section F: First Launch Checklist
## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Complete every item before going live:

- [ ] `config.js` filled with all real values (**never commit this file to Git**)
- [ ] `.gitignore` verified — `config.js` must be in it
- [ ] Firestore rules deployed: `firebase deploy --only firestore:rules`
- [ ] `config/siteSettings` document created with all fields (especially `ads` + `donationLinks`)
- [ ] Admin user created in Firebase Auth
- [ ] Admin user Firestore document created with `role: "admin"`
- [ ] Site deployed: `firebase deploy --only hosting`
- [ ] Custom domain connected and HTTPS working
- [ ] Open site in incognito → upload a single image → verify URL works
- [ ] Upload 3 images at once → verify bulk upload + per-file progress bars
- [ ] Open editor → crop a test image → verify cropped version uploads
- [ ] Set a custom slug on an image → verify `/i/slug` URL works
- [ ] Set a password → visit image URL in incognito → verify password gate
- [ ] Generate and download a QR code → verify PNG download works
- [ ] Check OG Preview card on image page → verify WhatsApp/Twitter/Facebook mocks
- [ ] Upload image with JSZip download → verify ZIP download works
- [ ] Create an album → add images → visit album URL → verify ZIP download
- [ ] Visit `/admin/login.html` → log in with admin credentials
- [ ] Check admin analytics dashboard → verify all charts render
- [ ] Admin Settings → paste a test ad script → enable ads → verify injection
- [ ] Admin Settings → configure donation links → check `/donate.html`
- [ ] Close browser completely → reopen → go to `/admin` → verify auto-login
- [ ] Submit AdSense application (site must be live first)
- [ ] After AdSense approval → paste publisher script in Ads Manager → toggle ON

---

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Setup complete. Imgify v1.3 is ready for production. 🚀
Built by Muhammad Anas · imgify.site
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
