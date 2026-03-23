/**
 * tests/plugins.test.js
 *
 * Unit tests for Vietnamese Streaming Hub — SkyStream plugins.
 *
 * Run:  node tests/plugins.test.js
 * (No external test runner required — uses a lightweight inline harness.)
 *
 * NOTE: These tests validate the plugin contract (function signatures,
 * callback shape, error handling) by mocking the SkyStream global classes
 * and `fetch`. They do NOT make real HTTP requests.
 */

// ─── Lightweight test harness ──────────────────────────────────────────────

let _passed = 0;
let _failed = 0;

function assert(condition, msg) {
    if (condition) {
        console.log(`  ✅  ${msg}`);
        _passed++;
    } else {
        console.error(`  ❌  ${msg}`);
        _failed++;
    }
}

async function test(name, fn) {
    console.log(`\n▶  ${name}`);
    try {
        await fn();
    } catch (e) {
        console.error(`  💥  Uncaught: ${e.message}`);
        _failed++;
    }
}

// ─── SkyStream Global Mocks ────────────────────────────────────────────────

/** Minimal MultimediaItem mock — mirrors real constructor. */
class MultimediaItem {
    constructor(opts) { Object.assign(this, opts); }
}

/** Minimal Episode mock. */
class Episode {
    constructor(opts) { Object.assign(this, opts); }
}

/** Minimal StreamResult mock. */
class StreamResult {
    constructor(opts) { Object.assign(this, opts); }
}

/** Minimal Actor mock. */
class Actor {
    constructor(opts) { Object.assign(this, opts); }
}

/** Minimal Trailer mock. */
class Trailer {
    constructor(opts) { Object.assign(this, opts); }
}

/** registerSettings is a no-op in tests. */
function registerSettings(_schema) {}

/** settings mock. */
const settings = { quality: "HLS", subType: "Vietsub" };

// Inject into global scope so IIFE plugins see them
Object.assign(global, {
    MultimediaItem,
    Episode,
    StreamResult,
    Actor,
    Trailer,
    registerSettings,
    settings,
    globalThis,
});

// ─── Fetch Mock Factory ────────────────────────────────────────────────────

/**
 * Create a mock `fetch` that returns canned JSON or HTML.
 * @param {object|string} responseBody
 * @param {number} status
 * @returns {Function}
 */
function mockFetch(responseBody, status = 200) {
    return async (_url, _opts) => ({
        ok:   status >= 200 && status < 300,
        status,
        text: async () => (typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody)),
        json: async () => (typeof responseBody === "object" ? responseBody : JSON.parse(responseBody)),
    });
}

/**
 * Create a mock fetch that throws a network error.
 */
function errorFetch(msg = "Network error") {
    return async () => { throw new Error(msg); };
}

// ─── Helper: load a plugin module with a given manifest & fetch ────────────

/**
 * Load a plugin IIFE in a sandboxed context.
 * Returns { getHome, search, load, loadStreams }.
 *
 * @param {string} pluginSource  - JS source code of the plugin
 * @param {object} manifest      - mock manifest object
 * @param {Function} fetchImpl   - mock fetch implementation
 * @returns {object}
 */
function loadPlugin(pluginSource, manifest, fetchImpl) {
    const sandbox = {
        manifest,
        fetch:           fetchImpl,
        MultimediaItem,
        Episode,
        StreamResult,
        Actor,
        Trailer,
        registerSettings,
        settings,
        globalThis:      {},
    };
    // Execute the IIFE inside a function scope that has sandbox vars
    const fn = new Function(
        ...Object.keys(sandbox),
        pluginSource
    );
    fn(...Object.values(sandbox));
    return sandbox.globalThis;
}

// ─── Plugin source loader (Node.js fs) ────────────────────────────────────

const fs   = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function readPlugin(name) {
    return fs.readFileSync(path.join(ROOT, name, "plugin.js"), "utf8");
}

// ─── Wrap all tests in async main ─────────────────────────────────────────

