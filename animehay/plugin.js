/**
 * AnimeHay Plugin for SkyStream
 * Source: animehay.tv  (HTML scraper — no public API)
 *
 * Structure:
 *   Homepage  → /                     (Trending)
 *   Search    → /tim-kiem/<query>
 *   Detail    → /phim-anime/<slug>
 *   Episode   → /tap-phim/<slug>-tap-<N>
 */

(function () {

    const BASE = manifest.baseUrl; // https://animehay.tv

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Extract __NUXT_DATA__ or window.__data__ from page if it exists.
     */
    function extractPageData(html) {
        // Try Nuxt 3 payload
        const nuxt3 = html.match(/<script id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
        if (nuxt3) { try { return JSON.parse(nuxt3[1]); } catch { /* ignore */ } }

        // Try window.__DATA__
        const wd = html.match(/window\.__DATA__\s*=\s*({[\s\S]*?});\s*(?:window|<\/script)/);
        if (wd)   { try { return JSON.parse(wd[1]); }   catch { /* ignore */ } }

        return null;
    }

    /**
     * Parse anime cards from AnimeHay-style HTML.
     */
    function parseAnimeCards(html) {
        const items = [];
        // AnimeHay card pattern: <div class="item"> with <a href> and <img>
        const cardRe = /<a[^>]+href="(\/phim-anime\/[^"]+)"[^>]*title="([^"]+)"[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"/gi;
        let m;
        while ((m = cardRe.exec(html)) !== null) {
            items.push(new MultimediaItem({
                title:     m[2].trim(),
                url:       `${BASE}${m[1]}`,
                posterUrl: m[3].startsWith("http") ? m[3] : `${BASE}${m[3]}`,
                type:      "anime",
            }));
        }
        return items;
    }

    // ─── Core Functions ───────────────────────────────────────────────────────

    async function getHome(cb) {
        try {
            const resp  = await fetch(BASE);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html  = await resp.text();
            const items = parseAnimeCards(html);

            // Build multiple seasonal/type buckets from the same page
            const cats = {
                "Trending":         items,
                "Anime Mùa Này":    items.slice(0,  12),
                "Anime Hoàn Thành": items.slice(12, 24),
            };
            cb({ success: true, data: cats });
        } catch (err) {
            cb({ success: false, error: `AnimeHay getHome lỗi: ${err.message}` });
        }
    }

    async function search(query, cb) {
        try {
            if (!query?.trim()) {
                cb({ success: false, error: "Từ khóa không được trống." });
                return;
            }
            const slug  = encodeURIComponent(query.trim().replace(/\s+/g, "-").toLowerCase());
            const resp  = await fetch(`${BASE}/tim-kiem/${slug}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html  = await resp.text();
            const items = parseAnimeCards(html);
            cb({ success: true, data: items });
        } catch (err) {
            cb({ success: false, error: `AnimeHay search lỗi: ${err.message}` });
        }
    }

    async function load(url, cb) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();

            const ogTitle  = html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1]
                          ?? html.match(/<h1[^>]*class="[^"]*film-name[^"]*"[^>]*>([^<]+)/i)?.[1]?.trim()
                          ?? "Anime";
            const ogPoster = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ?? "";
            const descMatch = html.match(/<div[^>]*class="[^"]*film-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
            const desc = descMatch
                ? descMatch[1].replace(/<[^>]+>/g, "").trim().slice(0, 500)
                : "";

            // Parse episode list: <a href="/tap-phim/slug-tap-N">
            const episodes = [];
            const epRe     = /<a[^>]+href="(\/tap-phim\/[^"]+)"[^>]*>([^<]+)</gi;
            let em;
            let eNum = 1;
            while ((em = epRe.exec(html)) !== null) {
                const tapMatch = em[1].match(/-tap-(\d+)/i);
                const epActual = tapMatch ? parseInt(tapMatch[1], 10) : eNum;
                episodes.push(new Episode({
                    name:    em[2].trim() || `Tập ${epActual}`,
                    url:     `${BASE}${em[1]}`,
                    season:  1,
                    episode: epActual,
                }));
                eNum++;
            }

            // Deduplicate episodes
            const seen = new Set();
            const uniqueEps = episodes.filter(ep => {
                if (seen.has(ep.url)) return false;
                seen.add(ep.url);
                return true;
            });

            const item = new MultimediaItem({
                title:       ogTitle,
                url:         url,
                posterUrl:   ogPoster,
                type:        "anime",
                status:      "ongoing",
                description: desc,
            });
            item.episodes = uniqueEps;

            cb({ success: true, data: item });
        } catch (err) {
            cb({ success: false, error: `AnimeHay load lỗi: ${err.message}` });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();

            const streams = [];
            const pageData = extractPageData(html);

            if (pageData) {
                // Try to extract stream URLs from Nuxt/window data
                const str = JSON.stringify(pageData);
                const m3u8Re = /"(https?:\/\/[^"]+\.m3u8[^"]*)"/g;
                let m;
                while ((m = m3u8Re.exec(str)) !== null) {
                    streams.push(new StreamResult({
                        url:     m[1],
                        quality: "HLS",
                        headers: { "Referer": BASE, "Origin": BASE },
                    }));
                }
            }

            // Generic scan
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
                cb({ success: false, error: "AnimeHay: không tìm thấy stream. Trang có thể đã thay đổi." });
                return;
            }
            cb({ success: true, data: streams });
        } catch (err) {
            cb({ success: false, error: `AnimeHay loadStreams lỗi: ${err.message}` });
        }
    }

    registerSettings([
        {
            id:      "preferDub",
            name:    "Ưu tiên Lồng tiếng",
            type:    "toggle",
            default: false,
        },
    ]);

    globalThis.getHome    = getHome;
    globalThis.search     = search;
    globalThis.load       = load;
    globalThis.loadStreams = loadStreams;

})();
