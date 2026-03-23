/**
 * BiluTV Plugin for SkyStream
 * Source: bilutv.org  (HTML scraper)
 *
 * Speciality: Phim bộ Hoa ngữ, Hàn Quốc, Nhật Bản Vietsub
 *
 * URL patterns:
 *   Homepage   → /
 *   Search     → /tim-kiem/<slug-query>.html
 *   Detail     → /phim/<slug>.html
 *   Episode    → /phim/<slug>-tap-<N>.html
 */

(function () {

    const BASE = manifest.baseUrl; // https://bilutv.org

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Normalise a URL that may be relative.
     * @param {string} u
     * @returns {string}
     */
    function norm(u) {
        if (!u) return "";
        if (u.startsWith("http")) return u;
        return `${BASE}${u.startsWith("/") ? "" : "/"}${u}`;
    }

    /**
     * Parse BiluTV movie/series cards.
     * Card HTML:  <div class="item"> <a href="/phim/..." title="..."> <img src/data-src="...">
     * @param {string} html
     * @returns {MultimediaItem[]}
     */
    function parseCards(html) {
        const items = [];
        const re    = /<a[^>]+href="(\/phim\/[^"]+\.html)"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            items.push(new MultimediaItem({
                title:     m[2].trim(),
                url:       norm(m[1]),
                posterUrl: norm(m[3]),
                type:      "series",
            }));
        }
        return items;
    }

    /**
     * Detect country tag from detail page to assist type labelling.
     * @param {string} html
     * @returns {string}  "hoa" | "han" | "nhat" | "viet" | "other"
     */
    function detectCountry(html) {
        const countryBlock = html.match(/Quốc gia[\s\S]*?<\/a>/i)?.[0]?.toLowerCase() ?? "";
        if (countryBlock.includes("trung") || countryBlock.includes("hoa"))       return "hoa";
        if (countryBlock.includes("hàn")   || countryBlock.includes("korea"))     return "han";
        if (countryBlock.includes("nhật")  || countryBlock.includes("japan"))     return "nhat";
        if (countryBlock.includes("việt")  || countryBlock.includes("viet"))      return "viet";
        return "other";
    }

    // ─── Core Functions ───────────────────────────────────────────────────────

    async function getHome(cb) {
        try {
            const homeResp = await fetch(BASE);
            if (!homeResp.ok) throw new Error(`HTTP ${homeResp.status}`);
            const homeHtml = await homeResp.text();

            const [koreaHtml, chinaHtml] = await Promise.all([
                fetch(`${BASE}/phim-han-quoc.html`).then(r => r.ok ? r.text() : ""),
                fetch(`${BASE}/phim-trung-quoc.html`).then(r => r.ok ? r.text() : ""),
            ]);

            const trending  = parseCards(homeHtml);
            const korean    = parseCards(koreaHtml);
            const chinese   = parseCards(chinaHtml);

            const cats = {
                "Trending":    trending,
                "Phim Hàn":   korean.length  ? korean  : trending.filter((_, i) => i % 3 === 0),
                "Phim Hoa":   chinese.length ? chinese : trending.filter((_, i) => i % 3 === 1),
                "Phim Bộ":    trending,
            };

            cb({ success: true, data: cats });
        } catch (err) {
            cb({ success: false, error: `BiluTV getHome lỗi: ${err.message}` });
        }
    }

    async function search(query, cb) {
        try {
            if (!query?.trim()) {
                cb({ success: false, error: "Từ khóa không được trống." });
                return;
            }
            // BiluTV search: /tim-kiem/<slug>.html
            const slug  = encodeURIComponent(
                query.trim().toLowerCase().replace(/\s+/g, "-")
            );
            const resp  = await fetch(`${BASE}/tim-kiem/${slug}.html`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html  = await resp.text();
            const items = parseCards(html);
            cb({ success: true, data: items });
        } catch (err) {
            cb({ success: false, error: `BiluTV search lỗi: ${err.message}` });
        }
    }

    async function load(url, cb) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();

            // ── Metadata ──────────────────────────────────────────────────────
            const title  = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/i)?.[1]?.trim()
                        ?? html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1]
                        ?? url.split("/").pop().replace(".html", "");

            const poster = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1]
                        ?? html.match(/<img[^>]+id="mainposter"[^>]+src="([^"]+)"/i)?.[1]
                        ?? "";

            const desc   = html.match(/<div[^>]+class="[^"]*film-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
                               ?.[1]?.replace(/<[^>]+>/g, "").trim().slice(0, 600) ?? "";

            const country = detectCountry(html);

            // ── Episodes ──────────────────────────────────────────────────────
            // BiluTV episode links: /phim/<base-slug>-tap-<N>.html
            const baseSlug = url.match(/\/phim\/([^.]+)(?:-tap-\d+)?\.html/)?.[1] ?? "";
            const episodes = [];

            // Parse episode list from server list section
            const epRe = /<a[^>]+href="(\/phim\/[^"]+\.html)"[^>]*>\s*(?:Tập\s*)?(\d+)\s*<\/a>/gi;
            let em;
            while ((em = epRe.exec(html)) !== null) {
                const epNum = parseInt(em[2], 10);
                if (!isNaN(epNum)) {
                    episodes.push(new Episode({
                        name:    `Tập ${epNum}`,
                        url:     norm(em[1]),
                        season:  1,
                        episode: epNum,
                    }));
                }
            }

            // Deduplicate & sort
            const seen   = new Set();
            const unique = episodes
                .filter(ep => { if (seen.has(ep.url)) return false; seen.add(ep.url); return true; })
                .sort((a, b) => a.episode - b.episode);

            // If no episodes found, treat as movie
            if (!unique.length && baseSlug) {
                unique.push(new Episode({
                    name:    "Full",
                    url:     url,
                    season:  1,
                    episode: 1,
                }));
            }

            const item = new MultimediaItem({
                title:       title,
                url:         url,
                posterUrl:   norm(poster),
                type:        unique.length > 1 ? "series" : "movie",
                status:      "ongoing",
                description: desc,
            });
            item.episodes = unique;

            cb({ success: true, data: item });
        } catch (err) {
            cb({ success: false, error: `BiluTV load lỗi: ${err.message}` });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();

            const streams = [];

            // BiluTV typically embeds player via jwplayer or custom video.js
            // Sources are usually in a JS variable: sources:[{file:"..."}]
            const fileRe = /(?:file|src)\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/gi;
            let fm;
            while ((fm = fileRe.exec(html)) !== null) {
                streams.push(new StreamResult({
                    url:     fm[1],
                    quality: "HLS",
                    headers: { "Referer": BASE, "Origin": BASE },
                }));
            }

            // Generic m3u8
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

            // MP4 fallback
            const mp4Re = /["'](https?:\/\/[^"']+\.mp4[^"']*)['"]/g;
            while ((gm = mp4Re.exec(html)) !== null) {
                streams.push(new StreamResult({
                    url:     gm[1],
                    quality: "MP4",
                    headers: { "Referer": BASE },
                }));
            }

            // Iframe embed fallback
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
                cb({ success: false, error: "BiluTV: không tìm thấy stream. Trang có thể đã thay đổi." });
                return;
            }
            cb({ success: true, data: streams });
        } catch (err) {
            cb({ success: false, error: `BiluTV loadStreams lỗi: ${err.message}` });
        }
    }

    // ─── Settings ─────────────────────────────────────────────────────────────
    registerSettings([
        {
            id:      "countryFilter",
            name:    "Quốc gia ưu tiên",
            type:    "select",
            options: ["Tất cả", "Hàn Quốc", "Hoa Ngữ", "Nhật Bản", "Việt Nam"],
            default: "Tất cả",
        },
        {
            id:      "autoNextEp",
            name:    "Tự động tập tiếp theo",
            type:    "toggle",
            default: true,
        },
    ]);

    globalThis.getHome    = getHome;
    globalThis.search     = search;
    globalThis.load       = load;
    globalThis.loadStreams = loadStreams;

})();
