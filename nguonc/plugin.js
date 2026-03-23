/**
 * NguonC Plugin for SkyStream
 * API: api.nguonc.com/api/films
 *
 * Endpoints:
 *   GET /api/films/phim-moi-cap-nhat?page=N&per_page=24  → latest
 *   GET /api/films/search?keyword=Q&page=N               → search
 *   GET /api/films/:slug                                  → detail
 */

(function () {

    const BASE = manifest.baseUrl; // https://api.nguonc.com
    const API  = `${BASE}/api/films`;

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function mapType(t) {
        if (!t) return "movie";
        const l = t.toLowerCase();
        if (l.includes("hoat") || l.includes("anime")) return "anime";
        if (l.includes("series") || l.includes("bo"))  return "series";
        return "movie";
    }

    function normUrl(u) {
        if (!u) return "";
        return u.startsWith("http") ? u : `${BASE}${u}`;
    }

    function buildItem(m) {
        return new MultimediaItem({
            title:       m.name       || m.original_name || "Không có tên",
            url:         `${BASE}/phim/${m.slug}`,
            posterUrl:   normUrl(m.thumb_url || m.poster_url || m.image),
            type:        mapType(m.type || m.category),
            year:        m.year       ? parseInt(m.year, 10) : undefined,
            status:      (m.current_episode === "Full" || m.episode_current === "Full")
                             ? "completed" : "ongoing",
            description: m.description || m.content || "",
        });
    }

    // ─── Core Functions ───────────────────────────────────────────────────────

    async function getHome(cb) {
        try {
            const cats = {
                "Trending":   [],
                "Phim Mới":   [],
                "Phim Bộ":    [],
                "Phim Lẻ":    [],
                "Anime":      [],
            };

            const resp = await fetch(`${API}/phim-moi-cap-nhat?page=1&per_page=24`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            // NguonC returns { data: { items: [...] } } or { items: [...] }
            const list = json?.data?.items ?? json?.films ?? json?.items ?? [];

            list.forEach(m => {
                const item = buildItem(m);
                cats["Trending"].push(item);
                cats["Phim Mới"].push(item);

                const t = mapType(m.type || m.category);
                if (t === "anime")       cats["Anime"].push(item);
                else if (t === "series") cats["Phim Bộ"].push(item);
                else                     cats["Phim Lẻ"].push(item);
            });

            cb({ success: true, data: cats });
        } catch (err) {
            cb({ success: false, error: `NguonC getHome lỗi: ${err.message}` });
        }
    }

    async function search(query, cb) {
        try {
            if (!query?.trim()) {
                cb({ success: false, error: "Từ khóa không được trống." });
                return;
            }
            const resp  = await fetch(
                `${API}/search?keyword=${encodeURIComponent(query.trim())}&page=1`
            );
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json  = await resp.json();
            const items = (json?.data?.items ?? json?.films ?? json?.items ?? []).map(buildItem);
            cb({ success: true, data: items });
        } catch (err) {
            cb({ success: false, error: `NguonC search lỗi: ${err.message}` });
        }
    }

    async function load(url, cb) {
        try {
            const slugMatch = url.match(/\/phim\/([^#?/]+)/);
            if (!slugMatch) {
                cb({ success: false, error: `NguonC load: URL không hợp lệ.` });
                return;
            }
            const slug = slugMatch[1];
            const resp = await fetch(`${API}/${slug}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            const m    = json?.data?.item ?? json?.film ?? json?.movie ?? json;

            const episodes = [];
            const episodes_raw = m?.episodes ?? m?.episode_server_data ?? [];

            // NguonC structure: episodes = [{ server_name, server_data: [{name, slug, link_m3u8, link_embed}] }]
            episodes_raw.forEach((srv, sIdx) => {
                (srv.server_data ?? srv.items ?? []).forEach((ep, eIdx) => {
                    episodes.push(new Episode({
                        name:    ep.name  || `Tập ${eIdx + 1}`,
                        url:     `${BASE}/phim/${slug}#s=${sIdx}&e=${ep.slug || eIdx}`,
                        season:  sIdx + 1,
                        episode: eIdx + 1,
                    }));
                });
            });

            const item = new MultimediaItem({
                title:       m.name || m.original_name,
                url:         url,
                posterUrl:   normUrl(m.poster_url || m.thumb_url || m.image),
                type:        mapType(m.type || m.category),
                year:        m.year ? parseInt(m.year, 10) : undefined,
                description: m.description || m.content || "",
                status:      (m.current_episode === "Full" || m.episode_current === "Full")
                                 ? "completed" : "ongoing",
                cast:        (m.casts ?? m.actors ?? []).map(a =>
                                 typeof a === "string"
                                     ? new Actor({ name: a, role: "", image: "" })
                                     : new Actor({ name: a.name ?? "", role: a.role ?? "", image: a.image ?? "" })
                             ),
            });
            item.episodes = episodes;

            cb({ success: true, data: item });
        } catch (err) {
            cb({ success: false, error: `NguonC load lỗi: ${err.message}` });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const slugMatch = url.match(/\/phim\/([^#?/]+)/);
            const sMatch    = url.match(/#s=(\d+)/);
            const eMatch    = url.match(/&e=([^&]+)/);

            if (!slugMatch) {
                cb({ success: false, error: "NguonC loadStreams: URL không hợp lệ." });
                return;
            }

            const slug  = slugMatch[1];
            const sIdx  = sMatch  ? parseInt(sMatch[1], 10)          : 0;
            const epKey = eMatch  ? decodeURIComponent(eMatch[1])    : null;

            const resp    = await fetch(`${API}/${slug}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json    = await resp.json();
            const m       = json?.data?.item ?? json?.film ?? json;
            const servers = m?.episodes ?? m?.episode_server_data ?? [];

            const streams = [];
            const srv     = servers[sIdx];

            if (srv) {
                for (const ep of (srv.server_data ?? srv.items ?? [])) {
                    const key = ep.slug ?? String(servers[sIdx].server_data?.indexOf(ep) ?? 0);
                    if (epKey !== null && key !== epKey) continue;

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

            if (!streams.length) {
                cb({ success: false, error: "NguonC: không tìm thấy stream." });
                return;
            }
            cb({ success: true, data: streams });
        } catch (err) {
            cb({ success: false, error: `NguonC loadStreams lỗi: ${err.message}` });
        }
    }

    // ─── Settings ─────────────────────────────────────────────────────────────
    registerSettings([
        {
            id:      "subPref",
            name:    "Phụ đề ưu tiên",
            type:    "select",
            options: ["Vietsub", "Lồng tiếng"],
            default: "Vietsub",
        },
    ]);

    globalThis.getHome    = getHome;
    globalThis.search     = search;
    globalThis.load       = load;
    globalThis.loadStreams = loadStreams;

})();
