# 🇻🇳 Vietnamese Streaming Hub — SkyStream Plugin Repo

> Rebuilt from [tearrs/cloudstream-vietnamese](https://gitlab.com/tearrs/cloudstream-vietnamese) for the **SkyStream Gen 2** plugin ecosystem.

---

## 📦 Repository Structure

```
skystream-vietnamese/
├── repo.json               ← Repository manifest (add this URL to SkyStream)
├── plugins.json            ← Plugin index
├── ophim/
│   └── plugin.js           ← OPhim (REST API)
├── kkphim/
│   └── plugin.js           ← KKPhim via phimapi.com (REST API)
├── nguonc/
│   └── plugin.js           ← NguonC (REST API)
├── motchill/
│   └── plugin.js           ← Motchill (HTML scraper)
├── phimchill/
│   └── plugin.js           ← PhimChill (Next.js __NEXT_DATA__ + scraper)
├── animehay/
│   └── plugin.js           ← AnimeHay (Nuxt3 data + scraper)
├── animevietsub/
│   └── plugin.js           ← AnimeVietsub (HTML scraper)
├── bilutv/
│   └── plugin.js           ← BiluTV (HTML scraper)
├── phim1080/
│   └── plugin.js           ← Phim1080 (HTML scraper)
└── tests/
    └── plugins.test.js     ← Unit tests (no dependencies, pure Node.js)
```

---

## 🚀 Quick Start

### 1. Add to SkyStream App

1. Open **SkyStream → Extensions → Add Source**
2. Paste the `repo.json` raw URL:
   ```
   https://raw.githubusercontent.com/YOUR_USERNAME/skystream-vietnamese/main/repo.json
   ```
3. Install any plugin you want from the list.

### 2. Deploy via GitHub Actions

```bash
git init
git remote add origin https://github.com/YOUR_USERNAME/skystream-vietnamese.git
git add .
git commit -m "Initial commit — Vietnamese Streaming Hub"
git push -u origin main
```

GitHub Actions will automatically host your `repo.json` at the raw URL above.

---

## 🔌 Plugin Overview

| Plugin | Type | Source | Strategy |
|---|---|---|---|
| **OPhim** | Movie / Series | `ophim1.com` | Public REST API |
| **KKPhim** | Movie / Series | `phimapi.com` | Public REST API |
| **NguonC** | Movie / Series | `api.nguonc.com` | Public REST API |
| **Motchill** | Movie / Series | `motchill.tv` | HTML scraper |
| **PhimChill** | Movie / Series | `phimchill.net` | Next.js `__NEXT_DATA__` + scraper |
| **AnimeHay** | Anime | `animehay.tv` | Nuxt3 data + scraper |
| **AnimeVietsub** | Anime | `animevietsub.tv` | HTML scraper |
| **BiluTV** | Series | `bilutv.org` | HTML scraper |
| **Phim1080** | Movie / Series | `phim1080.in` | HTML scraper |

---

## 🧪 Running Tests

No external test runner required. Tests use a built-in harness with mocked `fetch` and SkyStream globals.

```bash
node tests/plugins.test.js
```

Expected output:
```
▶  OPhim › getHome returns categories with Trending
  ✅  success is true
  ✅  Trending category exists
  ...
──────────────────────────────────────────────────
Results: 34 passed, 0 failed

🎉  All tests passed!
```

---

## 🛠 Local Plugin Testing (SkyStream CLI)

```bash
# Install CLI
npm install -g skystream-cli

# Test individual functions
skystream test -f getHome              # Dashboard categories
skystream test -f search -q "Squid Game"
skystream test -f load   -q "https://ophim1.com/phim/squid-game"
skystream test -f loadStreams -q "https://ophim1.com/phim/squid-game#server=full"
```

---

## ⚙️ Plugin Settings

Each plugin supports user-configurable settings accessible in the SkyStream app:

| Plugin | Settings |
|---|---|
| OPhim | Chất lượng mặc định (HLS/Embed), Loại phụ đề (Vietsub/Lồng tiếng/Thuyết minh) |
| KKPhim | Ưu tiên Vietsub (toggle), Chất lượng phát |
| NguonC | Phụ đề ưu tiên (Vietsub/Lồng tiếng) |
| Motchill | Chất lượng phát (HLS/MP4/Embed) |
| PhimChill | Chất lượng phát (HLS/Embed) |
| AnimeHay | Ưu tiên Lồng tiếng (toggle) |
| AnimeVietsub | Loại sub (Vietsub/Lồng tiếng/Thuyết minh) |
| BiluTV | Quốc gia ưu tiên, Tự động tập tiếp theo (toggle) |
| Phim1080 | Chất lượng ưu tiên (HLS 1080p/MP4/Embed), Ngôn ngữ phụ đề |

---

## 📐 Architecture Notes

### Dynamic Base URL
All plugins use `manifest.baseUrl` instead of hardcoded domains. To point a plugin at a mirror or proxy, update `baseUrl` in `plugins.json` — no code changes needed.

```json
{
  "packageName": "com.tearrs.vietnamese.ophim",
  "baseUrl": "https://your-mirror.com"
}
```

### API vs. Scraper Strategy

- **REST API plugins** (OPhim, KKPhim, NguonC) — Reliable, fast, structured JSON responses. Preferred when available.
- **HTML scraper plugins** — Use regex and DOM pattern matching. More brittle; may need updates if the target site changes its markup. A `PARSE_ERROR` usually means the site restructured its HTML.

### Stream Extraction Priority

All scraper plugins follow this waterfall:
1. Site-specific JS player object (`sources:[{file:...}]`, `jwplayer`, etc.)
2. Generic `.m3u8` URL scan
3. Generic `.mp4` URL scan
4. `<iframe>` embed URL extraction (lowest priority / fallback)

---

## ⚠️ Legal Disclaimer

This repository contains **plugin connectors only** — no media files, no streams, no copyrighted content is hosted here. All content is sourced from third-party websites at runtime. The plugin authors are not responsible for the content of those external sites. Use in compliance with the laws of your country.

---

## 📜 Original Source

Ported and adapted from: [gitlab.com/tearrs/cloudstream-vietnamese](https://gitlab.com/tearrs/cloudstream-vietnamese)
Original platform: **CloudStream** (Android Kotlin) → Rebuilt for **SkyStream Gen 2** (JavaScript)