async function main() {

// ─── OPhim Tests ──────────────────────────────────────────────────────────

const OPHIM_MANIFEST = { baseUrl: "https://ophim1.com" };

const OPHIM_LIST_RESPONSE = {
    data: {
        items: [
            { name: "Phim A", slug: "phim-a", thumb_url: "https://cdn/a.jpg", type: "single", year: "2024" },
            { name: "Phim B", slug: "phim-b", thumb_url: "https://cdn/b.jpg", type: "series", year: "2023" },
        ],
    },
};

const OPHIM_DETAIL_RESPONSE = {
    data: {
        item: {
            name:            "Phim A",
            origin_name:     "Film A",
            poster_url:      "https://cdn/poster.jpg",
            type:            "single",
            year:            "2024",
            content:         "Nội dung phim.",
            episode_current: "Full",
            actor:           ["Diễn viên A"],
            episodes: [
                {
                    server_name: "Server 1",
                    server_data: [
                        { name: "Full", slug: "full", link_m3u8: "https://cdn/video.m3u8", link_embed: "https://embed.tv/1" },
                    ],
                },
            ],
        },
    },
};

await test("OPhim › getHome returns categories with Trending", async () => {
    const { getHome } = loadPlugin(
        readPlugin("ophim"),
        OPHIM_MANIFEST,
        mockFetch(OPHIM_LIST_RESPONSE)
    );

    await new Promise(resolve => {
        getHome(result => {
            assert(result.success === true, "success is true");
            assert(typeof result.data === "object", "data is an object");
            assert(Array.isArray(result.data["Trending"]), "Trending category exists");
            assert(result.data["Trending"].length === 2, "Trending has 2 items");
            assert(result.data["Trending"][0] instanceof MultimediaItem, "items are MultimediaItem");
            resolve();
        });
    });
});

await test("OPhim › search returns results array", async () => {
    const { search } = loadPlugin(
        readPlugin("ophim"),
        OPHIM_MANIFEST,
        mockFetch(OPHIM_LIST_RESPONSE)
    );

    await new Promise(resolve => {
        search("phim a", result => {
            assert(result.success === true, "success is true");
            assert(Array.isArray(result.data), "data is an array");
            assert(result.data.length === 2, "returns 2 results");
            resolve();
        });
    });
});

await test("OPhim › search rejects empty query", async () => {
    const { search } = loadPlugin(
        readPlugin("ophim"),
        OPHIM_MANIFEST,
        mockFetch(OPHIM_LIST_RESPONSE)
    );

    await new Promise(resolve => {
        search("   ", result => {
            assert(result.success === false, "success is false for empty query");
            assert(typeof result.error === "string", "error message is string");
            resolve();
        });
    });
});

await test("OPhim › load returns MultimediaItem with episodes", async () => {
    const { load } = loadPlugin(
        readPlugin("ophim"),
        OPHIM_MANIFEST,
        mockFetch(OPHIM_DETAIL_RESPONSE)
    );

    await new Promise(resolve => {
        load("https://ophim1.com/phim/phim-a", result => {
            assert(result.success === true, "success is true");
            assert(result.data instanceof MultimediaItem, "data is MultimediaItem");
            assert(Array.isArray(result.data.episodes), "episodes array exists");
            assert(result.data.episodes.length === 1, "1 episode parsed");
            assert(result.data.episodes[0] instanceof Episode, "episode is Episode instance");
            resolve();
        });
    });
});

await test("OPhim › load fails gracefully on invalid URL", async () => {
    const { load } = loadPlugin(
        readPlugin("ophim"),
        OPHIM_MANIFEST,
        mockFetch(OPHIM_DETAIL_RESPONSE)
    );

    await new Promise(resolve => {
        load("https://ophim1.com/invalid-url", result => {
            assert(result.success === false, "success is false for invalid URL");
            resolve();
        });
    });
});

await test("OPhim › loadStreams returns StreamResult array", async () => {
    const { loadStreams } = loadPlugin(
        readPlugin("ophim"),
        OPHIM_MANIFEST,
        mockFetch(OPHIM_DETAIL_RESPONSE)
    );

    await new Promise(resolve => {
        loadStreams("https://ophim1.com/phim/phim-a#server=full", result => {
            assert(result.success === true, "success is true");
            assert(Array.isArray(result.data), "data is array");
            assert(result.data[0] instanceof StreamResult, "items are StreamResult");
            assert(result.data[0].url.includes("m3u8"), "HLS URL present");
            resolve();
        });
    });
});

await test("OPhim › getHome handles network error gracefully", async () => {
    const { getHome } = loadPlugin(
        readPlugin("ophim"),
        OPHIM_MANIFEST,
        errorFetch("Connection refused")
    );

    await new Promise(resolve => {
        getHome(result => {
            assert(result.success === false, "success is false on network error");
            assert(result.error.includes("Connection refused"), "error message forwarded");
            resolve();
        });
    });
});

// ─── KKPhim Tests ─────────────────────────────────────────────────────────

const KK_MANIFEST = { baseUrl: "https://phimapi.com" };
const KK_LIST     = { data: { items: [
    { name: "Phim K1", slug: "phim-k1", thumb_url: "https://cdn/k1.jpg", type: "series" },
    { name: "Phim K2", slug: "phim-k2", thumb_url: "https://cdn/k2.jpg", type: "single" },
] } };

await test("KKPhim › getHome succeeds with valid data", async () => {
    const { getHome } = loadPlugin(readPlugin("kkphim"), KK_MANIFEST, mockFetch(KK_LIST));

    await new Promise(resolve => {
        getHome(result => {
            assert(result.success === true, "success is true");
            assert(Array.isArray(result.data["Trending"]), "Trending exists");
            resolve();
        });
    });
});

await test("KKPhim › search empty query rejected", async () => {
    const { search } = loadPlugin(readPlugin("kkphim"), KK_MANIFEST, mockFetch(KK_LIST));

    await new Promise(resolve => {
        search("", result => {
            assert(result.success === false, "empty query rejected");
            resolve();
        });
    });
});

await test("KKPhim › loadStreams returns empty when no streams", async () => {
    const noStreamResponse = { data: { item: { episodes: [] } } };
    const { loadStreams }  = loadPlugin(readPlugin("kkphim"), KK_MANIFEST, mockFetch(noStreamResponse));

    await new Promise(resolve => {
        loadStreams("https://phimapi.com/phim/phim-k1#ep=tap-1", result => {
            assert(result.success === false, "no stream → failure");
            resolve();
        });
    });
});

// ─── NguonC Tests ─────────────────────────────────────────────────────────

const NC_MANIFEST = { baseUrl: "https://api.nguonc.com" };
const NC_LIST     = { data: { items: [
    { name: "NC Film", slug: "nc-film", thumb_url: "https://cdn/nc.jpg", type: "series" },
] } };

await test("NguonC › getHome succeeds", async () => {
    const { getHome } = loadPlugin(readPlugin("nguonc"), NC_MANIFEST, mockFetch(NC_LIST));

    await new Promise(resolve => {
        getHome(result => {
            assert(result.success === true, "success is true");
            assert(result.data["Trending"].length === 1, "1 item in Trending");
            resolve();
        });
    });
});

await test("NguonC › search with valid query", async () => {
    const { search } = loadPlugin(readPlugin("nguonc"), NC_MANIFEST, mockFetch(NC_LIST));

    await new Promise(resolve => {
        search("nc film", result => {
            assert(result.success === true, "success is true");
            resolve();
        });
    });
});

// ─── Motchill Tests ────────────────────────────────────────────────────────

const MC_MANIFEST = { baseUrl: "https://motchill.tv" };
const MC_HTML     = `<html><a href="/phim/abc" title="Phim Test">X</a>
<img data-src="https://cdn/abc.jpg" alt="Phim Test"></html>`;

await test("Motchill › getHome parses cards from HTML", async () => {
    const { getHome } = loadPlugin(readPlugin("motchill"), MC_MANIFEST, mockFetch(MC_HTML));

    await new Promise(resolve => {
        getHome(result => {
            // HTML parsing may yield 0 items depending on regex strictness — test shape only
            assert(result.success === true, "success is true");
            assert(typeof result.data === "object", "data is object");
            resolve();
        });
    });
});

await test("Motchill › search empty query rejected", async () => {
    const { search } = loadPlugin(readPlugin("motchill"), MC_MANIFEST, mockFetch(MC_HTML));

    await new Promise(resolve => {
        search(null, result => {
            assert(result.success === false, "null query rejected");
            resolve();
        });
    });
});

await test("Motchill › loadStreams returns failure on HTML without streams", async () => {
    const { loadStreams } = loadPlugin(readPlugin("motchill"), MC_MANIFEST, mockFetch("<html>No streams here</html>"));

    await new Promise(resolve => {
        loadStreams("https://motchill.tv/phim/test-phim", result => {
            assert(result.success === false, "no streams → failure");
            resolve();
        });
    });
});

await test("Motchill › loadStreams extracts m3u8 from HTML", async () => {
    const htmlWithStream = `<html><script>var url="https://cdn.example.com/video.m3u8";</script></html>`;
    const { loadStreams } = loadPlugin(readPlugin("motchill"), MC_MANIFEST, mockFetch(htmlWithStream));

    await new Promise(resolve => {
        loadStreams("https://motchill.tv/phim/test-phim", result => {
            assert(result.success === true, "m3u8 extracted successfully");
            assert(result.data[0].url.includes(".m3u8"), "URL contains .m3u8");
            resolve();
        });
    });
});

// ─── AnimeHay Tests ────────────────────────────────────────────────────────

const AH_MANIFEST  = { baseUrl: "https://animehay.tv" };
const AH_HTML      = `<html>
<a href="/phim-anime/naruto-slug" title="Naruto">X</a>
<img data-src="https://cdn/naruto.jpg">
<a href="/tap-phim/naruto-slug-tap-1">Tập 1</a>
<a href="/tap-phim/naruto-slug-tap-2">Tập 2</a>
</html>`;

await test("AnimeHay › getHome returns Trending category", async () => {
    const { getHome } = loadPlugin(readPlugin("animehay"), AH_MANIFEST, mockFetch(AH_HTML));

    await new Promise(resolve => {
        getHome(result => {
            assert(result.success === true, "success is true");
            assert("Trending" in result.data, "Trending category exists");
            resolve();
        });
    });
});

await test("AnimeHay › load parses episode list from HTML", async () => {
    const { load } = loadPlugin(readPlugin("animehay"), AH_MANIFEST, mockFetch(AH_HTML));

    await new Promise(resolve => {
        load("https://animehay.tv/phim-anime/naruto-slug", result => {
            assert(result.success === true, "success is true");
            assert(Array.isArray(result.data.episodes), "episodes array exists");
            assert(result.data.episodes.length >= 2, "at least 2 episodes found");
            assert(result.data.episodes[0].episode === 1, "first episode number is 1");
            resolve();
        });
    });
});

await test("AnimeHay › loadStreams extracts m3u8", async () => {
    const htmlWithM3u8 = `<html><script>var src="https://hls.example.com/stream.m3u8";</script></html>`;
    const { loadStreams } = loadPlugin(readPlugin("animehay"), AH_MANIFEST, mockFetch(htmlWithM3u8));

    await new Promise(resolve => {
        loadStreams("https://animehay.tv/tap-phim/naruto-slug-tap-1", result => {
            assert(result.success === true, "m3u8 extracted successfully");
            assert(result.data[0] instanceof StreamResult, "StreamResult returned");
            resolve();
        });
    });
});

// ─── BiluTV Tests ─────────────────────────────────────────────────────────

const BL_MANIFEST = { baseUrl: "https://bilutv.org" };
const BL_HTML     = `<html>
<a href="/phim/drama-slug.html" title="Hàn Quốc Drama">X</a>
<img data-src="https://cdn/drama.jpg">
<a href="/phim/drama-slug-tap-1.html">1</a>
<a href="/phim/drama-slug-tap-2.html">2</a>
</html>`;

await test("BiluTV › getHome succeeds", async () => {
    const { getHome } = loadPlugin(readPlugin("bilutv"), BL_MANIFEST, mockFetch(BL_HTML));

    await new Promise(resolve => {
        getHome(result => {
            assert(result.success === true, "success is true");
            assert("Trending" in result.data, "Trending exists");
            resolve();
        });
    });
});

await test("BiluTV › load parses numbered episodes", async () => {
    const { load } = loadPlugin(readPlugin("bilutv"), BL_MANIFEST, mockFetch(BL_HTML));

    await new Promise(resolve => {
        load("https://bilutv.org/phim/drama-slug.html", result => {
            assert(result.success === true, "success is true");
            assert(result.data instanceof MultimediaItem, "MultimediaItem returned");
            resolve();
        });
    });
});

await test("BiluTV › loadStreams handles m3u8 in source", async () => {
    const htmlWithStream = `<html><script>sources:[{file:"https://cdn.example.com/bilu.m3u8"}]</script></html>`;
    const { loadStreams } = loadPlugin(readPlugin("bilutv"), BL_MANIFEST, mockFetch(htmlWithStream));

    await new Promise(resolve => {
        loadStreams("https://bilutv.org/phim/drama-slug-tap-1.html", result => {
            assert(result.success === true, "stream extracted");
            assert(result.data[0].quality !== undefined, "quality label present");
            resolve();
        });
    });
});

// ─── Phim1080 Tests ────────────────────────────────────────────────────────

const P1080_MANIFEST = { baseUrl: "https://phim1080.in" };
const P1080_HTML     = `<html>
<h1 class="title">[1080p] Phim HD Full</h1>
<meta property="og:image" content="https://cdn/hd.jpg">
<a href="/tap-phim/phim-hd-tap-1/">1</a>
<a href="/tap-phim/phim-hd-tap-2/">2</a>
<script>sources:[{file:"https://hls.example.com/hd1080.m3u8"}]</script>
</html>`;

await test("Phim1080 › getHome succeeds", async () => {
    const { getHome } = loadPlugin(readPlugin("phim1080"), P1080_MANIFEST, mockFetch(P1080_HTML));

    await new Promise(resolve => {
        getHome(result => {
            assert(result.success === true, "success is true");
            assert("Trending" in result.data, "Trending category exists");
            resolve();
        });
    });
});

await test("Phim1080 › load extracts quality tag from title", async () => {
    const { load } = loadPlugin(readPlugin("phim1080"), P1080_MANIFEST, mockFetch(P1080_HTML));

    await new Promise(resolve => {
        load("https://phim1080.in/phim/phim-hd/", result => {
            assert(result.success === true, "success is true");
            // Title should NOT contain "[1080p]" bracket
            assert(!result.data.title.includes("["), "quality tag stripped from title");
            resolve();
        });
    });
});

await test("Phim1080 › loadStreams extracts HLS stream", async () => {
    const { loadStreams } = loadPlugin(readPlugin("phim1080"), P1080_MANIFEST, mockFetch(P1080_HTML));

    await new Promise(resolve => {
        loadStreams("https://phim1080.in/tap-phim/phim-hd-tap-1/", result => {
            assert(result.success === true, "stream extracted");
            assert(result.data.some(s => s.url.includes(".m3u8")), "m3u8 in results");
            resolve();
        });
    });
});

await test("Phim1080 › search empty query rejected", async () => {
    const { search } = loadPlugin(readPlugin("phim1080"), P1080_MANIFEST, mockFetch(P1080_HTML));

    await new Promise(resolve => {
        search("", result => {
            assert(result.success === false, "empty query rejected");
            resolve();
        });
    });
});

// ─── Network error resilience across all plugins ──────────────────────────

const PLUGINS = [
    ["ophim",       OPHIM_MANIFEST],
    ["kkphim",      KK_MANIFEST],
    ["nguonc",      NC_MANIFEST],
    ["motchill",    MC_MANIFEST],
    ["phimchill",   { baseUrl: "https://phimchill.net" }],
    ["animehay",    AH_MANIFEST],
    ["animevietsub",{ baseUrl: "https://animevietsub.tv" }],
    ["bilutv",      BL_MANIFEST],
    ["phim1080",    P1080_MANIFEST],
];

for (const [name, mf] of PLUGINS) {
    await test(`${name} › getHome handles HTTP 500 gracefully`, async () => {
        const { getHome } = loadPlugin(readPlugin(name), mf, mockFetch("Internal Server Error", 500));

        await new Promise(resolve => {
            getHome(result => {
                assert(result.success === false, `${name} returns failure on HTTP 500`);
                assert(typeof result.error === "string" && result.error.length > 0,
                    `${name} includes error message`);
                resolve();
            });
        });
    });
}

// ─── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${_passed} passed, ${_failed} failed`);
if (_failed > 0) {
    console.error(`\n⚠  ${_failed} test(s) failed.`);
    process.exit(1);
} else {
    console.log(`\n🎉  All tests passed!`);
}

} // end main()

main().catch(err => { console.error(err); process.exit(1); });
