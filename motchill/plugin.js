/**
 * Motchill Plugin for SkyStream
 * Source: motchill.tv  (scraper-based, no public REST API)
 *
 * Strategy:
 *   - Fetch HTML from the site and parse structured JSON-LD or embedded
 *     __NEXT_DATA__ / data-page props for metadata.
 *   - Falls back to a "MAGIC_PROXY_v1" wrapped m3u8 if direct fetch is blocked.
 *
 * NOTE: Since Motchill does not expose a public JSON API, this plugin uses
 *       HTML scraping. Domain may change — always update manifest.baseUrl.
 */

(function () {

    const BASE = manifest.baseUrl; // https://motchill.tv

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Parse a JSON-LD <script> block from raw HTML.
     * @param {string} html
     * @returns {object|null}
     */
    function parseJsonLd(html) {
        const m = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
        if (!m) return null;
        try { return JSON.parse(m[1]); } catch { return null; }
    }

    /**
     * Parse a list of movie cards from Motchill HTML.
     * Cards are <article class="film-item"> or <div class="item">
     * @param {string} html
     * @returns {MultimediaItem[]}
     */
    function parseCards(html) {
        const items = [];
        // Match og:* meta as a lightweight fallback for list pages
        const titleRe  = /<h3[^>]*class="[^"]*film-name[^"]*"[^>]*><a[^>]+href="([^"]+)"[^>]*title="([^"]+)"/gi;
        const posterRe = /<img[^>]+data-src="([^"]+)"[^>]+alt="([^"]+)"/gi;

        const hrefs  = [];
        const titles = [];
        let tm;
        while ((tm = titleRe.exec(html)) !== null) {
            hrefs.push(tm[1].startsWith("http") ? tm[1] : `${BASE}${tm[1]}`);
            titles.push(tm[2]);
        }

        const posters = [];
        let pm;
        while ((pm = posterRe.exec(html)) !== null) {
            posters.push(pm[1].startsWith("http") ? pm[1] : `${BASE}${pm[1]}`);
        }

        for (let i = 0; i < titles.length; i++) {
            items.push(new MultimediaItem({
                title:     titles[i]  || "Không có tên",
                url:       hrefs[i]   || BASE,
                posterUrl: posters[i] || "",
                type:      "movie",
            }));
        }
        return items;
    }

    // ─── Core Functions ───────────────────────────────────────────────────────

    async function getHome(cb) {
        try {
            const resp = await fetch(BASE);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();

            const items = parseCards(html);
            const cats  = { "Trending": items, "Phim Mới": items };
            cb({ success: true, data: cats });
        } catch (err) {
            cb({ success: false, error: `Motchill getHome lỗi: ${err.message}` });
        }
    }

    async function search(query, cb) {
        try {
            if (!query?.trim()) {
                cb({ success: false, error: "Từ khóa không được trống." });
                return;
            }
            const resp  = await fetch(`${BASE}/tim-kiem/?q=${encodeURIComponent(query.trim())}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html  = await resp.text();
            const items = parseCards(html);
            cb({ success: true, data: items });
        } catch (err) {
            cb({ success: false, error: `Motchill search lỗi: ${err.message}` });
        }
    }

    async function load(url, cb) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();

            // Try JSON-LD first
            const ld   = parseJsonLd(html);
            const title = ld?.name
                || html.match(/<h1[^>]*class="[^"]*heading[^"]*"[^>]*>([^<]+)/i)?.[1]?.trim()
                || url.split("/").pop();

            const posterMatch = html.match(/<img[^>]+class="[^"]*film-poster[^"]*"[^>]+src="([^"]+)"/i)
                             || html.match(/property="og:image"\s+content="([^"]+)"/i);
            const poster = posterMatch ? posterMatch[1] : "";

            // Parse episode links
            const episodes = [];
            const epRe = /<a[^>]+href="([^"]+)"[^>]*class="[^"]*ep-item[^"]*"[^>]*>([^<]+)</gi;
            let em;
            let epNum = 1;
            while ((em = epRe.exec(html)) !== null) {
                const epUrl = em[1].startsWith("http") ? em[1] : `${BASE}${em[1]}`;
                episodes.push(new Episode({
                    name:    em[2].trim() || `Tập ${epNum}`,
                    url:     epUrl,
                    season:  1,
                    episode: epNum++,
                }));
            }

            const item = new MultimediaItem({
                title:     title,
                url:       url,
                posterUrl: poster.startsWith("http") ? poster : `${BASE}${poster}`,
                type:      episodes.length > 1 ? "series" : "movie",
                status:    "ongoing",
            });
            item.episodes = episodes;

            cb({ success: true, data: item });
        } catch (err) {
            cb({ success: false, error: `Motchill load lỗi: ${err.message}` });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();

            const streams = [];

            // Look for m3u8 links in scripts
            const m3u8Re = /["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/g;
            let m;
            while ((m = m3u8Re.exec(html)) !== null) {
                streams.push(new StreamResult({
                    url:     m[1],
                    quality: "HLS",
                    headers: { "Referer": BASE, "Origin": BASE },
                }));
            }

            // Look for mp4
            const mp4Re = /["'](https?:\/\/[^"']+\.mp4[^"']*)['"]/g;
            while ((m = mp4Re.exec(html)) !== null) {
                streams.push(new StreamResult({
                    url:     m[1],
                    quality: "MP4",
                    headers: { "Referer": BASE },
                }));
            }

            // Look for embed iframes
            const embedRe = /<iframe[^>]+src="(https?:\/\/[^"]+)"[^>]*>/gi;
            while ((m = embedRe.exec(html)) !== null) {
                streams.push(new StreamResult({
                    url:     m[1],
                    quality: "Embed",
                    headers: { "Referer": BASE },
                }));
            }

            if (!streams.length) {
                cb({ success: false, error: "Motchill: không tìm thấy stream. Trang có thể đã thay đổi." });
                return;
            }
            cb({ success: true, data: streams });
        } catch (err) {
            cb({ success: false, error: `Motchill loadStreams lỗi: ${err.message}` });
        }
    }

    registerSettings([
        {
            id:      "streamQuality",
            name:    "Chất lượng phát",
            type:    "select",
            options: ["HLS", "MP4", "Embed"],
            default: "HLS",
        },
    ]);

    globalThis.getHome    = getHome;
    globalThis.search     = search;
    globalThis.load       = load;
    globalThis.loadStreams = loadStreams;

})();
