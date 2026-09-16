// ==UserScript==
// @name         Doubao Media Downloader
// @namespace    https://github.com/piboss001/doubao-media-downloader
// @version      1.2.0
// @description  豆包生成视频无水印下载：当前聊天资源隔离，多视频使用资源面板，单视频提供卡片快捷下载。
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

  const VERSION = '1.2.0';
  const TAG = '[DoubaoDL]';
  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const CHAIN_RE = /^(?:https?:\/\/[^/]*doubao\.com)?\/im\/chain\/single(?:[/?#]|$)/i;

  const QAAB_SALT_HEX =
    '4dd4c2e6b83162090e52b3c7a6733ba4' +
    '1cb2462b829ab58a196b39db57177524' +
    'f49baf7f08e8d68d26a72e37c1a95a2f' +
    '1f05a51892aef2949732b62a38aadd58';

  const state = {
    resources: new Map(),
    fallbackCache: new Map(),
    cardBindings: new WeakMap(),

    conversationEpoch: 0,

    mediaResponseSeq: 0,
    latestMediaSeq: 0,

    panelOpen: false,
    status: '等待生成视频…',

    decorateTimer: 0,

    currentHref: location.href
  };


  const log = (...args) => {
    console.log(TAG, ...args);
  };


  const warn = (...args) => {
    console.warn(TAG, ...args);
  };


  const isHttp = value => {
    return (
      typeof value === 'string' &&
      /^https?:\/\//i.test(value)
    );
  };


  /* ============================================================
     URL
  ============================================================ */

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


  /* ============================================================
     FETCH
  ============================================================ */

  function installFetchHook() {

    const current =
      PAGE.fetch;


    if (
      typeof current !== 'function' ||
      current.__doubaoDL120
    ) {
      return;
    }


    const original =
      current;


    async function hooked(input, init) {

      const url =
        inputUrl(input);


      const isChain =
        CHAIN_RE.test(url);


      /*
       * 记录这个请求属于哪个聊天。
       */
      const requestEpoch =
        state.conversationEpoch;


      const response =
        await original.apply(
          this,
          arguments
        );


      if (isChain) {

        try {

          response
            .clone()
            .text()
            .then(body => {

              processChain(
                body,
                url,
                requestEpoch
              );

            })
            .catch(() => {});

        }
        catch (_) {}

      }


      return response;
    }


    Object.defineProperty(
      hooked,
      '__doubaoDL120',
      {
        value: true
      }
    );


    try {

      PAGE.fetch =
        hooked;

    }
    catch (error) {

      warn(
        'fetch hook failed',
        error
      );

    }
  }


  /* ============================================================
     XHR
  ============================================================ */

  function installXHRHook() {

    const XHR =
      PAGE.XMLHttpRequest;


    if (
      !XHR ||
      XHR.prototype.__doubaoDL120
    ) {
      return;
    }


    const originalOpen =
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


        /*
         * 保存请求创建时所属聊天。
         */
        this.__doubaoDLEpoch =
          state.conversationEpoch;


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
                this.__doubaoDLUrl,
                this.__doubaoDLEpoch
              );

            }
            catch (_) {}

          }
        );


        return originalOpen.apply(
          this,
          arguments
        );
      };


    Object.defineProperty(
      XHR.prototype,
      '__doubaoDL120',
      {
        value: true
      }
    );
  }


  /* ============================================================
     CHAIN/SINGLE
  ============================================================ */

  async function processChain(
    raw,
    requestURL,
    requestEpoch
  ) {

    /*
     * 请求属于旧聊天：
     * 直接丢弃。
     */

    if (
      requestEpoch !==
        state.conversationEpoch ||
      !raw
    ) {
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


    /*
     * 非视频 chain/single
     * 不清空当前聊天资源。
     */

    if (
      !apis.length
    ) {
      return;
    }


    /*
     * 一个真正包含视频资源的响应
     * 获得独立序号。
     */

    const mediaSeq =
      ++state.mediaResponseSeq;


    state.latestMediaSeq =
      mediaSeq;


    replaceResources(

      [],

      `正在解析 ${apis.length} 个视频…`,

      requestEpoch,

      mediaSeq

    );


    /*
     * 并行解析所有视频。
     */

    const results =
      await Promise.all(

        apis.map(
          async fallbackApi => {

            const url =
              await resolveFallback(
                fallbackApi
              );


            if (!url) {
              return null;
            }


            return {

              url,

              createdAt:
                Date.now(),

              fallbackApi,

              requestURL,

              requestEpoch,

              mediaSeq

            };

          }
        )

      );


    /*
     * 两种情况禁止写回：
     *
     * 1. 已经换聊天
     * 2. 当前聊天又来了更新的视频响应
     */

    if (
      requestEpoch !==
        state.conversationEpoch ||
      mediaSeq !==
        state.latestMediaSeq
    ) {
      return;
    }


    const valid =
      results.filter(Boolean);


    replaceResources(

      valid,

      valid.length

        ? (
            `当前聊天：${valid.length} 个无水印视频` +
            (
              valid.length > 1
                ? '（请使用右侧面板）'
                : ''
            )
          )

        : '接口已捕获，但无水印地址解析失败',

      requestEpoch,

      mediaSeq

    );


    toast(

      valid.length

        ? `已解析 ${valid.length} 个无水印视频`

        : '接口已捕获，但无水印地址解析失败'

    );
  }


  /* ============================================================
     替换当前聊天资源
  ============================================================ */

  function replaceResources(
    items,
    status,
    requestEpoch,
    mediaSeq
  ) {

    if (
      requestEpoch !==
      state.conversationEpoch
    ) {
      return;
    }


    if (
      mediaSeq &&
      mediaSeq !==
        state.latestMediaSeq
    ) {
      return;
    }


    /*
     * 重点：
     * 当前聊天资源覆盖上一批，
     * 永远不累计。
     */

    state.resources.clear();


    state.cardBindings =
      new WeakMap();


    const seen =
      new Set();


    for (
      const item
      of items
    ) {

      if (
        !item ||
        !isHttp(item.url) ||
        seen.has(item.url)
      ) {
        continue;
      }


      seen.add(
        item.url
      );


      state.resources.set(
        item.url,
        item
      );

    }


    state.status =
      status;


    renderPanel();

    scheduleDecorate();
  }


  /* ============================================================
     FALLBACK API
  ============================================================ */

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


    const patterns = [

      /fallback_api\\":\\"(.*?)\\"/g,

      /"fallback_api"\s*:\s*"([^"]+)"/g

    ];


    for (
      const regex
      of patterns
    ) {

      let match;


      while (
        (
          match =
            regex.exec(raw)
        )
      ) {

        addFallback(
          set,
          match[1]
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

      set.add(
        url
      );

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


  /* ============================================================
     JSON WALK
  ============================================================ */

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
      typeof value ===
      'string'
    ) {

      const text =
        value.trim();


      if (
        text.length <
          2000000 &&
        (
          text.startsWith('{') ||
          text.startsWith('[')
        )
      ) {

        try {

          walk(
            JSON.parse(text),
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
      typeof value !==
        'object' ||
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
        const item
        of value
      ) {

        walk(
          item,
          visitor,
          seen,
          depth + 1
        );

      }

    }
    else {

      for (
        const child
        of Object.values(value)
      ) {

        walk(
          child,
          visitor,
          seen,
          depth + 1
        );

      }
    }
  }


  /* ============================================================
     HTTP
  ============================================================ */

  function gmGet(
    url
  ) {

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
            response => {

              resolve(
                response.responseText ||
                ''
              );

            },


          onerror:
            reject,


          ontimeout:
            () => {

              reject(
                new Error(
                  'timeout'
                )
              );

            }

        });

      }
    );
  }


  /* ============================================================
     RESOLVE
  ============================================================ */

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

            const url =
              new URL(
                fallbackApi
              );


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


            const payload =
              JSON.parse(

                await gmGet(
                  url.toString()
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


            if (
              !token
            ) {
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


            /*
             * 额外排除图片资源。
             */

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
          catch (error) {

            warn(
              'fallback resolve failed',
              error
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


  /* ============================================================
     VIDEO DATA
  ============================================================ */

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


  /* ============================================================
     KEY SEED
  ============================================================ */

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

      let match =
        value.match(
          /(?:^|[?&])key_seed=([^&"'<>\\\s]+)/i
        );


      if (
        match
      ) {

        return safeDecode(
          match[1]
        );

      }


      match =
        value.match(
          /["']key_seed["']\s*:\s*["']([^"']+)/i
        );


      return match

        ? safeDecode(
            match[1]
          )

        : '';
    }


    if (
      typeof value !==
      'object'
    ) {
      return '';
    }


    if (
      typeof value.key_seed ===
        'string' &&
      value.key_seed.trim()
    ) {

      return value
        .key_seed
        .trim();

    }


    for (
      const child
      of Object.values(value)
    ) {

      const hit =
        findKeySeed(
          child,
          depth + 1
        );


      if (hit) {
        return hit;
      }
    }


    return '';
  }


  function safeDecode(
    text
  ) {

    try {

      return decodeURIComponent(
        text
      );

    }
    catch (_) {

      return text;

    }
  }


  /* ============================================================
     TOKEN DECODE
  ============================================================ */

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


    if (
      plain
    ) {
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


    if (
      !bytes
    ) {
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
        char => ({
          '$': '_',
          '@': '/',
          '#': '.'
        })[char]
      ),

      input.replace(
        /[$@#]/g,
        char => ({
          '$': '+',
          '@': '/',
          '#': '='
        })[char]
      )

    ];


    const seen =
      new Set();


    for (
      let text
      of variants
    ) {

      if (
        !text ||
        seen.has(text)
      ) {
        continue;
      }


      seen.add(
        text
      );


      try {

        text =
          text
            .replace(
              /-/g,
              '+'
            )
            .replace(
              /_/g,
              '/'
            );


        text +=
          '='.repeat(
            (
              4 -
              text.length % 4
            )
            % 4
          );


        const decoded =
          atob(text);


        const out =
          new Uint8Array(
            decoded.length
          );


        for (
          let i = 0;
          i < decoded.length;
          i++
        ) {

          out[i] =
            decoded.charCodeAt(i);

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
      const byte
      of bytes
    ) {

      if (
        byte !== 9 &&
        byte !== 10 &&
        byte !== 13 &&
        (
          byte < 32 ||
          byte > 126
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


  /* ============================================================
     QAAB AES
  ============================================================ */

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


    const digest1 =
      await crypto.subtle.digest(

        'SHA-512',

        seed.slice(
          0,
          32
        )

      );


    const digest2 =
      new Uint8Array(

        await crypto.subtle.digest(

          'SHA-512',

          concat(

            new Uint8Array(
              digest1
            ),

            hexBytes(
              QAAB_SALT_HEX
            )

          )

        )

      );


    const key =
      digest2.slice(
        0,
        16
      );


    const iv =
      digest2.slice(
        16,
        32
      );


    const attempts =
      [];


    if (
      data.length >= 4 &&
      data[0] === 0xa8 &&
      data[1] === 0 &&
      data[2] === 1 &&
      data[3] === 0
    ) {

      attempts.push(

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

        attempts.push(

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

      attempts.push(
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
        currentKey,
        currentIV
      ]
      of attempts
    ) {

      const url =
        await aesUrl(
          payload,
          currentKey,
          currentIV
        );


      if (
        url
      ) {
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


    const padding =
      bytes[
        bytes.length - 1
      ];


    if (
      padding < 1 ||
      padding > 16 ||
      padding > bytes.length
    ) {
      return bytes;
    }


    for (
      let i =
        bytes.length -
        padding;

      i < bytes.length;

      i++
    ) {

      if (
        bytes[i] !== padding
      ) {

        return bytes;

      }

    }


    return bytes.slice(
      0,
      bytes.length -
      padding
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


    out.set(
      a
    );


    out.set(
      b,
      a.length
    );


    return out;
  }


  /* ============================================================
     VIDEOS
  ============================================================ */

  function visibleVideos() {

    return [
      ...document.querySelectorAll(
        'video'
      )
    ]
      .filter(
        video => {

          const rect =
            video
              .getBoundingClientRect();


          return (

            rect.width >= 160 &&

            rect.height >= 180 &&

            rect.width <= 900 &&

            rect.height <= 1300

          );

        }
      );
  }


  function videoContainer(
    video
  ) {

    const videoRect =
      video
        .getBoundingClientRect();


    let node =
      video.parentElement;


    let best =
      node ||
      video;


    for (
      let i = 0;

      node &&
      i < 6;

      i++,
      node =
        node.parentElement
    ) {

      const rect =
        node
          .getBoundingClientRect();


      if (
        !rect.width ||
        !rect.height
      ) {
        continue;
      }


      if (

        rect.width >=
          videoRect.width &&

        rect.height >=
          videoRect.height &&

        rect.width /
          videoRect.width <= 1.4 &&

        rect.height /
          videoRect.height <= 1.4

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


  /* ============================================================
     STYLE
  ============================================================ */

  function installStyle() {

    if (
      document.getElementById(
        'doubao-dl-style'
      )
    ) {
      return;
    }


    const style =
      document.createElement(
        'style'
      );


    style.id =
      'doubao-dl-style';


    style.textContent = `

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
    ).appendChild(
      style
    );
  }


  /* ============================================================
     UI
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
      document.createElement(
        'button'
      );


    fab.id =
      'doubao-dl-fab';


    fab.type =
      'button';


    fab.innerHTML =
      '↓<span id="doubao-dl-badge">0</span>';


    fab.title =
      '豆包无水印资源';


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
单视频可用卡片按钮；多视频请使用此面板下载
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
      ];


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

      const empty =
        document.createElement(
          'div'
        );


      empty.className =
        'ddl-empty';


      empty.innerHTML =
        '等待当前聊天的视频资源…<br>解析成功后会显示在这里';


      list.appendChild(
        empty
      );


      return;
    }


    items.forEach(
      (
        item,
        index
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
          `无水印视频 ${index + 1}`;


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


        const downloadButton =
          document.createElement(
            'button'
          );


        downloadButton.className =
          'ddl-down';


        downloadButton.textContent =
          '下载';


        downloadButton.addEventListener(
          'click',
          () => {

            download(
              item
            );

          }
        );


        row.append(
          info,
          downloadButton
        );


        list.appendChild(
          row
        );

      }
    );
  }


  /* ============================================================
     CARD BUTTON
  ============================================================ */

  function removeCardButtons() {

    document
      .querySelectorAll(
        '.doubao-dl-card'
      )
      .forEach(
        button => {

          button.remove();

        }
      );


    document
      .querySelectorAll(
        'video'
      )
      .forEach(
        video => {

          video.__doubaoDLButton =
            null;

        }
      );
  }


  function decorateVideos() {

    const videos =
      visibleVideos();


    const resources =
      [
        ...state
          .resources
          .values()
      ];


    /*
     * 核心规则：
     *
     * 只有
     *
     * 1 个视频
     * +
     * 1 个无水印资源
     *
     * 才显示卡片按钮。
     */

    if (
      videos.length !== 1 ||
      resources.length !== 1
    ) {

      removeCardButtons();


      state.cardBindings =
        new WeakMap();


      return;
    }


    const video =
      videos[0];


    const item =
      resources[0];


    state.cardBindings =
      new WeakMap();


    bind(
      video,
      item
    );


    /*
     * 删除旧 DOM 遗留按钮。
     */

    document
      .querySelectorAll(
        '.doubao-dl-card'
      )
      .forEach(
        button => {

          if (
            button !==
            video.__doubaoDLButton
          ) {

            button.remove();

          }

        }
      );


    if (
      video.__doubaoDLButton &&
      document.contains(
        video.__doubaoDLButton
      )
    ) {

      video
        .__doubaoDLButton
        .title =
          '下载当前唯一视频的无水印版本';


      return;
    }


    const container =
      videoContainer(
        video
      );


    if (
      !container
    ) {
      return;
    }


    if (
      getComputedStyle(
        container
      ).position ===
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
      'doubao-dl-card';


    button.type =
      'button';


    button.textContent =
      '↓ 无水印下载';


    button.title =
      '下载当前唯一视频的无水印版本';


    button.addEventListener(

      'click',

      event => {

        event.preventDefault();

        event.stopPropagation();


        downloadForCard(
          video
        );

      },

      true

    );


    container.appendChild(
      button
    );


    video.__doubaoDLButton =
      button;
  }


  function downloadForCard(
    video
  ) {

    const videos =
      visibleVideos();


    const resources =
      [
        ...state
          .resources
          .values()
      ];


    if (
      videos.length !== 1 ||
      resources.length !== 1
    ) {

      state.panelOpen =
        true;


      const panel =
        document.getElementById(
          'doubao-dl-panel'
        );


      if (
        panel
      ) {

        panel.hidden =
          false;

      }


      toast(

        resources.length

          ? '当前聊天有多个视频，请从右侧资源面板下载'

          : '尚未解析到无水印地址'

      );


      return;
    }


    download(
      resources[0]
    );
  }


  /* ============================================================
     DOWNLOAD
  ============================================================ */

  function download(
    item
  ) {

    if (
      !item ||
      !state.resources.has(
        item.url
      )
    ) {

      toast(
        '资源无效，已取消下载'
      );


      return;
    }


    GM_download({

      url:
        item.url,


      name:
        `doubao_unwatermarked_${stamp()}.mp4`,


      saveAs:
        false,


      onload:
        () => {

          toast(
            '无水印视频下载已开始'
          );

        },


      onerror:
        error => {

          warn(
            'download failed',
            error
          );


          toast(
            '下载失败，请重试'
          );

        }

    });
  }


  function stamp() {

    const date =
      new Date();


    const pad =
      number =>
        String(number)
          .padStart(
            2,
            '0'
          );


    return (

      `${date.getFullYear()}` +

      `${pad(
        date.getMonth() + 1
      )}` +

      `${pad(
        date.getDate()
      )}_` +

      `${pad(
        date.getHours()
      )}` +

      `${pad(
        date.getMinutes()
      )}` +

      `${pad(
        date.getSeconds()
      )}`

    );
  }


  /* ============================================================
     TOAST
  ============================================================ */

  let toastTimer;


  function toast(
    text
  ) {

    let element =
      document.getElementById(
        'doubao-dl-toast'
      );


    if (
      !element
    ) {

      element =
        document.createElement(
          'div'
        );


      element.id =
        'doubao-dl-toast';


      document
        .documentElement
        .appendChild(
          element
        );

    }


    element.textContent =
      text;


    clearTimeout(
      toastTimer
    );


    toastTimer =
      setTimeout(
        () => {

          element.remove();

        },
        2800
      );
  }


  /* ============================================================
     DECORATE
  ============================================================ */

  function scheduleDecorate() {

    clearTimeout(
      state.decorateTimer
    );


    state.decorateTimer =
      setTimeout(
        decorateVideos,
        150
      );
  }


  /* ============================================================
     CHAT WATCHER
  ============================================================ */

  function installConversationWatcher() {

    let lastHref =
      location.href;


    setInterval(
      () => {

        if (
          location.href ===
          lastHref
        ) {
          return;
        }


        lastHref =
          location.href;


        state.currentHref =
          lastHref;


        /*
         * 新聊天：
         *
         * 1. 旧请求失效
         * 2. 资源归零
         * 3. 卡片按钮移除
         */

        state.conversationEpoch++;


        state.latestMediaSeq =
          ++state.mediaResponseSeq;


        state.resources.clear();


        state.cardBindings =
          new WeakMap();


        state.status =
          '已切换聊天，等待读取当前聊天资源…';


        removeCardButtons();


        renderPanel();


        scheduleDecorate();

      },
      300
    );
  }


  /* ============================================================
     BOOT
  ============================================================ */

  function bootDOM() {

    installStyle();

    createUI();

    installConversationWatcher();

    decorateVideos();


    new MutationObserver(
      () => {

        scheduleDecorate();

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


  /*
   * 豆包有可能重新绑定 fetch/XHR，
   * 定时补一次 hook。
   */

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
