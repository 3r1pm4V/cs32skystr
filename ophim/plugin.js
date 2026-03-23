/**
 * OPhim Plugin for SkyStream
 * Source: ophim1.com (public API)
 * Types: movie, series — Vietsub & Lồng tiếng
 *
 * API Docs:
 *   GET /api/v1/movie?page=N          → paginated movie list
 *   GET /api/v1/movie/:slug           → movie detail + episodes
 *   GET /api/v1/movie?page=1&keyword= → search
 */

(function () {

    // ─── Constants ────────────────────────────────────────────────────────────
    const BASE = manifest.baseUrl; // e.g. https://ophim1.com
    const API  = `${BASE}/api/v1`;

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Map OPhim type string → SkyStream type string.
     * @param {string} t
     * @returns {"movie"|"series"|"anime"}
     */
    function mapType(t) {
        if (!t) return "movie";
        const lower = t.toLowerCase();
        if (lower.includes("hoat") || lower.includes("anime")) return "anime";
        if (lower.includes("series") || lower.includes("bo"))   return "series";
        return "movie";
    }

    /**
     * Build a MultimediaItem from an OPhim movie object.
     * @param {object} m
     * @returns {MultimediaItem}
     */
    function buildItem(m) {
        return new MultimediaItem({
            title:         m.name || m.origin_name || "Không có tên",
            url:           `${BASE}/phim/${m.slug}`,
            posterUrl:     m.thumb_url
                               ? (m.thumb_url.startsWith("http") ? m.thumb_url : `${BASE}${m.thumb_url}`)
                               : "",
            type:          mapType(m.type),
            year:          m.year   ? parseInt(m.year, 10)  : undefined,
            score:         m.imdb_id ? undefined             : undefined, // score not in list API
            status:        m.episode_current === "Full" ? "completed" : "ongoing",
            description:   m.content || "",
            contentRating: m.is_18plus ? "18+" : undefined,
        });
    }

    /**
     * Build a SkyStream Episode from an OPhim episode server item.
     * @param {object} ep   - {name, slug, filename}
     * @param {number} seasonNum
     * @param {number} epNum
     * @param {string} movieSlug
     * @returns {Episode}
     */
    function buildEpisode(ep, seasonNum, epNum, movieSlug) {
        return new Episode({
            name:    ep.name || `Tập ${epNum}`,
            url:     `${BASE}/phim/${movieSlug}#server=${ep.slug}`,
            season:  seasonNum,
            episode: epNum,
        });
    }

    // ─── Core Functions ───────────────────────────────────────────────────────

    /**
     * getHome — Provides dashboard categories.
     * Categories: Trending (mới nhất), Phim Lẻ, Phim Bộ, Anime, Phim Hàn, Phim Hoa
     */
    async function getHome(cb) {
        try {
            const categories = {
                "Trending":  [],
                "Phim Lẻ":   [],
                "Phim Bộ":   [],
                "Anime":     [],
                "Phim Hàn":  [],
                "Phim Hoa":  [],
            };

            // Fetch first page for Trending
            const resp = await fetch(`${API}/movie?page=1`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const movies = data?.data?.items ?? [];

            movies.forEach(m => {
                const item = buildItem(m);
                categories["Trending"].push(item);

                const type = mapType(m.type);
                const country = (m.country ?? []).map(c => c.name.toLowerCase());

                if (type === "anime")       categories["Anime"].push(item);
                else if (type === "series") categories["Phim Bộ"].push(item);
                else                        categories["Phim Lẻ"].push(item);

                if (country.some(c => c.includes("hàn") || c.includes("han") || c.includes("korea")))
                    categories["Phim Hàn"].push(item);
                if (country.some(c => c.includes("trung") || c.includes("hoa") || c.includes("china")))
                    categories["Phim Hoa"].push(item);
            });

            cb({ success: true, data: categories });
        } catch (err) {
            cb({ success: false, error: `OPhim getHome lỗi: ${err.message}` });
        }
    }

    /**
     * search — Tìm kiếm phim theo từ khóa.
     * @param {string} query
     */
    async function search(query, cb) {
        try {
            if (!query || !query.trim()) {
                cb({ success: false, error: "Từ khóa tìm kiếm không được để trống." });
                return;
            }

            const encoded = encodeURIComponent(query.trim());
            const resp    = await fetch(`${API}/movie?keyword=${encoded}&page=1`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data    = await resp.json();
            const items   = (data?.data?.items ?? []).map(buildItem);

            cb({ success: true, data: items });
        } catch (err) {
            cb({ success: false, error: `OPhim search lỗi: ${err.message}` });
        }
    }

    /**
     * load — Lấy thông tin chi tiết và danh sách tập của một phim.
     * @param {string} url  - e.g. https://ophim1.com/phim/ten-phim
     */
    async function load(url, cb) {
        try {
            // Extract slug from URL: /phim/<slug>[#...]
            const slugMatch = url.match(/\/phim\/([^#?/]+)/);
            if (!slugMatch) {
                cb({ success: false, error: `OPhim load: không parse được slug từ URL: ${url}` });
                return;
            }
            const slug = slugMatch[1];

            const resp = await fetch(`${API}/movie/${slug}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const m    = data?.data?.item;
            if (!m) throw new Error("Không có dữ liệu phim.");

            // Build episodes from all servers
            const episodes = [];
            const servers  = m.episodes ?? [];

            servers.forEach((server, sIdx) => {
                (server.server_data ?? []).forEach((ep, eIdx) => {
                    episodes.push(buildEpisode(ep, sIdx + 1, eIdx + 1, slug));
                });
            });

            const item = new MultimediaItem({
                title:       m.name || m.origin_name,
                url:         url,
                posterUrl:   m.poster_url
                                 ? (m.poster_url.startsWith("http") ? m.poster_url : `${BASE}${m.poster_url}`)
                                 : "",
                type:        mapType(m.type),
                year:        m.year    ? parseInt(m.year, 10) : undefined,
                description: m.content || "",
                status:      m.episode_current === "Full" ? "completed" : "ongoing",
                contentRating: m.is_18plus ? "18+" : undefined,
                cast: (m.actor ?? []).map(name => new Actor({ name, role: "", image: "" })),
                trailers: m.trailer_url
                    ? [new Trailer({ url: m.trailer_url })]
                    : [],
            });
            item.episodes = episodes;

            cb({ success: true, data: item });
        } catch (err) {
            cb({ success: false, error: `OPhim load lỗi: ${err.message}` });
        }
    }

    /**
     * loadStreams — Lấy link stream cho một tập phim.
     * @param {string} url  - e.g. https://ophim1.com/phim/slug#server=ep-slug
     */
    async function loadStreams(url, cb) {
        try {
            const slugMatch  = url.match(/\/phim\/([^#?/]+)/);
            const serverMatch = url.match(/#server=([^&]+)/);
            if (!slugMatch) {
                cb({ success: false, error: "OPhim loadStreams: URL không hợp lệ." });
                return;
            }

            const slug       = slugMatch[1];
            const targetSlug = serverMatch ? decodeURIComponent(serverMatch[1]) : null;

            const resp = await fetch(`${API}/movie/${slug}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const servers = data?.data?.item?.episodes ?? [];

            const streams = [];

            for (const server of servers) {
                for (const ep of (server.server_data ?? [])) {
                    // Filter to the requested episode if slug provided
                    if (targetSlug && ep.slug !== targetSlug) continue;

                    if (ep.link_m3u8) {
                        streams.push(new StreamResult({
                            url:     ep.link_m3u8,
                            quality: "HLS",
                            headers: { "Referer": BASE },
                        }));
                    }
                    if (ep.link_embed) {
                        streams.push(new StreamResult({
                            url:     ep.link_embed,
                            quality: "Embed",
                            headers: { "Referer": BASE },
                        }));
                    }
                }
            }

            if (streams.length === 0) {
                cb({ success: false, error: "OPhim: không tìm thấy stream cho tập này." });
                return;
            }

            cb({ success: true, data: streams });
        } catch (err) {
            cb({ success: false, error: `OPhim loadStreams lỗi: ${err.message}` });
        }
    }

    // ─── Register Settings ────────────────────────────────────────────────────
    registerSettings([
        {
            id:      "quality",
            name:    "Chất lượng mặc định",
            type:    "select",
            options: ["HLS", "Embed"],
            default: "HLS",
        },
        {
            id:      "subType",
            name:    "Loại phụ đề ưu tiên",
            type:    "select",
            options: ["Vietsub", "Lồng tiếng", "Thuyết minh"],
            default: "Vietsub",
        },
    ]);

    // ─── Export ───────────────────────────────────────────────────────────────
    globalThis.getHome      = getHome;
    globalThis.search       = search;
    globalThis.load         = load;
    globalThis.loadStreams   = loadStreams;

})();
