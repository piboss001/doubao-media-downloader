// ==UserScript==
// @name         Doubao Media Downloader
// @namespace    https://github.com/piboss001/doubao-media-downloader
// @version      1.0.2
// @description  豆包生成视频无水印下载助手
// @author       piboss001
// @match        https://www.doubao.com/*
// @match        https://doubao.com/*
// @run-at       document-start
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      *
// @updateURL    https://raw.githubusercontent.com/piboss001/doubao-media-downloader/main/doubao-media-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/piboss001/doubao-media-downloader/main/doubao-media-downloader.user.js
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '1.0.2';
    const TAG = '[DoubaoDL]';

    const pageWindow =
        typeof unsafeWindow !== 'undefined'
            ? unsafeWindow
            : window;

    /* ============================================================
       STATE
    ============================================================ */

    const state = {
        originals: new Map(),
        fallbackApis: new Set(),
        resolvingApis: new Set(),
        resolvedApis: new Set(),
        panelOpen: false
    };

    function log(...args) {
        console.log(TAG, ...args);
    }

    function warn(...args) {
        console.warn(TAG, ...args);
    }

    function isHttp(value) {
        return (
            typeof value === 'string' &&
            /^https?:\/\//i.test(value)
        );
    }

    function timestamp() {
        const d = new Date();

        const p = n =>
            String(n).padStart(2, '0');

        return (
            d.getFullYear() +
            p(d.getMonth() + 1) +
            p(d.getDate()) +
            '_' +
            p(d.getHours()) +
            p(d.getMinutes()) +
            p(d.getSeconds())
        );
    }

    /* ============================================================
       STYLE
    ============================================================ */

    function installStyle() {
        if (document.getElementById('doubao-dl-style')) {
            return;
        }

        const style = document.createElement('style');

        style.id = 'doubao-dl-style';

        style.textContent = `

.doubao-dl-card-button {
    position:absolute !important;
    left:10px !important;
    top:10px !important;

    z-index:2147483000 !important;

    height:34px !important;
    padding:0 12px !important;

    display:flex !important;
    align-items:center !important;
    gap:6px !important;

    border:1px solid rgba(255,255,255,.20) !important;
    border-radius:8px !important;

    background:rgba(15,15,18,.82) !important;
    color:#fff !important;

    box-shadow:0 3px 12px rgba(0,0,0,.22) !important;

    backdrop-filter:blur(8px) !important;

    font-family:
        -apple-system,
        BlinkMacSystemFont,
        "PingFang SC",
        "Microsoft YaHei",
        sans-serif !important;

    font-size:13px !important;
    font-weight:500 !important;

    cursor:pointer !important;

    transition:.15s ease !important;
}

.doubao-dl-card-button:hover {
    background:rgba(0,0,0,.95) !important;
    transform:translateY(-1px);
}

.doubao-dl-card-button.is-ready {
    background:rgba(15,15,18,.88) !important;
}

.doubao-dl-card-button.is-waiting {
    opacity:.78 !important;
}

#doubao-dl-fab {
    position:fixed !important;

    right:22px !important;
    bottom:100px !important;

    z-index:2147483645 !important;

    width:48px !important;
    height:48px !important;

    border:0 !important;
    border-radius:14px !important;

    background:#18181b !important;
    color:#fff !important;

    font-size:20px !important;

    cursor:pointer !important;

    box-shadow:
        0 8px 30px
        rgba(0,0,0,.24) !important;
}

#doubao-dl-fab-count {
    position:absolute;

    right:-5px;
    top:-5px;

    min-width:18px;
    height:18px;

    padding:0 4px;

    display:flex;
    align-items:center;
    justify-content:center;

    border-radius:9px;

    background:#fff;
    color:#111;

    font-size:10px;
    font-weight:600;

    box-shadow:0 2px 8px rgba(0,0,0,.18);
}

#doubao-dl-panel {
    position:fixed !important;

    right:22px !important;
    bottom:158px !important;

    z-index:2147483646 !important;

    width:360px !important;
    max-height:470px !important;

    background:#fff !important;
    color:#18181b !important;

    border:
        1px solid
        rgba(0,0,0,.08) !important;

    border-radius:16px !important;

    box-shadow:
        0 16px 50px
        rgba(0,0,0,.18) !important;

    overflow:hidden !important;

    font-family:
        -apple-system,
        BlinkMacSystemFont,
        "PingFang SC",
        "Microsoft YaHei",
        sans-serif !important;
}

#doubao-dl-panel[hidden] {
    display:none !important;
}

.doubao-dl-head {
    height:54px;

    padding:0 15px;

    display:flex;
    align-items:center;
    justify-content:space-between;

    border-bottom:1px solid #eee;
}

.doubao-dl-title {
    font-size:15px;
    font-weight:600;
}

.doubao-dl-version {
    margin-left:4px;

    color:#999;

    font-size:11px;
    font-weight:400;
}

.doubao-dl-status {
    font-size:11px;
    color:#888;
}

.doubao-dl-list {
    padding:8px;

    max-height:330px;

    overflow:auto;
}

.doubao-dl-empty {
    padding:34px 12px;

    text-align:center;

    color:#999;

    font-size:13px;
    line-height:1.8;
}

.doubao-dl-item {
    display:flex;
    align-items:center;

    gap:8px;

    padding:9px;

    border-radius:9px;
}

.doubao-dl-item:hover {
    background:#f6f6f7;
}

.doubao-dl-item-index {
    width:25px;

    color:#999;

    font-size:11px;
}

.doubao-dl-item-info {
    flex:1;

    min-width:0;
}

.doubao-dl-item-title {
    margin-bottom:3px;

    font-size:12px;
    font-weight:500;
}

.doubao-dl-item-url {
    overflow:hidden;

    color:#999;

    font-size:10px;

    white-space:nowrap;
    text-overflow:ellipsis;
}

.doubao-dl-download {
    border:0;

    padding:7px 10px;

    border-radius:7px;

    background:#18181b;
    color:#fff;

    font-size:12px;

    cursor:pointer;
}

.doubao-dl-footer {
    min-height:45px;

    padding:0 13px;

    display:flex;
    align-items:center;
    justify-content:space-between;

    border-top:1px solid #eee;

    color:#888;

    font-size:11px;
}

.doubao-dl-clear {
    border:0;
    background:none;

    color:#666;

    cursor:pointer;
}

#doubao-dl-toast {
    position:fixed;

    left:50%;
    bottom:80px;

    transform:translateX(-50%);

    z-index:2147483647;

    padding:9px 15px;

    border-radius:9px;

    background:rgba(0,0,0,.82);
    color:#fff;

    font-family:
        -apple-system,
        BlinkMacSystemFont,
        "PingFang SC",
        "Microsoft YaHei",
        sans-serif;

    font-size:13px;

    pointer-events:none;
}

`;

        (
            document.head ||
            document.documentElement
        ).appendChild(style);
    }

    /* ============================================================
       TOAST
    ============================================================ */

    let toastTimer;

    function toast(message) {
        let el =
            document.getElementById(
                'doubao-dl-toast'
            );

        if (!el) {
            el =
                document.createElement('div');

            el.id =
                'doubao-dl-toast';

            document.documentElement
                .appendChild(el);
        }

        el.textContent =
            message;

        clearTimeout(toastTimer);

        toastTimer =
            setTimeout(() => {
                el.remove();
            }, 2600);
    }

    /* ============================================================
       FLOATING PANEL
    ============================================================ */

    function createUI() {
        if (
            document.getElementById(
                'doubao-dl-fab'
            )
        ) {
            return;
        }

        const fab =
            document.createElement('button');

        fab.id =
            'doubao-dl-fab';

        fab.innerHTML = `
            ↓
            <span id="doubao-dl-fab-count">0</span>
        `;

        fab.title =
            '豆包无水印资源';

        const panel =
            document.createElement('div');

        panel.id =
            'doubao-dl-panel';

        panel.hidden =
            true;

        panel.innerHTML = `

<div class="doubao-dl-head">

    <div class="doubao-dl-title">

        豆包资源助手

        <span class="doubao-dl-version">
            v${VERSION}
        </span>

    </div>

    <div
        class="doubao-dl-status"
        id="doubao-dl-status"
    >
        0 个无水印资源
    </div>

</div>

<div
    class="doubao-dl-list"
    id="doubao-dl-list"
>
</div>

<div class="doubao-dl-footer">

    <span>
        仅下载已确认解析的原始资源
    </span>

    <button
        class="doubao-dl-clear"
        id="doubao-dl-clear"
    >
        清空
    </button>

</div>

`;

        fab.addEventListener(
            'click',
            () => {
                state.panelOpen =
                    !state.panelOpen;

                panel.hidden =
                    !state.panelOpen;
            }
        );

        panel
            .querySelector(
                '#doubao-dl-clear'
            )
            .addEventListener(
                'click',
                () => {
                    state.originals.clear();

                    updateUI();
                }
            );

        document.documentElement
            .appendChild(fab);

        document.documentElement
            .appendChild(panel);

        updateUI();
    }

    function updateUI() {
        const count =
            state.originals.size;

        const badge =
            document.getElementById(
                'doubao-dl-fab-count'
            );

        const status =
            document.getElementById(
                'doubao-dl-status'
            );

        const list =
            document.getElementById(
                'doubao-dl-list'
            );

        if (badge) {
            badge.textContent =
                count;
        }

        if (status) {
            status.textContent =
                `${count} 个无水印资源`;
        }

        if (!list) {
            return;
        }

        list.innerHTML =
            '';

        const resources =
            [...state.originals.values()]
                .sort(
                    (a, b) =>
                        b.time - a.time
                );

        if (!resources.length) {
            list.innerHTML = `

<div class="doubao-dl-empty">

    暂未捕获到无水印资源

    <br>

    请在脚本启动后重新生成一个视频

</div>

`;

            updateCardButtons();

            return;
        }

        resources.forEach(
            (item, index) => {
                const row =
                    document.createElement('div');

                row.className =
                    'doubao-dl-item';

                row.innerHTML = `

<div class="doubao-dl-item-index">
    ${index + 1}
</div>

<div class="doubao-dl-item-info">

    <div class="doubao-dl-item-title">
        无水印视频
    </div>

    <div
        class="doubao-dl-item-url"
        title="${escapeHtml(item.url)}"
    >
        ${escapeHtml(item.url)}
    </div>

</div>

<button class="doubao-dl-download">
    下载
</button>

`;

                row
                    .querySelector(
                        '.doubao-dl-download'
                    )
                    .addEventListener(
                        'click',
                        () => {
                            downloadOriginal(
                                item.url
                            );
                        }
                    );

                list.appendChild(row);
            }
        );

        updateCardButtons();
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(
                /[&<>"']/g,
                char => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#39;'
                })[char]
            );
    }

    /* ============================================================
       STORE ONLY CONFIRMED ORIGINALS
    ============================================================ */

    function addOriginal(
        url,
        source = 'unknown'
    ) {
        if (!isHttp(url)) {
            return;
        }

        if (
            state.originals.has(url)
        ) {
            return;
        }

        state.originals.set(
            url,
            {
                url,
                source,
                time: Date.now()
            }
        );

        log(
            'Confirmed original:',
            source,
            url
        );

        updateUI();

        toast(
            '已捕获无水印视频'
        );
    }

    /* ============================================================
       GENERIC JSON WALKER
    ============================================================ */

    function walk(
        value,
        callback,
        depth = 0,
        visited = new Set()
    ) {
        if (
            value == null ||
            depth > 18
        ) {
            return;
        }

        if (
            typeof value === 'string'
        ) {
            callback(
                value,
                null,
                null
            );

            if (
                value.length < 2000000 &&
                (
                    value.startsWith('{') ||
                    value.startsWith('[')
                )
            ) {
                try {
                    walk(
                        JSON.parse(value),
                        callback,
                        depth + 1,
                        visited
                    );
                } catch (_) {}
            }

            return;
        }

        if (
            typeof value !== 'object'
        ) {
            return;
        }

        if (
            visited.has(value)
        ) {
            return;
        }

        visited.add(value);

        if (
            Array.isArray(value)
        ) {
            value.forEach(item =>
                walk(
                    item,
                    callback,
                    depth + 1,
                    visited
                )
            );

            return;
        }

        for (
            const [key, child]
            of Object.entries(value)
        ) {
            callback(
                child,
                key,
                value
            );

            walk(
                child,
                callback,
                depth + 1,
                visited
            );
        }
    }

    /* ============================================================
       RESPONSE INSPECTION
    ============================================================ */

    function inspectJSON(json) {
        if (
            !json ||
            typeof json !== 'object'
        ) {
            return;
        }

        walk(
            json,
            (
                value,
                key,
                parent
            ) => {

                /*
                 * IMPORTANT:
                 *
                 * Do NOT add generic main_url here.
                 *
                 * main_url can be a normal/watermarked
                 * playback URL.
                 */

                if (
                    key === 'fallback_api' &&
                    typeof value === 'string'
                ) {
                    discoverFallbackApi(
                        value
                    );
                }

                /*
                 * Explicit original_media_info is allowed.
                 */

                if (
                    key ===
                        'original_media_info' &&
                    value &&
                    typeof value === 'object'
                ) {
                    const url =
                        value.main_url;

                    if (
                        isHttp(url)
                    ) {
                        addOriginal(
                            url,
                            'original_media_info'
                        );
                    }
                }

                /*
                 * Some responses may explicitly mark
                 * the URL as unwatermarked/original.
                 */

                if (
                    typeof value === 'string' &&
                    isHttp(value) &&
                    key &&
                    /unwatermarked|unwatermark|original_url|origin_url/i
                        .test(key)
                ) {
                    addOriginal(
                        value,
                        key
                    );
                }
            }
        );
    }

    function inspectText(text) {
        if (
            typeof text !== 'string' ||
            text.length < 2
        ) {
            return;
        }

        const trimmed =
            text.trim();

        if (
            trimmed.startsWith('{') ||
            trimmed.startsWith('[')
        ) {
            try {
                inspectJSON(
                    JSON.parse(trimmed)
                );

                return;
            } catch (_) {}
        }

        /*
         * fallback_api may exist inside
         * escaped JSON strings.
         */

        const patterns = [
            /"fallback_api"\s*:\s*"([^"]+)"/g,
            /fallback_api\\?"\s*:\\?"([^"]+)/g
        ];

        for (
            const regex of patterns
        ) {
            let match;

            while (
                (
                    match =
                        regex.exec(text)
                )
            ) {
                const value =
                    decodeEscapedURL(
                        match[1]
                    );

                discoverFallbackApi(
                    value
                );
            }
        }
    }

    function decodeEscapedURL(value) {
        return String(value || '')
            .replace(/\\u0026/gi, '&')
            .replace(/\\\//g, '/')
            .replace(/\\"/g, '"');
    }

    /* ============================================================
       FALLBACK API
    ============================================================ */

    function discoverFallbackApi(
        rawURL
    ) {
        const fallbackURL =
            decodeEscapedURL(rawURL);

        if (
            !isHttp(fallbackURL)
        ) {
            return;
        }

        if (
            state.fallbackApis.has(
                fallbackURL
            )
        ) {
            return;
        }

        state.fallbackApis.add(
            fallbackURL
        );

        log(
            'fallback_api:',
            fallbackURL
        );

        resolveFallbackApi(
            fallbackURL
        );
    }

    function resolveFallbackApi(
        fallbackURL
    ) {
        if (
            state.resolvingApis.has(
                fallbackURL
            ) ||
            state.resolvedApis.has(
                fallbackURL
            )
        ) {
            return;
        }

        state.resolvingApis.add(
            fallbackURL
        );

        let url;

        try {
            url =
                new URL(
                    fallbackURL
                );
        } catch (_) {
            state.resolvingApis.delete(
                fallbackURL
            );

            return;
        }

        /*
         * This is the important part:
         * explicitly request the no-logo variant.
         */

        url.searchParams.set(
            'channel',
            'no'
        );

        url.searchParams.set(
            'codec_type',
            '8'
        );

        url.searchParams.set(
            'logo_type',
            'unwatermarked'
        );

        log(
            'Resolving unwatermarked:',
            url.toString()
        );

        GM_xmlhttpRequest({
            method: 'GET',

            url:
                url.toString(),

            headers: {
                Accept:
                    'application/json,text/plain,*/*'
            },

            timeout: 30000,

            onload(response) {
                state.resolvingApis.delete(
                    fallbackURL
                );

                state.resolvedApis.add(
                    fallbackURL
                );

                try {
                    const json =
                        JSON.parse(
                            response.responseText
                        );

                    parseUnwatermarkedResponse(
                        json
                    );
                } catch (error) {
                    warn(
                        'fallback JSON parse failed',
                        error
                    );
                }
            },

            onerror(error) {
                state.resolvingApis.delete(
                    fallbackURL
                );

                warn(
                    'fallback request failed',
                    error
                );
            },

            ontimeout() {
                state.resolvingApis.delete(
                    fallbackURL
                );

                warn(
                    'fallback request timeout'
                );
            }
        });
    }

    /* ============================================================
       STRICT UNWATERMARKED RESPONSE PARSER
    ============================================================ */

    function parseUnwatermarkedResponse(
        json
    ) {
        if (
            !json ||
            typeof json !== 'object'
        ) {
            return;
        }

        /*
         * We are inside the response from:
         *
         * logo_type=unwatermarked
         *
         * Therefore main_url obtained from the
         * media payload here is treated as the
         * requested unwatermarked variant.
         */

        const candidates =
            [];

        const roots = [
            json,
            json.data,
            json.video_info,
            json.data?.video_info,
            json.video_info?.data,
            json.data?.video_info?.data
        ].filter(Boolean);

        for (
            const root of roots
        ) {
            collectMediaCandidates(
                root,
                candidates
            );
        }

        if (
            !candidates.length
        ) {
            /*
             * Strict recursive fallback, but only
             * inside this explicit unwatermarked
             * response.
             */

            walk(
                json,
                (
                    value,
                    key,
                    parent
                ) => {
                    if (
                        key === 'main_url' &&
                        isHttp(value)
                    ) {
                        candidates.push({
                            url: value,
                            score:
                                mediaScore(
                                    parent
                                )
                        });
                    }
                }
            );
        }

        if (
            !candidates.length
        ) {
            warn(
                'No unwatermarked main_url found'
            );

            toast(
                '接口已捕获，但没有解析到无水印地址'
            );

            return;
        }

        candidates.sort(
            (a, b) =>
                b.score - a.score
        );

        const best =
            candidates[0];

        addOriginal(
            best.url,
            'fallback_api:unwatermarked'
        );
    }

    function collectMediaCandidates(
        root,
        output
    ) {
        if (
            !root ||
            typeof root !== 'object'
        ) {
            return;
        }

        if (
            isHttp(root.main_url)
        ) {
            output.push({
                url:
                    root.main_url,

                score:
                    mediaScore(root)
            });
        }

        const list =
            root.video_list;

        if (
            list &&
            typeof list === 'object'
        ) {
            const entries =
                Array.isArray(list)
                    ? list
                    : Object.values(list);

            entries.forEach(
                entry => {
                    if (
                        entry &&
                        typeof entry ===
                            'object' &&
                        isHttp(
                            entry.main_url
                        )
                    ) {
                        output.push({
                            url:
                                entry.main_url,

                            score:
                                mediaScore(
                                    entry
                                )
                        });
                    }
                }
            );
        }
    }

    function mediaScore(item) {
        if (
            !item ||
            typeof item !== 'object'
        ) {
            return 0;
        }

        const bitrate =
            Number(
                item.bitrate ||
                item.real_bitrate ||
                0
            );

        const width =
            Number(
                item.width ||
                item.vwidth ||
                0
            );

        const height =
            Number(
                item.height ||
                item.vheight ||
                0
            );

        return (
            bitrate +
            width * height
        );
    }

    /* ============================================================
       FETCH HOOK
    ============================================================ */

    function installFetchHook() {
        if (
            !pageWindow.fetch ||
            pageWindow.fetch.__doubaoDL102
        ) {
            return;
        }

        const original =
            pageWindow.fetch;

        const hooked =
            async function () {
                const response =
                    await original.apply(
                        this,
                        arguments
                    );

                try {
                    response
                        .clone()
                        .text()
                        .then(inspectText)
                        .catch(() => {});
                } catch (_) {}

                return response;
            };

        hooked.__doubaoDL102 =
            true;

        try {
            pageWindow.fetch =
                hooked;

            log(
                'fetch hook installed'
            );
        } catch (error) {
            warn(
                'fetch hook failed',
                error
            );
        }
    }

    /* ============================================================
       XHR HOOK
    ============================================================ */

    function installXHRHook() {
        const XHR =
            pageWindow.XMLHttpRequest;

        if (
            !XHR ||
            XHR.prototype
                .__doubaoDL102
        ) {
            return;
        }

        const originalOpen =
            XHR.prototype.open;

        XHR.prototype.open =
            function () {
                this.addEventListener(
                    'load',
                    () => {
                        try {
                            if (
                                !this.responseType ||
                                this.responseType ===
                                    'text'
                            ) {
                                inspectText(
                                    this.responseText
                                );
                            }
                        } catch (_) {}
                    }
                );

                return originalOpen.apply(
                    this,
                    arguments
                );
            };

        XHR.prototype.__doubaoDL102 =
            true;

        log(
            'XHR hook installed'
        );
    }

    /* ============================================================
       VIDEO DETECTION
       IMPORTANT:
       NO GLOBAL BUTTON/SVG/IMG SCANNING.
    ============================================================ */

    function visibleVideos() {
        return [
            ...document.querySelectorAll(
                'video'
            )
        ].filter(video => {
            const rect =
                video.getBoundingClientRect();

            return (
                rect.width >= 180 &&
                rect.height >= 220 &&
                rect.width <= 800 &&
                rect.height <= 1200
            );
        });
    }

    function findMediaContainer(
        video
    ) {
        const videoRect =
            video.getBoundingClientRect();

        let node =
            video.parentElement;

        let best =
            video.parentElement;

        for (
            let i = 0;
            node &&
            i < 6;
            i++
        ) {
            const rect =
                node.getBoundingClientRect();

            /*
             * Container must remain close to the
             * actual video dimensions.
             *
             * This prevents climbing into chat
             * message/sidebar/layout containers.
             */

            const widthRatio =
                rect.width /
                videoRect.width;

            const heightRatio =
                rect.height /
                videoRect.height;

            if (
                rect.width >=
                    videoRect.width &&
                rect.height >=
                    videoRect.height &&
                widthRatio <= 1.35 &&
                heightRatio <= 1.35
            ) {
                best =
                    node;
            } else {
                break;
            }

            node =
                node.parentElement;
        }

        return best;
    }

    /* ============================================================
       CARD BUTTONS
    ============================================================ */

    function decorateVideos() {
        const videos =
            visibleVideos();

        videos.forEach(
            video => {
                const container =
                    findMediaContainer(
                        video
                    );

                if (!container) {
                    return;
                }

                if (
                    container.querySelector(
                        ':scope > .doubao-dl-card-button'
                    )
                ) {
                    return;
                }

                const style =
                    getComputedStyle(
                        container
                    );

                if (
                    style.position ===
                    'static'
                ) {
                    container.style.position =
                        'relative';
                }

                const button =
                    document.createElement(
                        'button'
                    );

                button.className =
                    'doubao-dl-card-button';

                button.type =
                    'button';

                button.innerHTML =
                    '↓ 无水印下载';

                button.addEventListener(
                    'click',
                    event => {
                        event.preventDefault();
                        event.stopPropagation();

                        downloadForVideo(
                            video,
                            button
                        );
                    },
                    true
                );

                container.appendChild(
                    button
                );
            }
        );

        updateCardButtons();
    }

    function updateCardButtons() {
        const buttons =
            document.querySelectorAll(
                '.doubao-dl-card-button'
            );

        const count =
            state.originals.size;

        buttons.forEach(
            button => {
                button.classList.toggle(
                    'is-ready',
                    count > 0
                );

                button.classList.toggle(
                    'is-waiting',
                    count === 0
                );
            }
        );
    }

    /* ============================================================
       CARD → ORIGINAL MAPPING
    ============================================================ */

    function downloadForVideo(
        video,
        button
    ) {
        const resources =
            [...state.originals.values()]
                .sort(
                    (a, b) =>
                        a.time - b.time
                );

        if (
            resources.length === 0
        ) {
            toast(
                '暂未解析到无水印地址，请重新生成视频后再试'
            );

            return;
        }

        const videos =
            visibleVideos();

        /*
         * Safe mapping rule:
         *
         * If exactly one generated video and one
         * original resource exist, mapping is
         * unambiguous.
         */

        if (
            videos.length === 1 &&
            resources.length === 1
        ) {
            downloadOriginal(
                resources[0].url
            );

            return;
        }

        /*
         * If counts match, map visible card order
         * to capture order.
         */

        if (
            videos.length ===
                resources.length
        ) {
            const index =
                videos.indexOf(video);

            if (
                index >= 0 &&
                resources[index]
            ) {
                downloadOriginal(
                    resources[index].url
                );

                return;
            }
        }

        /*
         * IMPORTANT:
         *
         * Do NOT silently download currentSrc.
         * Do NOT silently download the latest URL.
         *
         * Wrong video is worse than refusing.
         */

        state.panelOpen =
            true;

        const panel =
            document.getElementById(
                'doubao-dl-panel'
            );

        if (panel) {
            panel.hidden =
                false;
        }

        toast(
            '检测到多个视频，暂时无法安全确定对应关系，请从右侧资源窗口下载'
        );
    }

    /* ============================================================
       DOWNLOAD ORIGINAL ONLY
    ============================================================ */

    function downloadOriginal(url) {
        if (
            !state.originals.has(url)
        ) {
            toast(
                '该地址没有通过无水印解析验证'
            );

            return;
        }

        const filename =
            `doubao_original_${timestamp()}.mp4`;

        log(
            'Downloading confirmed original:',
            url
        );

        try {
            GM_download({
                url,
                name: filename,
                saveAs: false,

                onload() {
                    toast(
                        '无水印视频已开始下载'
                    );
                },

                onerror(error) {
                    warn(
                        'GM_download error',
                        error
                    );

                    toast(
                        '下载失败，请查看控制台'
                    );
                }
            });
        } catch (error) {
            warn(
                'download error',
                error
            );

            toast(
                '下载失败'
            );
        }
    }

    /* ============================================================
       DOM OBSERVER
    ============================================================ */

    let decorateTimer;

    function scheduleDecorate() {
        clearTimeout(
            decorateTimer
        );

        decorateTimer =
            setTimeout(
                decorateVideos,
                150
            );
    }

    function installObserver() {
        const observer =
            new MutationObserver(
                scheduleDecorate
            );

        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );

        /*
         * React repair loop.
         */

        setInterval(
            decorateVideos,
            2000
        );
    }

    /* ============================================================
       DOM BOOT
    ============================================================ */

    function bootDOM() {
        installStyle();

        createUI();

        decorateVideos();

        installObserver();

        toast(
            `Doubao Media Downloader v${VERSION} 已启动`
        );
    }

    /* ============================================================
       START NETWORK HOOKS
    ============================================================ */

    installFetchHook();

    installXHRHook();

    /*
     * Doubao may replace network methods during
     * application bootstrap.
     */

    let repairs = 0;

    const repairTimer =
        setInterval(
            () => {
                installFetchHook();

                installXHRHook();

                repairs++;

                if (
                    repairs >= 20
                ) {
                    clearInterval(
                        repairTimer
                    );
                }
            },
            500
        );

    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            bootDOM,
            {
                once: true
            }
        );
    } else {
        bootDOM();
    }

})();
