/**
 * PhimChill Plugin for SkyStream
 * Source: phimchill.net  (HTML scraper)
 *
 * PhimChill uses a Next.js front-end; data is often in __NEXT_DATA__ JSON.
 */

(function () {

    const BASE = manifest.baseUrl; // https://phimchill.net

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Extract __NEXT_DATA__ JSON from a Next.js page.
     * @param {string} html
     * @returns {object|null}
     */
    function extractNextData(html) {
        const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
        if (!m) return null;
        try { return JSON.parse(m[1]); } catch { return null; }
    }

    /**
     * Map PhimChill type → SkyStream type.
     * @param {string} t
     */
    function mapType(t) {
        if (!t) return "movie";
        const l = t.toLowerCase();
        if (l.includes("anime") || l.includes("hoat")) return "anime";
        if (l.includes("series") || l.includes("bo"))  return "series";
        return "movie";
    }

    /**
     * Build item from PhimChill API/scraped object.
     */
    function buildItem(m) {
        return new MultimediaItem({
            title:     m.name || m.title || "Không có tên",
            url:       m.slug ? `${BASE}/phim/${m.slug}` : (m.url || BASE),
            posterUrl: m.thumb_url || m.poster || m.image || "",
            type:      mapType(m.type || m.category_type),
            year:      m.year ? parseInt(m.year, 10) : undefined,
            status:    (m.episode_current === "Full" || m.status === "completed") ? "completed" : "ongoing",
        });
    }

    /**
     * Regex-based card parser for fallback.
     */
    function parseCards(html) {
        const items = [];
        const re    = /<a[^>]+href="(\/phim\/[^"]+)"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            items.push(new MultimediaItem({
                title:     m[2] || "Không có tên",
                url:       `${BASE}${m[1]}`,
                posterUrl: m[3].startsWith("http") ? m[3] : `${BASE}${m[3]}`,
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

            const nextData = extractNextData(html);
            let list = [];

            if (nextData) {
                // Try common Next.js page props paths
                const props = nextData?.props?.pageProps;
                list = props?.movies ?? props?.films ?? props?.items ?? props?.data?.items ?? [];
            }

            const items = list.length > 0 ? list.map(buildItem) : parseCards(html);
            const cats  = { "Trending": items, "Phim Chill": items };

            cb({ success: true, data: cats });
        } catch (err) {
            cb({ success: false, error: `PhimChill getHome lỗi: ${err.message}` });
        }
    }

    async function search(query, cb) {
        try {
            if (!query?.trim()) {
                cb({ success: false, error: "Từ khóa không được trống." });
                return;
            }
            const resp  = await fetch(`${BASE}/tim-kiem?q=${encodeURIComponent(query.trim())}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html  = await resp.text();

            const nextData = extractNextData(html);
            let items = [];
            if (nextData) {
                const props = nextData?.props?.pageProps;
                const list  = props?.movies ?? props?.films ?? props?.items ?? props?.data?.items ?? [];
                items       = list.map(buildItem);
            }
            if (!items.length) items = parseCards(html);

            cb({ success: true, data: items });
        } catch (err) {
            cb({ success: false, error: `PhimChill search lỗi: ${err.message}` });
        }
    }

    async function load(url, cb) {
        try {
            const resp     = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html     = await resp.text();
            const nextData = extractNextData(html);

            let m = null;
            if (nextData) {
                const props = nextData?.props?.pageProps;
                m = props?.movie ?? props?.film ?? props?.item ?? props?.data;
            }

            // Build episodes
            const episodes = [];
            if (m?.episodes) {
                m.episodes.forEach((srv, sIdx) => {
                    (srv.server_data ?? srv.episodes ?? []).forEach((ep, eIdx) => {
                        episodes.push(new Episode({
                            name:    ep.name  || `Tập ${eIdx + 1}`,
                            url:     ep.link_m3u8 || ep.link_embed || url,
                            season:  sIdx + 1,
                            episode: eIdx + 1,
                        }));
                    });
                });
            }

            // Fallback: parse from HTML
            if (!episodes.length) {
                const epRe = /<a[^>]+href="(\/xem-phim\/[^"]+)"[^>]*>([^<]+)</gi;
                let em;
                let eNum = 1;
                while ((em = epRe.exec(html)) !== null) {
                    episodes.push(new Episode({
                        name:    em[2].trim() || `Tập ${eNum}`,
                        url:     `${BASE}${em[1]}`,
                        season:  1,
                        episode: eNum++,
                    }));
                }
            }

            const ogTitle  = html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ?? "Phim";
            const ogPoster = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ?? "";

            const item = new MultimediaItem({
                title:     m?.name ?? ogTitle,
                url:       url,
                posterUrl: m?.poster_url ?? m?.thumb_url ?? ogPoster,
                type:      mapType(m?.type),
                status:    m?.episode_current === "Full" ? "completed" : "ongoing",
                description: m?.content ?? m?.description ?? "",
            });
            item.episodes = episodes;

            cb({ success: true, data: item });
        } catch (err) {
            cb({ success: false, error: `PhimChill load lỗi: ${err.message}` });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();

            const streams  = [];
            const nextData = extractNextData(html);

            if (nextData) {
                const pageProps = nextData?.props?.pageProps;
                const streamData = pageProps?.streams ?? pageProps?.episode?.streams ?? [];
                streamData.forEach(s => {
                    if (s?.url) {
                        streams.push(new StreamResult({
                            url:     s.url,
                            quality: s.quality ?? "HLS",
                            headers: { "Referer": BASE },
                        }));
                    }
                });
            }

            // Generic HLS/MP4 scan
            const m3u8Re = /["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/g;
            let m;
            while ((m = m3u8Re.exec(html)) !== null) {
                if (!streams.find(s => s.url === m[1])) {
                    streams.push(new StreamResult({
                        url:     m[1],
                        quality: "HLS",
                        headers: { "Referer": BASE, "Origin": BASE },
                    }));
                }
            }

            const embedRe = /<iframe[^>]+src="(https?:\/\/[^"]+)"[^>]*>/gi;
            while ((m = embedRe.exec(html)) !== null) {
                streams.push(new StreamResult({
                    url:     m[1],
                    quality: "Embed",
                    headers: { "Referer": BASE },
                }));
            }

            if (!streams.length) {
                cb({ success: false, error: "PhimChill: không tìm thấy stream." });
                return;
            }
            cb({ success: true, data: streams });
        } catch (err) {
            cb({ success: false, error: `PhimChill loadStreams lỗi: ${err.message}` });
        }
    }

    registerSettings([
        {
            id:      "quality",
            name:    "Chất lượng phát",
            type:    "select",
            options: ["HLS", "Embed"],
            default: "HLS",
        },
    ]);

    globalThis.getHome    = getHome;
    globalThis.search     = search;
    globalThis.load       = load;
    globalThis.loadStreams = loadStreams;

})();
