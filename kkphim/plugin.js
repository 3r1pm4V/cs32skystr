/**
 * KKPhim Plugin for SkyStream
 * API endpoint: phimapi.com (public mirror of KKPhim)
 *
 * API Docs:
 *   GET /danh-sach/phim-moi-cap-nhat?page=N  → trending/latest
 *   GET /tim-kiem?keyword=Q&page=N           → search
 *   GET /phim/:slug                          → detail + episodes
 */

(function () {

    // ─── Constants ────────────────────────────────────────────────────────────
    const BASE = manifest.baseUrl; // https://phimapi.com
    const SITE = "https://kkphim.vip"; // Used for Referer headers

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Normalize poster URL — KKPhim sometimes returns relative paths.
     * @param {string} url
     * @returns {string}
     */
    function normPoster(url) {
        if (!url) return "";
        if (url.startsWith("http")) return url;
        return `${BASE}${url.startsWith("/") ? "" : "/"}${url}`;
    }

    /**
     * Map KKPhim type → SkyStream type.
     * @param {string} t
     * @returns {"movie"|"series"|"anime"}
     */
    function mapType(t) {
        if (!t) return "movie";
        const l = t.toLowerCase();
        if (l === "hoathinh" || l === "anime") return "anime";
        if (l === "series" || l === "tv")      return "series";
        return "movie";
    }

    /**
     * Build a MultimediaItem from KKPhim API item.
     * @param {object} m
     * @returns {MultimediaItem}
     */
    function buildItem(m) {
        return new MultimediaItem({
            title:       m.name || m.origin_name || "Không có tên",
            url:         `${BASE}/phim/${m.slug}`,
            posterUrl:   normPoster(m.thumb_url || m.poster_url),
            type:        mapType(m.type),
            year:        m.year ? parseInt(m.year, 10) : undefined,
            status:      m.episode_current === "Full" ? "completed" : "ongoing",
            description: m.content || "",
        });
    }

    // ─── Core Functions ───────────────────────────────────────────────────────

    /**
     * getHome — Trả về các danh mục cho dashboard.
     */
    async function getHome(cb) {
        try {
            const cats = {
                "Trending":    [],
                "Mới Cập Nhật":[],
                "Phim Lẻ":     [],
                "Phim Bộ":     [],
                "Hoạt Hình":   [],
            };

            const resp = await fetch(`${BASE}/danh-sach/phim-moi-cap-nhat?page=1`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            const list = json?.data?.items ?? json?.items ?? [];

            list.forEach(m => {
                const item = buildItem(m);
                cats["Trending"].push(item);
                cats["Mới Cập Nhật"].push(item);

                const t = mapType(m.type);
                if (t === "anime")       cats["Hoạt Hình"].push(item);
                else if (t === "series") cats["Phim Bộ"].push(item);
                else                     cats["Phim Lẻ"].push(item);
            });

            cb({ success: true, data: cats });
        } catch (err) {
            cb({ success: false, error: `KKPhim getHome lỗi: ${err.message}` });
        }
    }

    /**
     * search — Tìm kiếm theo từ khóa.
     */
    async function search(query, cb) {
        try {
            if (!query?.trim()) {
                cb({ success: false, error: "Từ khóa không được trống." });
                return;
            }
            const resp = await fetch(
                `${BASE}/tim-kiem?keyword=${encodeURIComponent(query.trim())}&page=1`
            );
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json  = await resp.json();
            const items = (json?.data?.items ?? json?.items ?? []).map(buildItem);
            cb({ success: true, data: items });
        } catch (err) {
            cb({ success: false, error: `KKPhim search lỗi: ${err.message}` });
        }
    }

    /**
     * load — Chi tiết phim + danh sách tập.
     */
    async function load(url, cb) {
        try {
            const slugMatch = url.match(/\/phim\/([^#?/]+)/);
            if (!slugMatch) {
                cb({ success: false, error: `KKPhim load: URL không hợp lệ: ${url}` });
                return;
            }
            const slug = slugMatch[1];
            const resp = await fetch(`${BASE}/phim/${slug}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            const m    = json?.data?.item ?? json?.movie ?? json;

            const episodes = [];
            const servers  = m?.episodes ?? [];

            servers.forEach((srv, sIdx) => {
                (srv.server_data ?? []).forEach((ep, eIdx) => {
                    episodes.push(new Episode({
                        name:    ep.name  || `Tập ${eIdx + 1}`,
                        url:     `${BASE}/phim/${slug}#ep=${ep.slug}`,
                        season:  sIdx + 1,
                        episode: eIdx + 1,
                    }));
                });
            });

            const item = new MultimediaItem({
                title:       m.name || m.origin_name,
                url:         url,
                posterUrl:   normPoster(m.poster_url || m.thumb_url),
                type:        mapType(m.type),
                year:        m.year   ? parseInt(m.year, 10) : undefined,
                description: m.content || "",
                status:      m.episode_current === "Full" ? "completed" : "ongoing",
                cast:        (m.actor ?? []).map(n => new Actor({ name: n, role: "", image: "" })),
                trailers:    m.trailer_url ? [new Trailer({ url: m.trailer_url })] : [],
            });
            item.episodes = episodes;

            cb({ success: true, data: item });
        } catch (err) {
            cb({ success: false, error: `KKPhim load lỗi: ${err.message}` });
        }
    }

    /**
     * loadStreams — Lấy stream link cho tập phim.
     */
    async function loadStreams(url, cb) {
        try {
            const slugMatch = url.match(/\/phim\/([^#?/]+)/);
            const epMatch   = url.match(/#ep=([^&]+)/);
            if (!slugMatch) {
                cb({ success: false, error: "KKPhim loadStreams: URL không hợp lệ." });
                return;
            }

            const slug     = slugMatch[1];
            const epSlug   = epMatch ? decodeURIComponent(epMatch[1]) : null;
            const resp     = await fetch(`${BASE}/phim/${slug}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json     = await resp.json();
            const servers  = json?.data?.item?.episodes ?? json?.movie?.episodes ?? [];

            const streams = [];
            for (const srv of servers) {
                for (const ep of (srv.server_data ?? [])) {
                    if (epSlug && ep.slug !== epSlug) continue;

                    if (ep.link_m3u8) {
                        streams.push(new StreamResult({
                            url:     ep.link_m3u8,
                            quality: "HLS",
                            headers: { "Referer": SITE },
                        }));
                    }
                    if (ep.link_embed) {
                        streams.push(new StreamResult({
                            url:     ep.link_embed,
                            quality: "Embed",
                            headers: { "Referer": SITE },
                        }));
                    }
                }
            }

            if (!streams.length) {
                cb({ success: false, error: "KKPhim: không tìm thấy stream." });
                return;
            }
            cb({ success: true, data: streams });
        } catch (err) {
            cb({ success: false, error: `KKPhim loadStreams lỗi: ${err.message}` });
        }
    }

    // ─── Settings ─────────────────────────────────────────────────────────────
    registerSettings([
        {
            id:      "preferSub",
            name:    "Ưu tiên Vietsub",
            type:    "toggle",
            default: true,
        },
        {
            id:      "quality",
            name:    "Chất lượng phát",
            type:    "select",
            options: ["HLS", "Embed"],
            default: "HLS",
        },
    ]);

    // ─── Export ───────────────────────────────────────────────────────────────
    globalThis.getHome    = getHome;
    globalThis.search     = search;
    globalThis.load       = load;
    globalThis.loadStreams = loadStreams;

})();
