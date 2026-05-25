# ✅ TaskFlow – Personal & Office Task Manager

A colourful, full-featured PWA (Progressive Web App) task manager that works on **laptop (browser)** and **phone (installable app)**, with auto-sync, priority reminders, and Google Sign-In.

---

## 🚀 Features

| Feature | Status |
|---|---|
| Personal & Office task tabs | ✅ |
| Columns: Today, Tomorrow, This Week, Next Week, This Month, Next Month, Done | ✅ |
| Drag & drop tasks between columns | ✅ |
| Move tasks via dropdown menu | ✅ |
| Star (⭐) priority tasks | ✅ |
| History tab (Done tasks → archive after 24h) | ✅ |
| Auto column shifting (Tomorrow→Today next day, etc.) | ✅ |
| Google Sign-In | ✅ (needs Client ID) |
| Colourful column colour coding | ✅ |
| Save & Sync button | ✅ |
| Auto-sync every 5 minutes | ✅ |
| PWA – installable on phone & desktop | ✅ |
| Push notifications every 2h for starred tasks | ✅ |
| Offline support via Service Worker | ✅ |

---

## 📂 File Structure

```
taskflow/
├── index.html      # Main UI + layout
├── app.js          # All application logic
├── sw.js           # Service Worker (offline + notifications)
├── manifest.json   # PWA manifest
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

---

## ⚙️ Setup

### 1. Google OAuth (for real sign-in)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → **APIs & Services → Credentials**
3. Click **Create Credentials → OAuth 2.0 Client ID**
4. Application type: **Web application**
5. Add your domain to **Authorised JavaScript origins** (e.g., `https://yourusername.github.io`)
6. Copy the **Client ID**
7. In `app.js`, replace line:
   ```js
   const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
   ```
   with your actual Client ID.

### 2. Deploy to GitHub Pages (Free hosting)

```bash
# 1. Fork or clone this repo
git clone https://github.com/YOUR_USERNAME/taskflow.git
cd taskflow

# 2. Add your icons to /icons folder (192x192 and 512x512 PNG)

# 3. Push to GitHub
git add .
git commit -m "Setup TaskFlow"
git push

# 4. In GitHub repo settings → Pages → Source: main branch /root
# Your app will be live at: https://YOUR_USERNAME.github.io/taskflow/
```

### 3. Install as Phone App (PWA)

**Android (Chrome):**
- Open the site in Chrome
- Tap the 3-dot menu → **"Add to Home Screen"**

**iPhone (Safari):**
- Open the site in Safari
- Tap Share → **"Add to Home Screen"**

---

## 🔔 Push Notifications

- Browser-based notifications work out of the box when you grant permission
- They fire every **2 hours** for any ⭐ starred tasks not yet Done
- For true mobile push (when app is closed), you'll need a backend push service like **Firebase Cloud Messaging (FCM)** — see [FCM docs](https://firebase.google.com/docs/cloud-messaging)

---

## 📅 Auto Column Shifting Logic

| When | What happens |
|---|---|
| Next day | Tomorrow → Today |
| New week starts (Monday) | Next Week → This Week, This Week remnants → Today |
| New month starts | Next Month → This Month, This Month remnants → Today |
| Task marked Done for 24h | Moves to History tab |

---

## 🎨 Colour Coding

| Column | Colour |
|---|---|
| Today | 🔥 Orange `#f97316` |
| Tomorrow | 🌅 Yellow `#eab308` |
| This Week | 📆 Green `#22c55e` |
| Next Week | 🗓️ Cyan `#06b6d4` |
| This Month | 📅 Purple `#8b5cf6` |
| Next Month | 🗃️ Pink `#ec4899` |
| Done | ✅ Slate `#64748b` |

---

## 🤝 Contributing / Improvements

Open a GitHub Issue or Pull Request for:
- Firebase/Firestore backend sync (real cross-device)
- Recurring tasks
- Sub-tasks
- Labels / tags
- Export to CSV/PDF
- Dark/Light theme toggle
- Team collaboration features

---

## 📄 License

MIT License – free to use and modify.
