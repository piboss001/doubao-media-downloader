// ==UserScript==
// @name         Doubao Media Downloader
// @namespace    https://github.com/piboss001/doubao-media-downloader
// @version      1.1.0
// @description  豆包生成视频无水印下载：从 chain/single 的 fallback_api 解析并解码原始视频地址。
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

(() => {
  'use strict';

  const VERSION = '1.1.0';
  const TAG = '[DoubaoDL]';
  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const CHAIN_RE =
    /^(?:https?:\/\/[^/]*doubao\.com)?\/im\/chain\/single(?:[/?#]|$)/i;

  const QAAB_SALT_HEX =
    '4dd4c2e6b83162090e52b3c7a6733ba4' +
    '1cb2462b829ab58a196b39db57177524' +
    'f49baf7f08e8d68d26a72e37c1a95a2f' +
    '1f05a51892aef2949732b62a38aadd58';

  const state = {
    resources: new Map(),
    fallbackCache: new Map(),
    cardBindings: new WeakMap(),

    batchSeq: 0,

    panelOpen: false,

    status: '等待生成视频…',

    decorateTimer: 0
  };

  const log = (...a) =>
    console.log(TAG, ...a);

  const warn = (...a) =>
    console.warn(TAG, ...a);

  const isHttp = v =>
    typeof v === 'string' &&
    /^https?:\/\//i.test(v);


  /* =========================================================
     网络监听
  ========================================================= */

  function inputUrl(input) {
    try {
      if (typeof input === 'string') {
        return input;
      }

      if (input?.url) {
        return String(input.url);
      }

      if (input?.href) {
        return String(input.href);
      }
    }
    catch (_) {}

    return '';
  }


  function installFetchHook() {
    const current =
      PAGE.fetch;

    if (
      typeof current !== 'function' ||
      current.__doubaoDL110
    ) {
      return;
    }

    const original =
      current;


    async function hooked(input, init) {
      const response =
        await original.apply(
          this,
          arguments
        );

      try {
        const url =
          inputUrl(input);

        if (CHAIN_RE.test(url)) {
          response
            .clone()
            .text()
            .then(
              body =>
                processChain(
                  body,
                  url
                )
            )
            .catch(
              () => {}
            );
        }
      }
      catch (_) {}

      return response;
    }


    Object.defineProperty(
      hooked,
      '__doubaoDL110',
      {
        value: true
      }
    );


    try {
      PAGE.fetch =
        hooked;
    }
    catch (e) {
      warn(
        'fetch hook failed',
        e
      );
    }
  }


  function installXHRHook() {
    const XHR =
      PAGE.XMLHttpRequest;

    if (
      !XHR ||
      XHR.prototype.__doubaoDL110
    ) {
      return;
    }


    const open =
      XHR.prototype.open;


    XHR.prototype.open =
      function (
        method,
        url
      ) {

        this.__doubaoDLUrl =
          String(
            url || ''
          );


        this.addEventListener(
          'load',
          () => {

            try {
              if (
                !CHAIN_RE.test(
                  this.__doubaoDLUrl
                )
              ) {
                return;
              }


              if (
                this.responseType &&
                this.responseType !== '' &&
                this.responseType !== 'text'
              ) {
                return;
              }


              processChain(
                this.responseText || '',
                this.__doubaoDLUrl
              );
            }
            catch (_) {}

          }
        );


        return open.apply(
          this,
          arguments
        );
      };


    Object.defineProperty(
      XHR.prototype,
      '__doubaoDL110',
      {
        value: true
      }
    );
  }


  /* =========================================================
     chain/single
  ========================================================= */

  async function processChain(
    raw,
    requestURL
  ) {

    if (!raw) {
      return;
    }


    let json;


    try {
      json =
        JSON.parse(raw);
    }
    catch (_) {
      return;
    }


    const apis =
      collectFallbackApis(
        json,
        raw
      );


    if (!apis.length) {
      return;
    }


    const batchId =
      ++state.batchSeq;

    const batchStartedAt =
      Date.now();


    state.status =
      `发现 ${apis.length} 个视频资源，正在解析…`;


    renderPanel();


    const found = [];


    for (
      const fallbackApi
      of apis
    ) {

      const url =
        await resolveFallback(
          fallbackApi
        );


      if (!url) {
        continue;
      }


      let item =
        state.resources.get(
          url
        );


      if (!item) {
        item = {
          url,

          createdAt:
            Date.now(),

          batchId,

          batchStartedAt,

          fallbackApi,

          requestURL,

          assignedVideo:
            null
        };


        state.resources.set(
          url,
          item
        );
      }


      found.push(
        item
      );
    }


    if (
      found.length
    ) {

      state.status =
        `已解析 ${found.length} 个无水印视频`;


      bindResourcesToCards();

      renderPanel();


      toast(
        `已解析 ${found.length} 个无水印视频`
      );

    }
    else {

      state.status =
        '已捕获生成接口，但无水印地址解码失败';


      renderPanel();


      toast(
        state.status
      );

    }
  }


  /* =========================================================
     找 fallback_api
  ========================================================= */

  function collectFallbackApis(
    json,
    raw
  ) {

    const set =
      new Set();


    walk(
      json,
      node => {

        if (
          node &&
          typeof node === 'object' &&
          !Array.isArray(node) &&
          Object.prototype
            .hasOwnProperty
            .call(
              node,
              'fallback_api'
            )
        ) {

          addFallback(
            set,
            node.fallback_api
          );

        }
      }
    );


    for (
      const re
      of [
        /fallback_api\\":\\"(.*?)\\"/g,

        /"fallback_api"\s*:\s*"([^"]+)"/g
      ]
    ) {

      let m;


      while (
        (
          m =
            re.exec(raw)
        )
      ) {

        addFallback(
          set,
          m[1]
        );

      }
    }


    return [
      ...set
    ];
  }


  function addFallback(
    set,
    value
  ) {

    if (
      typeof value !== 'string' ||
      !value
    ) {
      return;
    }


    const url =
      decodeEscaped(
        value
      );


    if (
      isHttp(url)
    ) {
      set.add(url);
    }
  }


  function decodeEscaped(
    value
  ) {

    let text =
      String(
        value || ''
      );


    for (
      let i = 0;
      i < 3;
      i++
    ) {

      try {

        const next =
          JSON.parse(
            `"${text.replace(
              /"/g,
              '\\"'
            )}"`
          );


        if (
          next === text
        ) {
          break;
        }


        text =
          next;

      }
      catch (_) {
        break;
      }
    }


    return text
      .replace(
        /\\u0026/gi,
        '&'
      )
      .replace(
        /\\\//g,
        '/'
      )
      .replace(
        /\\"/g,
        '"'
      );
  }


  function walk(
    value,
    visitor,
    seen = new Set(),
    depth = 0
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

      const s =
        value.trim();


      if (
        s.length <
          2000000 &&
        (
          s.startsWith('{') ||
          s.startsWith('[')
        )
      ) {

        try {
          walk(
            JSON.parse(s),
            visitor,
            seen,
            depth + 1
          );
        }
        catch (_) {}

      }


      return;
    }


    if (
      typeof value !== 'object' ||
      seen.has(value)
    ) {
      return;
    }


    seen.add(value);


    visitor(value);


    if (
      Array.isArray(value)
    ) {

      for (
        const x
        of value
      ) {
        walk(
          x,
          visitor,
          seen,
          depth + 1
        );
      }

    }
    else {

      for (
        const x
        of Object.values(value)
      ) {

        walk(
          x,
          visitor,
          seen,
          depth + 1
        );

      }
    }
  }


  /* =========================================================
     请求 fallback_api
  ========================================================= */

  function gmGet(url) {

    return new Promise(
      (
        resolve,
        reject
      ) => {

        GM_xmlhttpRequest({

          method:
            'GET',

          url,

          headers: {
            Accept:
              'application/json,text/plain,*/*'
          },

          anonymous:
            true,

          responseType:
            'text',

          timeout:
            30000,


          onload:
            r =>
              resolve(
                r.responseText || ''
              ),


          onerror:
            reject,


          ontimeout:
            () =>
              reject(
                new Error(
                  'timeout'
                )
              )

        });

      }
    );
  }


  function resolveFallback(
    fallbackApi
  ) {

    if (
      state.fallbackCache.has(
        fallbackApi
      )
    ) {

      return state
        .fallbackCache
        .get(
          fallbackApi
        );

    }


    const task =
      (
        async () => {

          try {

            const u =
              new URL(
                fallbackApi
              );


            u.searchParams.set(
              'channel',
              'no'
            );


            u.searchParams.set(
              'codec_type',
              '8'
            );


            u.searchParams.set(
              'logo_type',
              'unwatermarked'
            );


            const payload =
              JSON.parse(
                await gmGet(
                  u.toString()
                )
              );


            const data =
              videoData(
                payload
              );


            const token =
              bestToken(
                data
              );


            if (!token) {
              return '';
            }


            const finalURL =
              await decodeToken(
                token,
                findKeySeed(
                  payload
                )
              );


            if (
              !isHttp(
                finalURL
              )
            ) {
              return '';
            }


            if (
              /\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/i
                .test(
                  finalURL
                )
            ) {

              return '';
            }


            return finalURL;

          }
          catch (e) {

            warn(
              'fallback resolve failed',
              e
            );


            return '';

          }

        }
      )();


    state.fallbackCache.set(
      fallbackApi,
      task
    );


    return task;
  }


  /* =========================================================
     fallback 视频数据
  ========================================================= */

  function videoData(
    payload
  ) {

    const info =
      payload?.video_info ||
      payload?.data?.video_info ||
      payload;


    const data =
      info?.data ||
      info;


    return (
      data &&
      typeof data === 'object'
    )
      ? data
      : {};
  }


  function bestToken(
    data
  ) {

    const list =
      data?.video_list;


    const entries =
      list &&
      typeof list === 'object' &&
      Object.keys(list).length

        ? Object.values(
            list
          )

        : [
            data
          ];


    let best =
      null;


    for (
      const entry
      of entries
    ) {

      if (
        !entry ||
        typeof entry !== 'object'
      ) {
        continue;
      }


      const token =
        entry.main_url ||
        entry.play_url ||
        '';


      if (
        typeof token !== 'string' ||
        !token.trim()
      ) {
        continue;
      }


      const score =
        Number(
          entry.bitrate ||
          entry.real_bitrate ||
          0
        )
        +
        Number(
          entry.vwidth ||
          entry.width ||
          0
        )
        *
        Number(
          entry.vheight ||
          entry.height ||
          0
        );


      if (
        !best ||
        score > best.score
      ) {

        best = {
          token:
            token.trim(),

          score
        };

      }
    }


    return best?.token || '';
  }


  /* =========================================================
     key_seed
  ========================================================= */

  function findKeySeed(
    value,
    depth = 0
  ) {

    if (
      value == null ||
      depth > 10
    ) {
      return '';
    }


    if (
      typeof value === 'string'
    ) {

      let m =
        value.match(
          /(?:^|[?&])key_seed=([^&"'<>\\\s]+)/i
        );


      if (m) {
        return safeDecode(
          m[1]
        );
      }


      m =
        value.match(
          /["']key_seed["']\s*:\s*["']([^"']+)/i
        );


      return m
        ? safeDecode(
            m[1]
          )
        : '';
    }


    if (
      typeof value !== 'object'
    ) {
      return '';
    }


    if (
      typeof value.key_seed === 'string' &&
      value.key_seed.trim()
    ) {

      return value
        .key_seed
        .trim();

    }


    for (
      const x
      of Object.values(value)
    ) {

      const hit =
        findKeySeed(
          x,
          depth + 1
        );


      if (hit) {
        return hit;
      }
    }


    return '';
  }


  function safeDecode(s) {
    try {
      return decodeURIComponent(
        s
      );
    }
    catch (_) {
      return s;
    }
  }


  /* =========================================================
     main_url 解码
  ========================================================= */

  async function decodeToken(
    token,
    keySeed = ''
  ) {

    if (
      isHttp(token)
    ) {
      return token;
    }


    const plain =
      tryBase64Url(
        token
      );


    if (plain) {
      return plain;
    }


    if (
      String(token)
        .startsWith(
          'qAAB'
        ) &&
      keySeed
    ) {

      return decodeQaab(
        token,
        keySeed
      );

    }


    return '';
  }


  function tryBase64Url(
    token
  ) {

    const bytes =
      base64Loose(
        token
      );


    if (!bytes) {
      return '';
    }


    const text =
      ascii(
        bytes
      );


    return isHttp(text)
      ? text
      : '';
  }


  function base64Loose(
    value
  ) {

    const input =
      String(
        value || ''
      ).trim();


    const variants = [

      input,

      input.replace(
        /[$@#]/g,
        c => ({
          '$': '_',
          '@': '/',
          '#': '.'
        })[c]
      ),

      input.replace(
        /[$@#]/g,
        c => ({
          '$': '+',
          '@': '/',
          '#': '='
        })[c]
      )

    ];


    const seen =
      new Set();


    for (
      let s
      of variants
    ) {

      if (
        !s ||
        seen.has(s)
      ) {
        continue;
      }


      seen.add(s);


      try {

        s =
          s
            .replace(
              /-/g,
              '+'
            )
            .replace(
              /_/g,
              '/'
            );


        s +=
          '='.repeat(
            (
              4 -
              s.length % 4
            )
            % 4
          );


        const b =
          atob(s);


        const out =
          new Uint8Array(
            b.length
          );


        for (
          let i = 0;
          i < b.length;
          i++
        ) {

          out[i] =
            b.charCodeAt(i);

        }


        return out;

      }
      catch (_) {}

    }


    return null;
  }


  function ascii(
    bytes
  ) {

    if (
      !bytes?.length
    ) {
      return '';
    }


    for (
      const b
      of bytes
    ) {

      if (
        b !== 9 &&
        b !== 10 &&
        b !== 13 &&
        (
          b < 32 ||
          b > 126
        )
      ) {

        return '';

      }
    }


    return new TextDecoder()
      .decode(
        bytes
      );
  }


  /* =========================================================
     qAAB AES
  ========================================================= */

  async function decodeQaab(
    token,
    keySeed
  ) {

    const data =
      base64Loose(
        token
      );


    const seed =
      base64Loose(
        keySeed
      );


    if (
      !data ||
      !seed
    ) {
      return '';
    }


    const h1 =
      await crypto.subtle.digest(
        'SHA-512',
        seed.slice(
          0,
          32
        )
      );


    const h2 =
      new Uint8Array(

        await crypto.subtle.digest(

          'SHA-512',

          concat(

            new Uint8Array(
              h1
            ),

            hexBytes(
              QAAB_SALT_HEX
            )

          )

        )

      );


    const key =
      h2.slice(
        0,
        16
      );


    const iv =
      h2.slice(
        16,
        32
      );


    const tries =
      [];


    if (
      data.length >= 4 &&
      data[0] === 0xa8 &&
      data[1] === 0 &&
      data[2] === 1 &&
      data[3] === 0
    ) {

      tries.push(

        [
          data.slice(4),
          key,
          iv
        ],

        [
          data.slice(4),
          iv,
          key
        ]

      );


      if (
        data.length > 36
      ) {

        tries.push(

          [
            data.slice(36),
            key,
            data.slice(
              20,
              36
            )
          ],

          [
            data.slice(36),
            key,
            iv
          ]

        );

      }

    }
    else {

      tries.push(
        [
          data,
          key,
          iv
        ]
      );

    }


    for (
      const [
        payload,
        k,
        v
      ]
      of tries
    ) {

      const url =
        await aesUrl(
          payload,
          k,
          v
        );


      if (url) {
        return url;
      }
    }


    return '';
  }


  async function aesUrl(
    payload,
    keyBytes,
    ivBytes
  ) {

    if (
      !payload.length ||
      payload.length % 16
    ) {
      return '';
    }


    try {

      const key =
        await crypto.subtle.importKey(

          'raw',

          keyBytes,

          'AES-CBC',

          false,

          [
            'decrypt'
          ]

        );


      const plain =
        new Uint8Array(

          await crypto.subtle.decrypt(

            {
              name:
                'AES-CBC',

              iv:
                ivBytes
            },

            key,

            payload

          )

        );


      const direct =
        ascii(
          plain
        );


      if (
        isHttp(
          direct
        )
      ) {
        return direct;
      }


      const stripped =
        unpad(
          plain
        );


      const text =
        ascii(
          stripped
        );


      return isHttp(text)
        ? text
        : '';

    }
    catch (_) {

      return '';

    }
  }


  function unpad(
    bytes
  ) {

    if (
      !bytes?.length
    ) {
      return new Uint8Array();
    }


    const p =
      bytes[
        bytes.length - 1
      ];


    if (
      p < 1 ||
      p > 16 ||
      p > bytes.length
    ) {
      return bytes;
    }


    for (
      let i =
        bytes.length - p;

      i < bytes.length;

      i++
    ) {

      if (
        bytes[i] !== p
      ) {
        return bytes;
      }

    }


    return bytes.slice(
      0,
      bytes.length - p
    );
  }


  function hexBytes(
    hex
  ) {

    const out =
      new Uint8Array(
        hex.length / 2
      );


    for (
      let i = 0;
      i < out.length;
      i++
    ) {

      out[i] =
        parseInt(
          hex.slice(
            i * 2,
            i * 2 + 2
          ),
          16
        );

    }


    return out;
  }


  function concat(
    a,
    b
  ) {

    const out =
      new Uint8Array(
        a.length +
        b.length
      );


    out.set(a);

    out.set(
      b,
      a.length
    );


    return out;
  }


  /* =========================================================
     视频卡片
  ========================================================= */

  function visibleVideos() {

    return [
      ...document
        .querySelectorAll(
          'video'
        )
    ]
      .filter(
        v => {

          const r =
            v.getBoundingClientRect();


          return (
            r.width >= 160 &&
            r.height >= 180 &&
            r.width <= 900 &&
            r.height <= 1300
          );

        }
      );
  }


  function videoContainer(
    video
  ) {

    const vr =
      video
        .getBoundingClientRect();


    let node =
      video.parentElement;


    let best =
      node || video;


    for (
      let i = 0;

      node &&
      i < 6;

      i++,
      node =
        node.parentElement
    ) {

      const r =
        node
          .getBoundingClientRect();


      if (
        !r.width ||
        !r.height
      ) {
        continue;
      }


      if (
        r.width >= vr.width &&
        r.height >= vr.height &&
        r.width / vr.width <= 1.4 &&
        r.height / vr.height <= 1.4
      ) {

        best =
          node;

      }
      else {

        break;

      }
    }


    return best;
  }


  function bind(
    video,
    item
  ) {

    state.cardBindings.set(
      video,
      item
    );


    item.assignedVideo =
      video;
  }


  function bindResourcesToCards() {

    const videos =
      visibleVideos();


    const items =
      [
        ...state
          .resources
          .values()
      ]
        .sort(
          (
            a,
            b
          ) =>
            a.createdAt -
            b.createdAt
        );


    for (
      const item
      of items
    ) {

      if (
        item.assignedVideo &&
        !document.contains(
          item.assignedVideo
        )
      ) {

        item.assignedVideo =
          null;

      }
    }


    const unbound =
      videos.filter(
        v =>
          !state
            .cardBindings
            .has(v)
      );


    const free =
      items.filter(
        x =>
          !x.assignedVideo
      );


    if (
      unbound.length &&
      unbound.length === free.length
    ) {

      unbound.forEach(
        (
          v,
          i
        ) =>
          bind(
            v,
            free[i]
          )
      );

    }
    else if (
      unbound.length === 1 &&
      free.length === 1
    ) {

      bind(
        unbound[0],
        free[0]
      );

    }
    else if (
      free.length === 1 &&
      unbound.length > 1
    ) {

      const nearby =
        unbound.filter(
          v =>
            Math.abs(
              (
                v.__doubaoDLSeenAt ||
                0
              )
              -
              free[0]
                .batchStartedAt
            )
            <=
            12000
        );


      if (
        nearby.length === 1
      ) {

        bind(
          nearby[0],
          free[0]
        );

      }
    }


    updateButtons();
  }


  /* =========================================================
     样式
  ========================================================= */

  function installStyle() {

    if (
      document.getElementById(
        'doubao-dl-style'
      )
    ) {
      return;
    }


    const s =
      document.createElement(
        'style'
      );


    s.id =
      'doubao-dl-style';


    s.textContent = `

.doubao-dl-card{
position:absolute!important;
left:10px!important;
top:10px!important;
z-index:2147483000!important;
height:34px!important;
padding:0 11px!important;
border:1px solid rgba(255,255,255,.2)!important;
border-radius:8px!important;
background:rgba(16,16,18,.86)!important;
color:#fff!important;
cursor:pointer!important;
font:500 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif!important;
box-shadow:0 3px 12px rgba(0,0,0,.24)!important;
backdrop-filter:blur(8px)!important;
}

.doubao-dl-card:hover{
background:#000!important;
}

.doubao-dl-card[data-ready="0"]{
opacity:.72!important;
}


#doubao-dl-fab{
position:fixed!important;
right:20px!important;
bottom:96px!important;
z-index:2147483645!important;
width:48px!important;
height:48px!important;
border:0!important;
border-radius:14px!important;
background:#18181b!important;
color:#fff!important;
cursor:pointer!important;
font-size:20px!important;
box-shadow:0 8px 30px rgba(0,0,0,.24)!important;
}


#doubao-dl-badge{
position:absolute;
right:-5px;
top:-5px;
min-width:18px;
height:18px;
padding:0 4px;
border-radius:9px;
background:#fff;
color:#111;
display:flex;
align-items:center;
justify-content:center;
font:600 10px/1 sans-serif;
}


#doubao-dl-panel{
position:fixed!important;
right:20px!important;
bottom:154px!important;
z-index:2147483646!important;
width:360px!important;
max-height:460px!important;
background:#fff!important;
color:#18181b!important;
border:1px solid #eee!important;
border-radius:16px!important;
box-shadow:0 16px 50px rgba(0,0,0,.18)!important;
overflow:hidden!important;
font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif!important;
}


#doubao-dl-panel[hidden]{
display:none!important;
}


.ddl-head{
padding:14px 15px;
border-bottom:1px solid #eee;
display:flex;
justify-content:space-between;
gap:12px;
}


.ddl-title{
font-weight:650;
}


.ddl-status{
font-size:11px;
color:#888;
text-align:right;
}


.ddl-list{
max-height:320px;
overflow:auto;
padding:8px;
}


.ddl-empty{
padding:30px 12px;
text-align:center;
color:#999;
font-size:13px;
line-height:1.8;
}


.ddl-item{
display:flex;
align-items:center;
gap:8px;
padding:9px;
border-radius:9px;
}


.ddl-item:hover{
background:#f6f6f7;
}


.ddl-info{
flex:1;
min-width:0;
}


.ddl-name{
font-size:12px;
font-weight:550;
}


.ddl-url{
font-size:10px;
color:#999;
white-space:nowrap;
overflow:hidden;
text-overflow:ellipsis;
}


.ddl-down{
border:0;
border-radius:7px;
background:#18181b;
color:#fff;
padding:7px 10px;
cursor:pointer;
}


.ddl-foot{
padding:11px 13px;
border-top:1px solid #eee;
font-size:11px;
color:#888;
}


#doubao-dl-toast{
position:fixed;
left:50%;
bottom:78px;
transform:translateX(-50%);
z-index:2147483647;
background:rgba(0,0,0,.82);
color:#fff;
padding:9px 15px;
border-radius:9px;
font:13px/1.4 sans-serif;
pointer-events:none;
}

`;


    (
      document.head ||
      document.documentElement
    ).appendChild(s);
  }


  /* =========================================================
     右侧窗口
  ========================================================= */

  function createUI() {

    if (
      document.getElementById(
        'doubao-dl-fab'
      )
    ) {
      return;
    }


    const fab =
      document.createElement(
        'button'
      );


    fab.id =
      'doubao-dl-fab';


    fab.type =
      'button';


    fab.innerHTML =
      '↓<span id="doubao-dl-badge">0</span>';


    const panel =
      document.createElement(
        'div'
      );


    panel.id =
      'doubao-dl-panel';


    panel.hidden =
      true;


    panel.innerHTML = `

<div class="ddl-head">

<div class="ddl-title">
豆包资源助手
<small>v${VERSION}</small>
</div>

<div
class="ddl-status"
id="ddl-status">
</div>

</div>

<div
class="ddl-list"
id="ddl-list">
</div>

<div class="ddl-foot">
只接受 chain/single → fallback_api → 解码后的无水印视频地址
</div>

`;


    fab.onclick =
      () => {

        state.panelOpen =
          !state.panelOpen;


        panel.hidden =
          !state.panelOpen;

      };


    document
      .documentElement
      .append(
        fab,
        panel
      );


    renderPanel();
  }


  function renderPanel() {

    const badge =
      document.getElementById(
        'doubao-dl-badge'
      );


    const status =
      document.getElementById(
        'ddl-status'
      );


    const list =
      document.getElementById(
        'ddl-list'
      );


    if (
      !badge ||
      !status ||
      !list
    ) {
      return;
    }


    const items =
      [
        ...state
          .resources
          .values()
      ]
        .sort(
          (
            a,
            b
          ) =>
            b.createdAt -
            a.createdAt
        );


    badge.textContent =
      String(
        items.length
      );


    status.textContent =
      state.status;


    list.textContent =
      '';


    if (
      !items.length
    ) {

      const e =
        document.createElement(
          'div'
        );


      e.className =
        'ddl-empty';


      e.innerHTML =
        '等待豆包生成视频…<br>解析成功后会出现在这里';


      list.appendChild(
        e
      );


      return;
    }


    items.forEach(
      (
        item,
        i
      ) => {

        const row =
          document.createElement(
            'div'
          );


        row.className =
          'ddl-item';


        const info =
          document.createElement(
            'div'
          );


        info.className =
          'ddl-info';


        const name =
          document.createElement(
            'div'
          );


        name.className =
          'ddl-name';


        name.textContent =
          `无水印视频 ${i + 1}`;


        const url =
          document.createElement(
            'div'
          );


        url.className =
          'ddl-url';


        url.textContent =
          item.url;


        url.title =
          item.url;


        info.append(
          name,
          url
        );


        const b =
          document.createElement(
            'button'
          );


        b.className =
          'ddl-down';


        b.textContent =
          '下载';


        b.onclick =
          () =>
            download(
              item
            );


        row.append(
          info,
          b
        );


        list.appendChild(
          row
        );

      }
    );
  }


  /* =========================================================
     卡片下载按钮
  ========================================================= */

  function decorateVideos() {

    for (
      const video
      of visibleVideos()
    ) {

      if (
        !video.__doubaoDLSeenAt
      ) {

        video.__doubaoDLSeenAt =
          Date.now();

      }


      if (
        video.__doubaoDLButton &&
        document.contains(
          video.__doubaoDLButton
        )
      ) {
        continue;
      }


      const box =
        videoContainer(
          video
        );


      if (!box) {
        continue;
      }


      const existing =
        [
          ...box.children
        ]
          .find(
            x =>
              x.classList
                ?.contains(
                  'doubao-dl-card'
                )
          );


      if (existing) {

        video.__doubaoDLButton =
          existing;


        continue;
      }


      if (
        getComputedStyle(
          box
        ).position ===
        'static'
      ) {

        box.style.position =
          'relative';

      }


      const b =
        document.createElement(
          'button'
        );


      b.className =
        'doubao-dl-card';


      b.type =
        'button';


      b.textContent =
        '↓ 无水印下载';


      b.dataset.ready =
        '0';


      b.addEventListener(

        'click',

        e => {

          e.preventDefault();

          e.stopPropagation();


          downloadForCard(
            video
          );

        },

        true

      );


      box.appendChild(
        b
      );


      video.__doubaoDLButton =
        b;

    }


    bindResourcesToCards();

    updateButtons();
  }


  function updateButtons() {

    for (
      const video
      of visibleVideos()
    ) {

      const b =
        video.__doubaoDLButton;


      if (
        !b ||
        !document.contains(b)
      ) {
        continue;
      }


      const ready =
        state
          .cardBindings
          .has(
            video
          );


      b.dataset.ready =
        ready
          ? '1'
          : '0';


      b.title =
        ready

          ? '下载这个视频的无水印版本'

          : '正在等待这个视频的无水印地址';

    }
  }


  function downloadForCard(
    video
  ) {

    bindResourcesToCards();


    let item =
      state
        .cardBindings
        .get(
          video
        );


    const items =
      [
        ...state
          .resources
          .values()
      ];


    const videos =
      visibleVideos();


    if (
      !item &&
      items.length === 1 &&
      videos.length === 1
    ) {

      item =
        items[0];


      bind(
        video,
        item
      );


      updateButtons();

    }


    if (item) {

      return download(
        item
      );

    }


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

      items.length

        ? '多个资源无法安全对应，请从右侧面板选择下载'

        : '尚未解析到无水印地址，请重新生成视频'

    );
  }


  /* =========================================================
     下载
  ========================================================= */

  function download(
    item
  ) {

    if (
      !item ||
      !state.resources.has(
        item.url
      )
    ) {

      return toast(
        '资源无效，已取消下载'
      );

    }


    GM_download({

      url:
        item.url,


      name:
        `doubao_unwatermarked_${stamp()}.mp4`,


      saveAs:
        false,


      onload:
        () =>
          toast(
            '无水印视频下载已开始'
          ),


      onerror:
        e => {

          warn(
            'download failed',
            e
          );


          toast(
            '下载失败，请重试'
          );

        }

    });
  }


  function stamp() {

    const d =
      new Date();


    const p =
      n =>
        String(n)
          .padStart(
            2,
            '0'
          );


    return (
      `${d.getFullYear()}` +
      `${p(d.getMonth() + 1)}` +
      `${p(d.getDate())}_` +
      `${p(d.getHours())}` +
      `${p(d.getMinutes())}` +
      `${p(d.getSeconds())}`
    );
  }


  /* =========================================================
     Toast
  ========================================================= */

  let toastTimer;


  function toast(
    text
  ) {

    let el =
      document.getElementById(
        'doubao-dl-toast'
      );


    if (!el) {

      el =
        document.createElement(
          'div'
        );


      el.id =
        'doubao-dl-toast';


      document
        .documentElement
        .appendChild(
          el
        );

    }


    el.textContent =
      text;


    clearTimeout(
      toastTimer
    );


    toastTimer =
      setTimeout(
        () =>
          el.remove(),
        2800
      );
  }


  /* =========================================================
     启动
  ========================================================= */

  function bootDOM() {

    installStyle();

    createUI();

    decorateVideos();


    new MutationObserver(
      () => {

        clearTimeout(
          state.decorateTimer
        );


        state.decorateTimer =
          setTimeout(
            decorateVideos,
            150
          );

      }
    )
      .observe(
        document.documentElement,
        {
          childList:
            true,

          subtree:
            true
        }
      );


    setInterval(
      decorateVideos,
      2200
    );


    toast(
      `Doubao Media Downloader v${VERSION} 已启动`
    );
  }


  installFetchHook();

  installXHRHook();


  setInterval(
    () => {

      installFetchHook();

      installXHRHook();

    },
    5000
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
