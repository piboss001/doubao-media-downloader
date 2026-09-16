from pathlib import Path

code = r'''// ==UserScript==
// @name         Doubao Media Downloader
// @namespace    https://github.com/YOUR_NAME/doubao-media-downloader
// @version      1.0.0
// @description  在豆包生成的视频卡片左上角添加无水印下载按钮，并提供资源面板。
// @author       YOUR_NAME
// @match        https://www.doubao.com/*
// @match        https://doubao.com/*
// @run-at       document-start
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// ==/UserScript==

(() => {
  'use strict';

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const TAG = '[DoubaoDL]';
  const VERSION = '1.0.0';
  const QAAB_SALT_HEX =
    '4dd4c2e6b83162090e52b3c7a6733ba4' +
    '1cb2462b829ab58a196b39db57177524' +
    'f49baf7f08e8d68d26a72e37c1a95a2f' +
    '1f05a51892aef2949732b62a38aadd58';

  const PLAY_INFO =
    'https://www.doubao.com/samantha/media/get_play_info' +
    '?version_code=20800&language=zh-CN&device_platform=web&aid=497858' +
    '&real_aid=497858&pkg_type=release_version&device_id=&pc_version=2.51.7' +
    '&region=&sys_region=&samantha_web=1&use-olympus-account=1&web_tab_id=';

  const state = {
    media: new Map(),       // url -> item
    fallbackApis: new Set(),
    vids: new Set(),
    panelOpen: GM_getValue('panelOpen', false),
    busy: new WeakSet()
  };

  const log = (...a) => console.log(TAG, ...a);
  const isHttp = s => typeof s === 'string' && /^https?:\/\//i.test(s);

  /* -------------------- HTTP helper -------------------- */

  function gmRequest({ method = 'GET', url, headers = {}, data = null, responseType = 'text' }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url, headers, data, responseType,
        timeout: 30000,
        onload: r => resolve(r),
        onerror: reject,
        ontimeout: () => reject(new Error('request timeout'))
      });
    });
  }

  async function gmJson(opts) {
    const r = await gmRequest({ ...opts, responseType: 'text' });
    try { return JSON.parse(r.responseText); }
    catch { throw new Error('invalid JSON'); }
  }

  /* -------------------- Network hooks -------------------- */

  function installFetchHook() {
    if (!W.fetch || W.fetch.__doubaoDL) return;
    const original = W.fetch;

    async function hookedFetch(input, init) {
      const response = await original.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (shouldInspect(url)) {
          response.clone().text().then(text => inspectResponse(url, text)).catch(() => {});
        }
      } catch (_) {}
      return response;
    }

    hookedFetch.__doubaoDL = true;
    try { W.fetch = hookedFetch; log('fetch hook installed'); } catch (_) {}
  }

  function installXHRHook() {
    const XHR = W.XMLHttpRequest;
    if (!XHR || XHR.prototype.__doubaoDL) return;

    const open = XHR.prototype.open;
    XHR.prototype.open = function(method, url) {
      this.__doubaoDL_url = String(url || '');
      this.addEventListener('load', () => {
        try {
          if (!shouldInspect(this.__doubaoDL_url)) return;
          if (this.responseType && this.responseType !== '' && this.responseType !== 'text') return;
          inspectResponse(this.__doubaoDL_url, this.responseText || '');
        } catch (_) {}
      });
      return open.apply(this, arguments);
    };

    XHR.prototype.__doubaoDL = true;
    log('XHR hook installed');
  }

  function shouldInspect(url) {
    return /doubao\.com\/im\/chain\/single/i.test(url) ||
           /doubao\.com\/samantha\//i.test(url) ||
           /byte/i.test(url);
  }

  async function inspectResponse(url, text) {
    if (!text || text.length < 2) return;

    let json;
    try { json = JSON.parse(text); } catch { json = null; }

    if (json) {
      for (const imageUrl of findImageOriRawUrls(json)) addMedia('image', imageUrl, 'response');
      for (const api of findValuesByKey(json, 'fallback_api')) addFallbackApi(api);
      for (const vid of findPossibleVids(json)) state.vids.add(vid);
      for (const direct of findDirectOriginalUrls(json)) addMedia('video', direct, 'response');
    }

    // Some payloads contain JSON escaped inside strings.
    const fallbackPatterns = [
      /fallback_api\\":\\"(.*?)\\"/g,
      /"fallback_api"\s*:\s*"([^"]+)"/g
    ];
    for (const re of fallbackPatterns) {
      let m;
      while ((m = re.exec(text))) addFallbackApi(decodeEscaped(m[1]));
    }

    // Resolve newly discovered fallback APIs.
    for (const api of [...state.fallbackApis]) {
      if (state.mediaHasSourceApi?.has?.(api)) continue;
      resolveFallbackApi(api);
    }

    scheduleDecorate();
  }

  /* -------------------- JSON traversal -------------------- */

  function walk(value, fn, depth = 0, seen = new Set()) {
    if (depth > 14 || value == null) return;
    if (typeof value === 'string') {
      fn(value, null, null);
      if ((value.startsWith('{') || value.startsWith('[')) && value.length < 2_000_000) {
        try { walk(JSON.parse(value), fn, depth + 1, seen); } catch (_) {}
      }
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    fn(value, null, null);
    if (Array.isArray(value)) {
      for (const x of value) walk(x, fn, depth + 1, seen);
    } else {
      for (const [k, v] of Object.entries(value)) {
        fn(v, k, value);
        walk(v, fn, depth + 1, seen);
      }
    }
  }

  function findValuesByKey(root, wanted) {
    const out = [];
    walk(root, (v, k) => { if (k === wanted) out.push(v); });
    return out;
  }

  function findImageOriRawUrls(root) {
    const out = new Set();
    walk(root, node => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const u = node?.image_ori_raw?.url;
      if (isHttp(u)) out.add(u);
    });
    return [...out];
  }

  function findDirectOriginalUrls(root) {
    const out = new Set();
    walk(root, (v, k, parent) => {
      if (typeof v !== 'string' || !isHttp(v)) return;
      if (k === 'main_url' && parent && (
        parent.original_media_info ||
        /unwater|original/i.test(JSON.stringify(parent).slice(0, 1500))
      )) out.add(v);
    });
    return [...out];
  }

  function findPossibleVids(root) {
    const out = new Set();
    walk(root, (v, k) => {
      if (typeof v !== 'string') return;
      if (/^(vid|video_id|videoId|key)$/i.test(k || '') && /^[A-Za-z0-9_-]{8,200}$/.test(v)) {
        out.add(v);
      }
    });
    return [...out];
  }

  /* -------------------- Doubao resolver -------------------- */

  function addFallbackApi(value) {
    if (typeof value !== 'string') return;
    const u = decodeEscaped(value);
    if (isHttp(u)) state.fallbackApis.add(u);
  }

  function decodeEscaped(value) {
    let text = String(value || '');
    for (let i = 0; i < 3; i++) {
      try {
        const decoded = JSON.parse(`"${text.replace(/"/g, '\\"')}"`);
        if (decoded === text) break;
        text = decoded;
      } catch { break; }
    }
    return text.replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
  }

  async function resolveFallbackApi(api) {
    state.mediaHasSourceApi ||= new Set();
    if (state.mediaHasSourceApi.has(api)) return;
    state.mediaHasSourceApi.add(api);

    try {
      const u = new URL(api);
      u.searchParams.set('channel', 'no');
      u.searchParams.set('codec_type', '8');
      u.searchParams.set('logo_type', 'unwatermarked');

      const payload = await gmJson({
        url: u.toString(),
        headers: { accept: 'application/json,text/plain,*/*' }
      });

      const data = getVideoData(payload);
      const token = pickMainUrlToken(data);
      if (!token) return;

      const decoded = await decodeMainUrl(token, findKeySeedDeep(payload));
      if (isHttp(decoded)) {
        addMedia('video', decoded, 'fallback_api');
        scheduleDecorate();
      }
    } catch (e) {
      console.warn(TAG, 'fallback resolve failed', e);
    }
  }

  function getVideoData(payload) {
    const vi = payload?.video_info || payload?.data?.video_info || payload;
    const d = vi?.data || vi;
    return d && typeof d === 'object' ? d : {};
  }

  function pickMainUrlToken(data) {
    const list = data?.video_list;
    const entries = list && typeof list === 'object' && Object.keys(list).length
      ? Object.values(list) : [data];

    let best = null;
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue;
      const token = e.main_url || e.play_url || '';
      if (typeof token !== 'string' || !token.trim()) continue;
      const score =
        Number(e.bitrate || e.real_bitrate || 0) +
        Number(e.vwidth || e.width || 0) * Number(e.vheight || e.height || 0);
      if (!best || score > best.score) best = { token: token.trim(), score };
    }
    return best?.token || '';
  }

  function findKeySeedDeep(value, depth = 0) {
    if (depth > 10 || value == null) return '';
    if (typeof value === 'string') {
      let m = value.match(/(?:^|[?&])key_seed=([^&"'<>\\\s]+)/i);
      if (m) return safeDecode(m[1]);
      m = value.match(/["']key_seed["']\s*:\s*["']([^"']+)/i);
      return m ? safeDecode(m[1]) : '';
    }
    if (typeof value !== 'object') return '';
    if (typeof value.key_seed === 'string' && value.key_seed.trim()) return value.key_seed.trim();
    for (const x of Object.values(value)) {
      const hit = findKeySeedDeep(x, depth + 1);
      if (hit) return hit;
    }
    return '';
  }

  const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };

  async function decodeMainUrl(token, keySeed = '') {
    if (isHttp(token)) return token;
    const plain = tryDecodeBase64Url(token);
    if (plain) return plain;
    if (token.startsWith('qAAB') && keySeed) return decodeQaabToken(token, keySeed);
    return '';
  }

  function base64DecodeLoose(text) {
    const input = String(text || '').trim();
    const variants = [
      input,
      input.replace(/[$@#]/g, c => ({ '$': '_', '@': '/', '#': '.' }[c])),
      input.replace(/[$@#]/g, c => ({ '$': '+', '@': '/', '#': '=' }[c]))
    ];
    for (const candidate of [...new Set(variants)]) {
      if (!candidate) continue;
      try {
        let n = candidate.replace(/-/g, '+').replace(/_/g, '/');
        n += '='.repeat((4 - n.length % 4) % 4);
        const b = atob(n);
        return Uint8Array.from(b, c => c.charCodeAt(0));
      } catch (_) {}
    }
    return null;
  }

  function asciiUrl(bytes) {
    if (!bytes?.length) return '';
    for (const b of bytes) {
      if (b !== 9 && b !== 10 && b !== 13 && (b < 32 || b > 126)) return '';
    }
    const s = new TextDecoder().decode(bytes);
    return isHttp(s) ? s : '';
  }

  function tryDecodeBase64Url(token) {
    return asciiUrl(base64DecodeLoose(token));
  }

  async function decodeQaabToken(token, keySeed) {
    const data = base64DecodeLoose(token);
    const seed = base64DecodeLoose(keySeed);
    if (!data || !seed) return '';

    const d1 = await crypto.subtle.digest('SHA-512', seed.slice(0, 32));
    const salt = hexToBytes(QAAB_SALT_HEX);
    const d2 = new Uint8Array(await crypto.subtle.digest(
      'SHA-512', concatBytes(new Uint8Array(d1), salt)
    ));
    const key = d2.slice(0, 16);
    const iv = d2.slice(16, 32);
    const attempts = [];

    if (data.length >= 4 && data[0] === 0xa8 && data[1] === 0 && data[2] === 1 && data[3] === 0) {
      attempts.push([data.slice(4), key, iv], [data.slice(4), iv, key]);
      if (data.length > 36) {
        attempts.push([data.slice(36), key, data.slice(20, 36)], [data.slice(36), key, iv]);
      }
    } else attempts.push([data, key, iv]);

    for (const [payload, k, v] of attempts) {
      const u = await decryptAesCbcUrl(payload, k, v);
      if (u) return u;
    }
    return '';
  }

  async function decryptAesCbcUrl(payload, keyBytes, ivBytes) {
    if (!payload.length || payload.length % 16) return '';
    try {
      const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['decrypt']);
      const plain = new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: ivBytes }, key, payload
      ));
      return asciiUrl(plain) || asciiUrl(stripPkcs7(plain));
    } catch { return ''; }
  }

  function stripPkcs7(bytes) {
    if (!bytes?.length) return new Uint8Array();
    const p = bytes[bytes.length - 1];
    if (p < 1 || p > 16 || p > bytes.length) return bytes;
    for (let i = bytes.length - p; i < bytes.length; i++) if (bytes[i] !== p) return bytes;
    return bytes.slice(0, bytes.length - p);
  }

  function hexToBytes(hex) {
    const b = new Uint8Array(hex.length / 2);
    for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return b;
  }

  function concatBytes(a, b) {
    const x = new Uint8Array(a.length + b.length);
    x.set(a); x.set(b, a.length); return x;
  }

  async function getOriginalByVid(vid) {
    try {
      const j = await gmJson({
        method: 'POST',
        url: PLAY_INFO,
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json'
        },
        data: JSON.stringify({ key: vid })
      });
      const u = j?.data?.original_media_info?.main_url;
      if (isHttp(u)) {
        addMedia('video', u, 'vid');
        return u;
      }
    } catch (_) {}
    return '';
  }

  /* -------------------- Media store -------------------- */

  function addMedia(type, url, source) {
    if (!isHttp(url)) return;
    if (!state.media.has(url)) {
      state.media.set(url, {
        type, url, source,
        createdAt: Date.now()
      });
      renderPanel();
    }
  }

  function videoItems() {
    return [...state.media.values()].filter(x => x.type === 'video');
  }

  /* -------------------- Card button -------------------- */

  let decorateTimer = 0;
  function scheduleDecorate() {
    clearTimeout(decorateTimer);
    decorateTimer = setTimeout(decorateVideos, 120);
  }

  function decorateVideos() {
    const videos = [...document.querySelectorAll('video')].filter(v => {
      const r = v.getBoundingClientRect();
      return r.width > 120 && r.height > 120;
    });

    videos.forEach((video, index) => {
      if (video.dataset.doubaoDlDecorated) return;
      video.dataset.doubaoDlDecorated = '1';

      const box = findCardBox(video);
      if (!box) return;
      if (getComputedStyle(box).position === 'static') box.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className = 'doubao-dl-card-btn';
      btn.type = 'button';
      btn.innerHTML = '<span class="doubao-dl-arrow">↓</span><span>无水印下载</span>';
      btn.title = '下载当前视频的无水印版本';
      btn.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        if (state.busy.has(btn)) return;
        state.busy.add(btn);
        const old = btn.innerHTML;
        btn.innerHTML = '<span class="doubao-dl-spinner"></span><span>解析中…</span>';

        try {
          const url = await resolveForCard(video, box, index);
          if (!url) throw new Error('暂未捕获到这个视频的无水印地址');
          downloadMedia(url, 'video');
          btn.innerHTML = '<span>✓</span><span>已开始下载</span>';
          setTimeout(() => { btn.innerHTML = old; }, 1600);
        } catch (err) {
          btn.innerHTML = '<span>!</span><span>未解析到</span>';
          toast(err.message || '解析失败');
          setTimeout(() => { btn.innerHTML = old; }, 1800);
        } finally {
          state.busy.delete(btn);
        }
      }, true);

      box.appendChild(btn);
    });
  }

  function findCardBox(video) {
    let el = video.parentElement;
    let best = el;
    for (let i = 0; el && i < 7; i++, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width >= 180 && r.height >= 220 && r.width < 900 && r.height < 1200) best = el;
      if (el.querySelectorAll?.('video').length > 1) break;
    }
    return best;
  }

  async function resolveForCard(video, box, visibleIndex) {
    // 1) Try to discover a vid from the card DOM.
    const html = box.outerHTML.slice(0, 400000);
    const candidates = new Set();
    const patterns = [
      /(?:vid|video[_-]?id|videoId)["'=:\s\\]+([A-Za-z0-9_-]{8,200})/gi,
      /["']key["']\s*:\s*["']([A-Za-z0-9_-]{8,200})["']/gi
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(html))) candidates.add(m[1]);
    }
    for (const vid of candidates) {
      const u = await getOriginalByVid(vid);
      if (u) return u;
    }

    // 2) If captured originals and visible cards have the same count, map by order.
    const cards = [...document.querySelectorAll('video')].filter(v => {
      const r = v.getBoundingClientRect();
      return r.width > 120 && r.height > 120;
    });
    const vids = videoItems();
    const idx = cards.indexOf(video);
    if (idx >= 0 && vids.length === cards.length && vids[idx]) return vids[idx].url;

    // 3) One generated video = unambiguous.
    if (vids.length === 1) return vids[0].url;

    // 4) Resolve any vid captured from the API.
    for (const vid of [...state.vids].reverse()) {
      const u = await getOriginalByVid(vid);
      if (u) return u;
    }

    // 5) Last captured video as final fallback.
    return vids.at(-1)?.url || '';
  }

  /* -------------------- Download -------------------- */

  function filename(type) {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    return `doubao_${type}_${stamp}.${type === 'image' ? 'jpg' : 'mp4'}`;
  }

  function downloadMedia(url, type = 'video') {
    GM_download({
      url,
      name: filename(type),
      saveAs: false,
      onerror: e => {
        console.warn(TAG, 'GM_download failed', e);
        // Browser navigation fallback.
        const a = document.createElement('a');
        a.href = url; a.download = filename(type); a.target = '_blank';
        document.documentElement.appendChild(a); a.click(); a.remove();
      }
    });
  }

  /* -------------------- UI -------------------- */

  function installStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .doubao-dl-card-btn{
        position:absolute!important;left:10px!important;top:10px!important;z-index:2147483000!important;
        height:34px!important;padding:0 12px!important;border:1px solid rgba(255,255,255,.25)!important;
        border-radius:9px!important;background:rgba(15,15,18,.72)!important;color:#fff!important;
        display:flex!important;align-items:center!important;gap:6px!important;cursor:pointer!important;
        font:500 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif!important;
        box-shadow:0 3px 12px rgba(0,0,0,.18)!important;backdrop-filter:blur(8px)!important;
        opacity:.92!important;transition:.15s ease!important;
      }
      .doubao-dl-card-btn:hover{background:rgba(15,15,18,.9)!important;transform:translateY(-1px)!important;opacity:1!important}
      .doubao-dl-arrow{font-size:18px!important;line-height:1!important}
      .doubao-dl-spinner{width:13px;height:13px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:doubaoSpin .7s linear infinite}
      @keyframes doubaoSpin{to{transform:rotate(360deg)}}
      #doubao-dl-fab{
        position:fixed;right:18px;bottom:88px;z-index:2147483645;width:46px;height:46px;border:0;border-radius:14px;
        background:#17171b;color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.22);cursor:pointer;font-size:19px
      }
      #doubao-dl-panel{
        position:fixed;right:18px;bottom:144px;z-index:2147483646;width:330px;max-height:430px;overflow:hidden;
        border:1px solid rgba(0,0,0,.08);border-radius:16px;background:#fff;color:#18181b;
        box-shadow:0 14px 45px rgba(0,0,0,.18);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif
      }
      #doubao-dl-panel[hidden]{display:none!important}
      .ddl-head{height:52px;padding:0 15px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #eee;font-weight:650}
      .ddl-list{max-height:300px;overflow:auto;padding:8px}
      .ddl-empty{padding:30px 10px;text-align:center;color:#999;font-size:13px}
      .ddl-item{display:flex;gap:8px;align-items:center;padding:9px;border-radius:9px}.ddl-item:hover{background:#f6f6f7}
      .ddl-type{width:44px;font-size:12px;color:#666}.ddl-url{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#777}
      .ddl-down{border:0;border-radius:7px;background:#17171b;color:#fff;padding:7px 9px;cursor:pointer;font-size:12px}
      .ddl-foot{padding:10px 12px;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#888}
      .ddl-clear{border:0;background:transparent;color:#777;cursor:pointer}
      #doubao-dl-toast{position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:2147483647;background:rgba(0,0,0,.78);color:#fff;padding:9px 14px;border-radius:9px;font-size:13px;pointer-events:none}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function installPanel() {
    if (document.getElementById('doubao-dl-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'doubao-dl-fab';
    fab.title = '豆包无水印资源';
    fab.textContent = '↓';

    const panel = document.createElement('div');
    panel.id = 'doubao-dl-panel';
    panel.hidden = !state.panelOpen;
    panel.innerHTML = `
      <div class="ddl-head"><span>豆包资源助手 <small style="color:#999;font-weight:400">v${VERSION}</small></span><span id="ddl-count">0</span></div>
      <div class="ddl-list" id="ddl-list"></div>
      <div class="ddl-foot"><span>卡片左上角可直接下载</span><button class="ddl-clear" id="ddl-clear">清空</button></div>
    `;

    fab.onclick = () => {
      state.panelOpen = !state.panelOpen;
      panel.hidden = !state.panelOpen;
      GM_setValue('panelOpen', state.panelOpen);
    };
    panel.querySelector('#ddl-clear').onclick = () => {
      state.media.clear();
      renderPanel();
    };

    document.documentElement.append(fab, panel);
    renderPanel();
  }

  function renderPanel() {
    const panel = document.getElementById('doubao-dl-panel');
    if (!panel) return;
    const list = panel.querySelector('#ddl-list');
    panel.querySelector('#ddl-count').textContent = state.media.size;

    list.textContent = '';
    const all = [...state.media.values()].reverse();
    if (!all.length) {
      list.innerHTML = '<div class="ddl-empty">等待豆包生成视频或图片…</div>';
      return;
    }

    all.forEach(item => {
      const row = document.createElement('div');
      row.className = 'ddl-item';
      row.innerHTML = `
        <span class="ddl-type">${item.type === 'video' ? '视频' : '图片'}</span>
        <span class="ddl-url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</span>
        <button class="ddl-down">下载</button>
      `;
      row.querySelector('.ddl-down').onclick = () => downloadMedia(item.url, item.type);
      list.appendChild(row);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  let toastTimer;
  function toast(text) {
    let el = document.getElementById('doubao-dl-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'doubao-dl-toast';
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  }

  /* -------------------- Boot -------------------- */

  function bootDOM() {
    installStyle();
    installPanel();
    decorateVideos();

    const mo = new MutationObserver(scheduleDecorate);
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Doubao is an SPA; periodic light repair makes the button resilient to rerenders.
    setInterval(decorateVideos, 2500);
  }

  installFetchHook();
  installXHRHook();

  // Some sites replace fetch during bootstrap. Repair hooks briefly.
  let repairs = 0;
  const repair = setInterval(() => {
    installFetchHook();
    installXHRHook();
    if (++repairs >= 20) clearInterval(repair);
  }, 500);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootDOM, { once: true });
  } else {
    bootDOM();
  }
})();
'''

path = Path('/mnt/data/doubao-media-downloader.user.js')
path.write_text(code, encoding='utf-8')
print(f'Created: {path}\nLines: {code.count(chr(10))+1}\nBytes: {path.stat().st_size}')
