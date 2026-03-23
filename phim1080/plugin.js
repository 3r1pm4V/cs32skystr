/**
 * Phim1080 Plugin for SkyStream
 * Source: phim1080.in  (HTML scraper — no public API)
 *
 * Speciality: Full HD 1080p, Bluray rips, premium quality streams
 *
 * URL patterns:
 *   Homepage  → /
 *   Search    → /?s=<query>
 *   Detail    → /phim/<slug>/
 *   Episode   → /tap-phim/<slug>-tap-<N>/
 *              or  /xem-phim/<slug>/tap-<N>
 */

(function () {

    const BASE = manifest.baseUrl; // https://phim1080.in

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /** Ensure absolute URL. */
    function norm(u) {
        if (!u) return "";
        return u.startsWith("http") ? u : `${BASE}${u.startsWith("/") ? "" : "/"}${u}`;
    }

    /** Strip HTML tags. */
    function stripTags(s) {
        return (s || "").replace(/<[^>]+>/g, "").trim();
    }

    /**
     * Parse Phim1080-style movie cards.
     * Pattern: <div class="item"> <a href="/phim/..." title="..."><img data-src="...">
     */
    function parseCards(html) {
        const items = [];
        const re    = /<a[^>]+href="(\/(?:phim|phim-bo|phim-le)\/[^"]+\/?)"\s+title="([^"]+)"[^>]*>[\s\S]*?<img[^>]+(?:data-src|data-lazy|src)="([^"]+)"/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const u = norm(m[1]);
            const p = norm(m[3]);
            // Avoid duplicates (same URL)
            if (!items.find(i => i.url === u)) {
                items.push(new MultimediaItem({
                    title:     m[2].trim(),
                    url:       u,
                    posterUrl: p,
                    type:      m[1].includes("phim-bo") ? "series" : "movie",
                }));
            }
        }
        return items;
    }

    /**
     * Extract quality badge from title (e.g. "[1080p]", "[Bluray]").
     * @param {string} title
     * @returns {{clean: string, quality: string}}
     */
    function parseQualityTag(title) {
        const m = title.match(/\[([^\]]+)\]/);
        return {
            clean:   title.replace(/\[[^\]]+\]/g, "").trim(),
            quality: m ? m[1] : "1080p",
        };
    }

    // ─── Core Functions ───────────────────────────────────────────────────────

    async function getHome(cb) {
        try {
            const homeResp = await fetch(BASE);
            if (!homeResp.ok) throw new Error(`HTTP ${homeResp.status}`);
            const homeHtml = await homeResp.text();

            const seriesHtml = await fetch(`${BASE}/phim-bo/`).then(r => r.ok ? r.text() : "");

            const trending = parseCards(homeHtml);
            const series   = parseCards(seriesHtml);

            // Split into movie vs series based on type field
            const movies = trending.filter(i => i.type === "movie");
            const bos    = [...trending.filter(i => i.type === "series"), ...series];

            // Deduplicate bos
            const seenBo = new Set();
            const uniqueBo = bos.filter(i => { if (seenBo.has(i.url)) return false; seenBo.add(i.url); return true; });

            cb({
                success: true,
                data: {
                    "Trending":    trending,
                    "Phim Lẻ HD":  movies.length   ? movies    : trending.slice(0, 10),
                    "Phim Bộ HD":  uniqueBo.length ? uniqueBo  : trending.slice(10),
                },
            });
        } catch (err) {
            cb({ success: false, error: `Phim1080 getHome lỗi: ${err.message}` });
        }
    }

    async function search(query, cb) {
        try {
            if (!query?.trim()) {
                cb({ success: false, error: "Từ khóa không được trống." });
                return;
            }
            const resp  = await fetch(`${BASE}/?s=${encodeURIComponent(query.trim())}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html  = await resp.text();
            const items = parseCards(html);
            cb({ success: true, data: items });
        } catch (err) {
            cb({ success: false, error: `Phim1080 search lỗi: ${err.message}` });
        }
    }

    async function load(url, cb) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();

            // ── Metadata ──────────────────────────────────────────────────────
            const rawTitle  = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/i)?.[1]?.trim()
                           ?? html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1]
                           ?? url.split("/").filter(Boolean).pop();

            const { clean: title, quality } = parseQualityTag(rawTitle);

            const poster = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1]
                        ?? html.match(/<img[^>]+class="[^"]*poster[^"]*"[^>]+src="([^"]+)"/i)?.[1]
                        ?? "";

            const descBlock = html.match(/<div[^>]+class="[^"]*(?:film-content|entry-content|synopsis)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
            const desc      = descBlock ? stripTags(descBlock[1]).slice(0, 600) : "";

            const yearMatch = html.match(/Năm phát hành[\s\S]*?(\d{4})/i)
                           ?? html.match(/(?:release[-_]?year|year)[^\d]*(\d{4})/i);
            const year  = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

            const scoreMatch = html.match(/(?:imdb|score|điểm)[^\d]*(\d(?:\.\d)?)/i);
            const score = scoreMatch ? parseFloat(scoreMatch[1]) : undefined;

            // ── Episodes ──────────────────────────────────────────────────────
            const episodes = [];

            // Pattern 1: tap-phim links
            const tapRe  = /<a[^>]+href="(\/(?:tap-phim|xem-phim)\/[^"]+\/[^"]*tap[-_](\d+)[^"]*)"[^>]*>([^<]*)</gi;
            let em;
            while ((em = tapRe.exec(html)) !== null) {
                const epNum = parseInt(em[2], 10);
                if (!isNaN(epNum)) {
                    episodes.push(new Episode({
                        name:    em[3].trim() || `Tập ${epNum}`,
                        url:     norm(em[1]),
                        season:  1,
                        episode: epNum,
                    }));
                }
            }

            // Pattern 2: numbered episode buttons (when no tap-phim prefix)
            if (!episodes.length) {
                const btnRe = /<a[^>]+href="([^"]+)"[^>]*>\s*(\d+)\s*<\/a>/gi;
                let bn;
                let epIdx = 1;
                while ((bn = btnRe.exec(html)) !== null) {
                    const epNum = parseInt(bn[2], 10);
                    if (epNum > 0 && epNum < 3000) {
                        episodes.push(new Episode({
                            name:    `Tập ${epNum}`,
                            url:     norm(bn[1]),
                            season:  1,
                            episode: epNum,
                        }));
                        epIdx++;
                    }
                }
            }

            // Single movie fallback
            if (!episodes.length) {
                episodes.push(new Episode({
                    name:    "Full",
                    url:     url,
                    season:  1,
                    episode: 1,
                }));
            }

            // Deduplicate & sort
            const seen   = new Set();
            const unique = episodes
                .filter(ep => { if (seen.has(ep.url)) return false; seen.add(ep.url); return true; })
                .sort((a, b) => a.episode - b.episode);

            const item = new MultimediaItem({
                title:       title,
                url:         url,
                posterUrl:   norm(poster),
                type:        unique.length > 1 ? "series" : "movie",
                year,
                score,
                status:      "completed",
                description: desc,
                playbackPolicy: quality !== "1080p" ? quality : undefined,
            });
            item.episodes = unique;

            cb({ success: true, data: item });
        } catch (err) {
            cb({ success: false, error: `Phim1080 load lỗi: ${err.message}` });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();

            const streams = [];

            // Phim1080 uses jwplayer with sources array
            // Pattern: sources:[{file:"https://..."}]
            const jwRe = /sources\s*:\s*\[([\s\S]*?)\]/gi;
            let jwm;
            while ((jwm = jwRe.exec(html)) !== null) {
                const block  = jwm[1];
                const fileRe = /["']?file["']?\s*:\s*["']([^"']+)['"]/gi;
                let fm;
                while ((fm = fileRe.exec(block)) !== null) {
                    const streamUrl = fm[1];
                    const ext       = streamUrl.split("?")[0].split(".").pop().toLowerCase();
                    streams.push(new StreamResult({
                        url:     streamUrl,
                        quality: ext === "m3u8" ? "HLS 1080p" : `MP4 ${ext.toUpperCase()}`,
                        headers: { "Referer": BASE, "Origin": BASE },
                    }));
                }
            }

            // Generic HLS scan
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

            // MP4 scan
            const mp4Re = /["'](https?:\/\/[^"']+\.mp4[^"']*)['"]/g;
            while ((gm = mp4Re.exec(html)) !== null) {
                if (!streams.find(s => s.url === gm[1])) {
                    streams.push(new StreamResult({
                        url:     gm[1],
                        quality: "MP4",
                        headers: { "Referer": BASE, "Origin": BASE },
                    }));
                }
            }

            // Embed iframe fallback
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
                cb({ success: false, error: "Phim1080: không tìm thấy stream. Trang có thể đã thay đổi." });
                return;
            }
            cb({ success: true, data: streams });
        } catch (err) {
            cb({ success: false, error: `Phim1080 loadStreams lỗi: ${err.message}` });
        }
    }

    // ─── Settings ─────────────────────────────────────────────────────────────
    registerSettings([
        {
            id:      "quality",
            name:    "Chất lượng ưu tiên",
            type:    "select",
            options: ["HLS 1080p", "MP4", "Embed"],
            default: "HLS 1080p",
        },
        {
            id:      "subLang",
            name:    "Ngôn ngữ phụ đề",
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
