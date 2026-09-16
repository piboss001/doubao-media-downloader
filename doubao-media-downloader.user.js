// ==UserScript==
// @name         Doubao Media Downloader
// @namespace    https://github.com/piboss001/doubao-media-downloader
// @version      1.0.1
// @description  豆包生成视频无水印下载助手
// @author       piboss001
// @match        https://www.doubao.com/*
// @match        https://doubao.com/*
// @run-at       document-start
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      doubao.com
// @connect      *
// @updateURL    https://raw.githubusercontent.com/piboss001/doubao-media-downloader/main/doubao-media-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/piboss001/doubao-media-downloader/main/doubao-media-downloader.user.js
// ==/UserScript==

(function () {
    'use strict';

    /********************************************************************
     * Doubao Media Downloader
     * GitHub:
     * https://github.com/piboss001/doubao-media-downloader
     ********************************************************************/

    const VERSION = '1.0.1';
    const TAG = '[Doubao Media Downloader]';

    console.log(
        `%c${TAG} v${VERSION} loaded`,
        'color:#fff;background:#111;padding:4px 8px;border-radius:4px;'
    );

    /* ================================================================
       STATE
    ================================================================ */

    const state = {
        videos: new Map(),
        images: new Map(),

        fallbackApis: new Set(),

        panelOpen: false,

        lastVideoURL: '',

        capturedResponses: 0
    };


    /* ================================================================
       UTIL
    ================================================================ */

    function log(...args) {
        console.log(TAG, ...args);
    }


    function isURL(value) {

        return (
            typeof value === 'string' &&
            /^https?:\/\//i.test(value)
        );

    }


    function escapeHTML(text) {

        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

    }


    function timestamp() {

        const d = new Date();

        const pad = n =>
            String(n).padStart(2, '0');

        return (
            d.getFullYear() +
            pad(d.getMonth() + 1) +
            pad(d.getDate()) +
            '_' +
            pad(d.getHours()) +
            pad(d.getMinutes()) +
            pad(d.getSeconds())
        );

    }


    function toast(message) {

        let el =
            document.getElementById(
                'doubao-downloader-toast'
            );

        if (!el) {

            el =
                document.createElement('div');

            el.id =
                'doubao-downloader-toast';

            document.documentElement
                .appendChild(el);

        }

        el.textContent =
            message;

        clearTimeout(
            toast.timer
        );

        toast.timer =
            setTimeout(() => {

                el.remove();

            }, 2500);

    }


    /* ================================================================
       STYLE
    ================================================================ */

    function installStyle() {

        if (
            document.getElementById(
                'doubao-downloader-style'
            )
        ) {
            return;
        }

        const style =
            document.createElement('style');

        style.id =
            'doubao-downloader-style';

        style.textContent = `

/* ================================================
   CARD DOWNLOAD BUTTON
================================================ */

.doubao-unwatermark-button {

    position:absolute !important;

    left:10px !important;
    top:10px !important;

    z-index:2147483000 !important;

    height:34px !important;

    padding:0 11px !important;

    display:flex !important;

    align-items:center !important;

    gap:6px !important;

    border:none !important;

    border-radius:8px !important;

    background:rgba(18,18,20,.82) !important;

    color:white !important;

    font-family:
        -apple-system,
        BlinkMacSystemFont,
        "PingFang SC",
        "Microsoft YaHei",
        sans-serif !important;

    font-size:13px !important;

    font-weight:500 !important;

    line-height:1 !important;

    cursor:pointer !important;

    box-shadow:
        0 3px 12px
        rgba(0,0,0,.22) !important;

    backdrop-filter:
        blur(8px) !important;

    transition:
        transform .15s ease,
        background .15s ease !important;

}


.doubao-unwatermark-button:hover {

    background:
        rgba(0,0,0,.95) !important;

    transform:
        translateY(-1px);

}


.doubao-unwatermark-button .icon {

    font-size:17px;

}


/* ================================================
   FLOAT BUTTON
================================================ */

#doubao-downloader-fab {

    position:fixed !important;

    right:22px !important;

    bottom:100px !important;

    z-index:2147483645 !important;

    width:48px !important;

    height:48px !important;

    border:none !important;

    border-radius:14px !important;

    background:#18181b !important;

    color:white !important;

    font-size:21px !important;

    cursor:pointer !important;

    box-shadow:
        0 8px 30px
        rgba(0,0,0,.24) !important;

}


#doubao-downloader-fab:hover {

    transform:
        translateY(-1px);

}


/* ================================================
   PANEL
================================================ */

#doubao-downloader-panel {

    position:fixed !important;

    right:22px !important;

    bottom:158px !important;

    z-index:2147483646 !important;

    width:350px !important;

    max-height:460px !important;

    background:white !important;

    border:

        1px solid
        rgba(0,0,0,.08) !important;

    border-radius:
        16px !important;

    box-shadow:

        0 16px 50px
        rgba(0,0,0,.18) !important;

    overflow:hidden !important;

    color:#18181b !important;

    font-family:

        -apple-system,
        BlinkMacSystemFont,
        "PingFang SC",
        "Microsoft YaHei",
        sans-serif !important;

}


#doubao-downloader-panel.hidden {

    display:none !important;

}


.dd-head {

    height:54px;

    padding:0 16px;

    display:flex;

    align-items:center;

    justify-content:
        space-between;

    border-bottom:

        1px solid
        #eeeeee;

}


.dd-title {

    font-size:15px;

    font-weight:600;

}


.dd-version {

    margin-left:5px;

    font-size:11px;

    color:#999;

    font-weight:400;

}


.dd-count {

    min-width:24px;

    height:24px;

    padding:0 7px;

    display:flex;

    align-items:center;

    justify-content:center;

    background:#f2f2f3;

    border-radius:8px;

    font-size:12px;

}


.dd-list {

    max-height:320px;

    overflow-y:auto;

    padding:8px;

}


.dd-empty {

    padding:36px 15px;

    text-align:center;

    color:#999;

    font-size:13px;

    line-height:1.7;

}


.dd-item {

    padding:9px;

    display:flex;

    align-items:center;

    gap:8px;

    border-radius:9px;

}


.dd-item:hover {

    background:#f6f6f7;

}


.dd-media-type {

    width:35px;

    flex:none;

    font-size:12px;

    color:#666;

}


.dd-media-url {

    flex:1;

    overflow:hidden;

    text-overflow:
        ellipsis;

    white-space:
        nowrap;

    font-size:11px;

    color:#888;

}


.dd-download {

    flex:none;

    border:none;

    border-radius:7px;

    background:#18181b;

    color:white;

    padding:7px 10px;

    font-size:12px;

    cursor:pointer;

}


.dd-footer {

    min-height:43px;

    padding:0 13px;

    display:flex;

    align-items:center;

    justify-content:
        space-between;

    border-top:

        1px solid
        #eeeeee;

    color:#888;

    font-size:11px;

}


.dd-clear {

    border:none;

    background:none;

    color:#666;

    cursor:pointer;

}


/* ================================================
   TOAST
================================================ */

#doubao-downloader-toast {

    position:fixed;

    left:50%;

    bottom:80px;

    transform:
        translateX(-50%);

    z-index:
        2147483647;

    padding:
        9px 15px;

    background:
        rgba(0,0,0,.82);

    color:white;

    border-radius:
        9px;

    font-size:
        13px;

    font-family:

        -apple-system,
        BlinkMacSystemFont,
        "PingFang SC",
        "Microsoft YaHei",
        sans-serif;

    pointer-events:none;

}

        `;

        (
            document.head ||
            document.documentElement
        ).appendChild(style);

    }


    /* ================================================================
       FLOAT UI
    ================================================================ */

    function createUI() {

        if (
            document.getElementById(
                'doubao-downloader-fab'
            )
        ) {
            return;
        }


        log(
            'Creating floating UI'
        );


        const fab =
            document.createElement('button');

        fab.id =
            'doubao-downloader-fab';

        fab.innerHTML =
            '↓';

        fab.title =
            '豆包无水印下载';


        const panel =
            document.createElement('div');

        panel.id =
            'doubao-downloader-panel';

        panel.className =
            'hidden';


        panel.innerHTML = `

<div class="dd-head">

    <div class="dd-title">

        豆包资源助手

        <span class="dd-version">
            v${VERSION}
        </span>

    </div>

    <div
        class="dd-count"
        id="doubao-downloader-count"
    >
        0
    </div>

</div>


<div
    class="dd-list"
    id="doubao-downloader-list"
>

    <div class="dd-empty">

        等待捕获豆包生成的视频

        <br>

        重新生成一个视频后会自动识别

    </div>

</div>


<div class="dd-footer">

    <span>
        视频左上角可直接下载
    </span>

    <button
        class="dd-clear"
        id="doubao-downloader-clear"
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

                panel.classList.toggle(
                    'hidden',
                    !state.panelOpen
                );

            }
        );


        document.documentElement
            .appendChild(fab);

        document.documentElement
            .appendChild(panel);


        panel
            .querySelector(
                '#doubao-downloader-clear'
            )
            .addEventListener(
                'click',
                () => {

                    state.videos.clear();

                    state.images.clear();

                    state.lastVideoURL =
                        '';

                    renderPanel();

                }
            );


        toast(
            'Doubao Media Downloader 已启动'
        );

    }


    /* ================================================================
       PANEL
    ================================================================ */

    function renderPanel() {

        const list =
            document.getElementById(
                'doubao-downloader-list'
            );

        const count =
            document.getElementById(
                'doubao-downloader-count'
            );


        if (
            !list ||
            !count
        ) {
            return;
        }


        const media = [

            ...Array.from(
                state.videos.values()
            ),

            ...Array.from(
                state.images.values()
            )

        ];


        count.textContent =
            media.length;


        if (
            media.length === 0
        ) {

            list.innerHTML = `

<div class="dd-empty">

    等待捕获豆包生成的视频

    <br>

    重新生成一个视频后会自动识别

</div>

            `;

            return;

        }


        list.innerHTML =
            '';


        media
            .slice()
            .reverse()
            .forEach(item => {

                const row =
                    document.createElement(
                        'div'
                    );

                row.className =
                    'dd-item';


                row.innerHTML = `

<span class="dd-media-type">

    ${
        item.type === 'video'
            ? '视频'
            : '图片'
    }

</span>


<span
    class="dd-media-url"
    title="${escapeHTML(item.url)}"
>

    ${escapeHTML(item.url)}

</span>


<button class="dd-download">

    下载

</button>

                `;


                row
                    .querySelector(
                        '.dd-download'
                    )
                    .addEventListener(
                        'click',
                        () => {

                            download(
                                item.url,
                                item.type
                            );

                        }
                    );


                list.appendChild(
                    row
                );

            });

    }


    /* ================================================================
       MEDIA STORE
    ================================================================ */

    function addVideo(url) {

        if (
            !isURL(url)
        ) {
            return;
        }


        if (
            state.videos.has(url)
        ) {
            return;
        }


        state.lastVideoURL =
            url;


        state.videos.set(
            url,
            {

                type:
                    'video',

                url,

                time:
                    Date.now()

            }
        );


        log(
            'Video captured:',
            url
        );


        renderPanel();

    }


    function addImage(url) {

        if (
            !isURL(url)
        ) {
            return;
        }


        if (
            state.images.has(url)
        ) {
            return;
        }


        state.images.set(
            url,
            {

                type:
                    'image',

                url,

                time:
                    Date.now()

            }
        );


        renderPanel();

    }


    /* ================================================================
       DOWNLOAD
    ================================================================ */

    function download(
        url,
        type = 'video'
    ) {

        if (
            !isURL(url)
        ) {

            toast(
                '没有找到有效下载地址'
            );

            return;

        }


        const ext =
            type === 'image'
                ? 'jpg'
                : 'mp4';


        const name =
            `doubao_${type}_${timestamp()}.${ext}`;


        log(
            'Downloading:',
            url
        );


        try {

            GM_download({

                url,

                name,

                saveAs:
                    false,

                onload() {

                    toast(
                        '下载已开始'
                    );

                },

                onerror(error) {

                    console.error(
                        TAG,
                        error
                    );


                    window.open(
                        url,
                        '_blank'
                    );

                }

            });

        }
        catch (error) {

            console.error(
                TAG,
                error
            );


            window.open(
                url,
                '_blank'
            );

        }

    }


    /* ================================================================
       GENERIC JSON WALKER
    ================================================================ */

    function walkJSON(
        value,
        callback,
        depth = 0,
        visited = new Set()
    ) {

        if (
            depth > 16 ||
            value == null
        ) {
            return;
        }


        if (
            typeof value ===
            'string'
        ) {

            callback(
                value,
                null,
                null
            );


            if (
                (
                    value.startsWith('{') ||
                    value.startsWith('[')
                ) &&
                value.length <
                    2000000
            ) {

                try {

                    const nested =
                        JSON.parse(value);

                    walkJSON(
                        nested,
                        callback,
                        depth + 1,
                        visited
                    );

                }
                catch (_) {}

            }


            return;

        }


        if (
            typeof value !==
            'object'
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

            for (
                const item of value
            ) {

                walkJSON(
                    item,
                    callback,
                    depth + 1,
                    visited
                );

            }

            return;

        }


        for (
            const [
                key,
                child
            ]
            of Object.entries(value)
        ) {

            callback(
                child,
                key,
                value
            );


            walkJSON(
                child,
                callback,
                depth + 1,
                visited
            );

        }

    }


    /* ================================================================
       RESPONSE PARSER
    ================================================================ */

    function inspectJSON(json) {

        if (
            !json ||
            typeof json !==
            'object'
        ) {
            return;
        }


        state.capturedResponses++;


        walkJSON(
            json,
            (
                value,
                key,
                parent
            ) => {


                /* ------------------------------
                   fallback_api
                ------------------------------ */

                if (
                    key ===
                    'fallback_api'
                ) {

                    if (
                        typeof value ===
                        'string'
                    ) {

                        state
                            .fallbackApis
                            .add(value);


                        resolveFallback(
                            value
                        );

                    }

                }


                /* ------------------------------
                   main_url
                ------------------------------ */

                if (
                    key ===
                    'main_url'
                ) {

                    if (
                        isURL(value)
                    ) {

                        /*
                         * Prefer URLs that look
                         * like video media.
                         */

                        if (
                            /video|tos|byte|doubao|mp4/i
                                .test(value)
                        ) {

                            addVideo(
                                value
                            );

                        }

                    }

                }


                /* ------------------------------
                   image_ori_raw
                ------------------------------ */

                if (
                    key ===
                    'image_ori_raw'
                ) {

                    if (
                        value &&
                        typeof value ===
                        'object' &&
                        isURL(value.url)
                    ) {

                        addImage(
                            value.url
                        );

                    }

                }


                /* ------------------------------
                   original_media_info
                ------------------------------ */

                if (
                    key ===
                    'original_media_info'
                ) {

                    if (
                        value &&
                        typeof value ===
                        'object'
                    ) {

                        const url =
                            value.main_url;

                        if (
                            isURL(url)
                        ) {

                            addVideo(
                                url
                            );

                        }

                    }

                }

            }
        );

    }


    /* ================================================================
       FALLBACK API
    ================================================================ */

    function resolveFallback(
        fallbackURL
    ) {

        if (
            !isURL(fallbackURL)
        ) {
            return;
        }


        let url;


        try {

            url =
                new URL(
                    fallbackURL
                );

        }
        catch (_) {

            return;

        }


        /*
         * Request original media variant.
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


        GM_xmlhttpRequest({

            method:
                'GET',

            url:
                url.toString(),

            headers: {

                Accept:
                    'application/json,text/plain,*/*'

            },

            timeout:
                30000,


            onload(response) {

                try {

                    const json =
                        JSON.parse(
                            response.responseText
                        );


                    inspectJSON(
                        json
                    );

                }
                catch (error) {

                    log(
                        'fallback response parse failed',
                        error
                    );

                }

            },


            onerror(error) {

                log(
                    'fallback request failed',
                    error
                );

            }

        });

    }


    /* ================================================================
       FETCH HOOK
    ================================================================ */

    function installFetchHook() {

        const target =

            typeof unsafeWindow !==
            'undefined'

                ? unsafeWindow

                : window;


        if (
            !target.fetch
        ) {
            return;
        }


        if (
            target.fetch.__doubaoDownloader
        ) {
            return;
        }


        const originalFetch =
            target.fetch;


        const hooked =
            async function () {

                const response =
                    await originalFetch
                        .apply(
                            this,
                            arguments
                        );


                try {

                    const clone =
                        response.clone();


                    clone
                        .text()
                        .then(text => {

                            inspectText(
                                text
                            );

                        })
                        .catch(
                            () => {}
                        );

                }
                catch (_) {}


                return response;

            };


        hooked.__doubaoDownloader =
            true;


        try {

            target.fetch =
                hooked;

            log(
                'fetch hook installed'
            );

        }
        catch (error) {

            log(
                'fetch hook failed',
                error
            );

        }

    }


    /* ================================================================
       XHR HOOK
    ================================================================ */

    function installXHRHook() {

        const target =

            typeof unsafeWindow !==
            'undefined'

                ? unsafeWindow

                : window;


        const XHR =
            target.XMLHttpRequest;


        if (
            !XHR ||
            XHR.prototype
                .__doubaoDownloader
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

                        }
                        catch (_) {}

                    }
                );


                return originalOpen
                    .apply(
                        this,
                        arguments
                    );

            };


        XHR.prototype
            .__doubaoDownloader =
            true;


        log(
            'XHR hook installed'
        );

    }


    /* ================================================================
       TEXT RESPONSE
    ================================================================ */

    function inspectText(text) {

        if (
            !text ||
            typeof text !==
            'string'
        ) {
            return;
        }


        if (
            text.length < 2
        ) {
            return;
        }


        /*
         * Avoid trying JSON.parse
         * on ordinary HTML/text.
         */

        const first =
            text.trim()[0];


        if (
            first !== '{' &&
            first !== '['
        ) {
            return;
        }


        try {

            const json =
                JSON.parse(text);

            inspectJSON(
                json
            );

        }
        catch (_) {}

    }


    /* ================================================================
       FIND VIDEO CARDS
    ================================================================ */

    function findVideoCards() {

        const cards =
            new Set();


        /*
         * Strategy A:
         * actual <video>
         */

        document
            .querySelectorAll(
                'video'
            )
            .forEach(video => {

                const rect =
                    video.getBoundingClientRect();


                if (
                    rect.width < 120 ||
                    rect.height < 120
                ) {
                    return;
                }


                const card =
                    findCardContainer(
                        video
                    );


                if (card) {

                    cards.add(
                        card
                    );

                }

            });


        /*
         * Strategy B:
         *
         * Doubao currently shows
         * generated video as poster/
         * preview card in some states.
         *
         * Locate native download icons
         * near image-like media cards.
         */

        const candidates =
            document.querySelectorAll(
                'button, [role="button"], svg'
            );


        candidates.forEach(
            node => {

                const rect =
                    node.getBoundingClientRect();


                if (
                    rect.width <= 0 ||
                    rect.height <= 0
                ) {
                    return;
                }


                /*
                 * Native download control
                 * is usually inside a
                 * reasonably sized media
                 * container.
                 */

                let parent =
                    node.parentElement;


                for (
                    let i = 0;
                    parent &&
                    i < 6;
                    i++
                ) {

                    const r =
                        parent
                            .getBoundingClientRect();


                    if (
                        r.width >= 180 &&
                        r.width <= 650 &&
                        r.height >= 250 &&
                        r.height <= 900
                    ) {

                        const hasMedia =

                            parent.querySelector(
                                'video'
                            ) ||

                            parent.querySelector(
                                'img'
                            );


                        if (
                            hasMedia
                        ) {

                            /*
                             * Media cards tend
                             * to have near-portrait
                             * dimensions.
                             */

                            const ratio =
                                r.height /
                                r.width;


                            if (
                                ratio > 1.05
                            ) {

                                cards.add(
                                    parent
                                );

                                break;

                            }

                        }

                    }


                    parent =
                        parent.parentElement;

                }

            });


        return [
            ...cards
        ];

    }


    function findCardContainer(
        element
    ) {

        let node =
            element;


        let best =
            null;


        for (
            let i = 0;
            node &&
            i < 8;
            i++
        ) {

            const rect =
                node.getBoundingClientRect();


            if (
                rect.width >= 180 &&
                rect.width <= 700 &&
                rect.height >= 220 &&
                rect.height <= 1000
            ) {

                best =
                    node;

            }


            node =
                node.parentElement;

        }


        return best;

    }


    /* ================================================================
       INJECT BUTTONS
    ================================================================ */

    function decorateCards() {

        const cards =
            findVideoCards();


        cards.forEach(
            card => {


                if (
                    card.querySelector(
                        ':scope > .doubao-unwatermark-button'
                    )
                ) {
                    return;
                }


                const style =
                    getComputedStyle(
                        card
                    );


                if (
                    style.position ===
                    'static'
                ) {

                    card.style
                        .position =
                        'relative';

                }


                const button =
                    document.createElement(
                        'button'
                    );


                button.className =
                    'doubao-unwatermark-button';


                button.innerHTML = `

<span class="icon">
    ↓
</span>

<span>
    无水印下载
</span>

                `;


                button.addEventListener(
                    'click',
                    event => {

                        event.preventDefault();

                        event.stopPropagation();


                        handleCardDownload(
                            card,
                            button
                        );

                    },
                    true
                );


                card.appendChild(
                    button
                );

            });

    }


    /* ================================================================
       CARD DOWNLOAD
    ================================================================ */

    async function handleCardDownload(
        card,
        button
    ) {

        const originalHTML =
            button.innerHTML;


        button.innerHTML =
            '<span>解析中...</span>';


        try {

            /*
             * First try current video src.
             */

            const video =
                card.querySelector(
                    'video'
                );


            /*
             * Prefer captured original
             * media URL.
             */

            let url =
                state.lastVideoURL;


            /*
             * If only one original video
             * has been captured, mapping
             * is unambiguous.
             */

            if (
                state.videos.size === 1
            ) {

                url =
                    Array.from(
                        state.videos.keys()
                    )[0];

            }


            /*
             * Fallback to video source
             * only when no original URL
             * has been captured yet.
             */

            if (
                !url &&
                video
            ) {

                url =

                    video.currentSrc ||

                    video.src;

            }


            if (
                !url
            ) {

                throw new Error(
                    '暂未捕获到视频地址，请重新生成一个视频后再试'
                );

            }


            download(
                url,
                'video'
            );


            button.innerHTML =
                '<span>✓ 已开始下载</span>';


            setTimeout(
                () => {

                    button.innerHTML =
                        originalHTML;

                },
                1600
            );

        }
        catch (error) {

            console.error(
                TAG,
                error
            );


            toast(
                error.message ||
                '视频解析失败'
            );


            button.innerHTML =
                '<span>! 暂未解析</span>';


            setTimeout(
                () => {

                    button.innerHTML =
                        originalHTML;

                },
                1800
            );

        }

    }


    /* ================================================================
       OBSERVER
    ================================================================ */

    let decorateTimer =
        null;


    function scheduleDecorate() {

        clearTimeout(
            decorateTimer
        );


        decorateTimer =
            setTimeout(
                decorateCards,
                200
            );

    }


    function installObserver() {

        const observer =
            new MutationObserver(
                () => {

                    scheduleDecorate();

                }
            );


        observer.observe(
            document.documentElement,
            {

                childList:
                    true,

                subtree:
                    true

            }
        );


        /*
         * Additional repair loop for
         * React/Vue rerenders.
         */

        setInterval(
            decorateCards,
            2000
        );

    }


    /* ================================================================
       DOM BOOT
    ================================================================ */

    function bootDOM() {

        log(
            'DOM ready'
        );


        installStyle();

        createUI();

        decorateCards();

        installObserver();

    }


    /* ================================================================
       START
    ================================================================ */

    installFetchHook();

    installXHRHook();


    /*
     * Some SPA frameworks replace
     * fetch/XHR during startup.
     */

    let repairCount =
        0;


    const hookRepair =
        setInterval(
            () => {

                installFetchHook();

                installXHRHook();


                repairCount++;


                if (
                    repairCount >= 20
                ) {

                    clearInterval(
                        hookRepair
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
                once:
                    true
            }
        );

    }
    else {

        bootDOM();

    }

})();
