/**
 * AnimeVietsub Plugin for SkyStream
 * Source: animevietsub.tv  (HTML scraper)
 *
 * URL patterns:
 *   Homepage      → /
 *   Search        → /tim-kiem/?s=<query>
 *   Anime detail  → /phim/<slug>/
 *   Episode watch → /phim/<slug>/tap-<N>/
 */

(function () {

    const BASE = manifest.baseUrl; // https://animevietsub.tv

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function extractJsonLd(html) {
        const m = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
        if (!m) return null;
        try { return JSON.parse(m[1]); } catch { return null; }
    }

    function parseCards(html) {
        const items = [];
        // AniVietsub card: <div class="thumbnail"> inside <li> items
        const re = /<a[^>]+href="(\/phim\/[^/"]+\/?)"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<img[^>]+(?:data-original|src|data-src)="([^"]+)"/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const u = m[1].startsWith("http") ? m[1] : `${BASE}${m[1]}`;
            const p = m[3].startsWith("http") ? m[3] : `${BASE}${m[3]}`;
            items.push(new MultimediaItem({
                title:     m[2].trim(),
                url:       u,
                posterUrl: p,
                type:      "anime",
            }));
        }
        return items;
    }

    // ─── Core Functions ───────────────────────────────────────────────────────

    async function getHome(cb) {
        try {
            const [trending, recent] = await Promise.all([
                fetch(`${BASE}/`).then(r => r.ok ? r.text() : Promise.reject(`HTTP ${r.status}`)),
                fetch(`${BASE}/danh-sach/moi-cap-nhat/`).then(r => r.ok ? r.text() : ""),
            ]);

            const cats = {
                "Trending":          parseCards(trending).slice(0, 15),
                "Mới Cập Nhật":      parseCards(recent  || trending).slice(0, 15),
                "Anime Đang Chiếu":  parseCards(trending).slice(15, 30),
            };

            cb({ success: true, data: cats });
        } catch (err) {
            cb({ success: false, error: `AnimeVietsub getHome lỗi: ${err.message}` });
        }
    }

    async function search(query, cb) {
        try {
            if (!query?.trim()) {
                cb({ success: false, error: "Từ khóa không được trống." });
                return;
            }
            const resp  = await fetch(`${BASE}/tim-kiem/?s=${encodeURIComponent(query.trim())}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html  = await resp.text();
            const items = parseCards(html);
            cb({ success: true, data: items });
        } catch (err) {
            cb({ success: false, error: `AnimeVietsub search lỗi: ${err.message}` });
        }
    }

    async function load(url, cb) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();

            const ld    = extractJsonLd(html);
            const title = ld?.name
                       ?? html.match(/<h1[^>]*itemprop="name"[^>]*>([^<]+)/i)?.[1]?.trim()
                       ?? html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1]
                       ?? "Anime";
            const poster = ld?.image
                        ?? html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1]
                        ?? "";
            const desc   = html.match(/<div[^>]+itemprop="description"[^>]*>([\s\S]*?)<\/div>/i)
                               ?.[1]?.replace(/<[^>]+>/g, "").trim().slice(0, 600) ?? "";

            // Parse episode list  /phim/<slug>/tap-<N>/
            const episodes = [];
            const epRe     = /<a[^>]+href="(\/phim\/[^"]+\/tap-(\d+)\/[^"]*)"[^>]*>([^<]*)</gi;
            let em;
            while ((em = epRe.exec(html)) !== null) {
                const epNum = parseInt(em[2], 10);
                const u     = `${BASE}${em[1]}`;
                episodes.push(new Episode({
                    name:    em[3].trim() || `Tập ${epNum}`,
                    url:     u,
                    season:  1,
                    episode: epNum,
                }));
            }

            // Remove duplicates, sort by episode number
            const seen   = new Set();
            const unique = episodes
                .filter(ep => { if (seen.has(ep.url)) return false; seen.add(ep.url); return true; })
                .sort((a, b) => a.episode - b.episode);

            const item = new MultimediaItem({
                title:       title,
                url:         url,
                posterUrl:   poster,
                type:        "anime",
                status:      "ongoing",
                description: desc,
            });
            item.episodes = unique;

            cb({ success: true, data: item });
        } catch (err) {
            cb({ success: false, error: `AnimeVietsub load lỗi: ${err.message}` });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();

            const streams = [];

            // AnimeVietsub uses jwplayer or a custom player; sources in JS object
            const srcRe = /(?:sources|file):\s*\[?\s*\{[^}]*["']?(?:file|src|url)["']?\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/gi;
            let sm;
            while ((sm = srcRe.exec(html)) !== null) {
                streams.push(new StreamResult({
                    url:     sm[1],
                    quality: "HLS",
                    headers: { "Referer": BASE, "Origin": BASE },
                }));
            }

            // Generic m3u8 scan
            const m3u8Re = /["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/g;
            let gm;
            while ((gm = m3u8Re.exec(html)) !== null) {
                if (!streams.find(s => s.url === gm[1])) {
                    streams.push(new StreamResult({
                        url:     gm[1],
                        quality: "HLS",
                        headers: { "Referer": BASE, "Origin": BASE },
                    }));
                }
            }

            const iframeRe = /<iframe[^>]+src="(https?:\/\/[^"]+)"[^>]*>/gi;
            let im;
            while ((im = iframeRe.exec(html)) !== null) {
                streams.push(new StreamResult({
                    url:     im[1],
                    quality: "Embed",
                    headers: { "Referer": BASE },
                }));
            }

            if (!streams.length) {
                cb({ success: false, error: "AnimeVietsub: không tìm thấy stream." });
                return;
            }
            cb({ success: true, data: streams });
        } catch (err) {
            cb({ success: false, error: `AnimeVietsub loadStreams lỗi: ${err.message}` });
        }
    }

    registerSettings([
        {
            id:      "subType",
            name:    "Loại sub",
            type:    "select",
            options: ["Vietsub", "Lồng tiếng", "Thuyết minh"],
            default: "Vietsub",
        },
    ]);

    globalThis.getHome    = getHome;
    globalThis.search     = search;
    globalThis.load       = load;
    globalThis.loadStreams = loadStreams;

})();
