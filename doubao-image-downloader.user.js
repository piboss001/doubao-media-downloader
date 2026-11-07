// ==UserScript==
// @name         豆包无水印图片下载助手
// @namespace    https://github.com/piboss001/doubao-media-downloader
// @version      1.0.1
// @description  获取豆包生成图片的无水印原图，支持单张下载、多选 ZIP 打包；与原视频脚本独立运行。
// @author       piboss001
// @match        https://www.doubao.com/*
// @match        https://doubao.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      *.byteimg.com
// @connect      byteimg.com
// @connect      *.doubao.com
// @connect      doubao.com
// @connect      *.bytedance.com
// @connect      bytedance.com
// @connect      *.bytecdn.cn
// @connect      bytecdn.cn
// @connect      *.volces.com
// @connect      volces.com
// @updateURL    https://raw.githubusercontent.com/piboss001/doubao-media-downloader/main/doubao-image-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/piboss001/doubao-media-downloader/main/doubao-image-downloader.user.js
// ==/UserScript==

(() => {
  'use strict';
  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const nativeParse = PAGE.JSON.parse.bind(PAGE.JSON);
  const HOSTS = ['byteimg.com', 'doubao.com', 'bytedance.com', 'bytecdn.cn', 'volces.com'];
  const MAX_TEXT = 4 * 1024 * 1024;
  const resources = new Map(), aliases = new Map(), selected = new Set();
  const state = { href: location.href, epoch: 0, busy: false, opened: false, renderTimer: 0, cardTimer: 0 };
  const tag = '[DoubaoImageDL]';

  function safeUrl(input) {
    if (typeof input !== 'string' || !input) return '';
    try {
      const u = new URL(input.replace(/\\u0026/gi, '&').replace(/&amp;/g, '&').replace(/\\\//g, '/'), location.origin);
      if (u.protocol !== 'https:') return '';
      const host = u.hostname.toLowerCase();
      return HOSTS.some(s => host === s || host.endsWith('.' + s)) ? u.href : '';
    } catch (_) { return ''; }
  }
  function key(input) {
    try {
      const u = new URL(input);
      return (u.origin + u.pathname).replace(/~tplv-[^/]+$/i, '');
    } catch (_) { return ''; }
  }
  function getUrl(value) {
    if (typeof value === 'string') return safeUrl(value);
    return value && typeof value === 'object'
      ? safeUrl(value.url || value.main_url || value.uri || '') : '';
  }
  function capture(node, epoch) {
    if (epoch !== state.epoch || !node || typeof node !== 'object') return;
    const raw = getUrl(node.image_ori_raw);
    if (!raw) return; // 必须有明确的无水印原图字段，不回退到带水印预览。
    const id = key(raw);
    if (!id) return;
    const preview = getUrl(node.image_preview) || getUrl(node.image_thumb) || getUrl(node.image_ori) || raw;
    if (!resources.has(id)) resources.set(id, { id, raw, preview });
    else { const item = resources.get(id); item.raw = raw; item.preview = preview; }
    for (const link of [raw, preview, getUrl(node.image_ori), getUrl(node.image_thumb), getUrl(node.image_preview)]) {
      if (link) aliases.set(key(link), id);
    }
    scheduleUI();
    scheduleCards();
  }
  function scanTree(root, epoch) {
    if (epoch !== state.epoch) return;
    const stack = [[root, 0]], seen = new Set();
    let count = 0;
    while (stack.length && ++count <= 10000) {
      const [obj, depth] = stack.pop();
      if (obj == null || depth > 20) continue;
      if (typeof obj === 'string') {
        if (obj.length < MAX_TEXT && /image_ori_raw/.test(obj) && /^\s*[\[{]/.test(obj)) {
          try { stack.push([nativeParse(obj), depth + 1]); } catch (_) {}
        }
        continue;
      }
      if (typeof obj !== 'object' || seen.has(obj)) continue;
      seen.add(obj);
      if (!Array.isArray(obj) && obj.image_ori_raw) capture(obj, epoch);
      for (const value of (Array.isArray(obj) ? obj : Object.values(obj))) stack.push([value, depth + 1]);
    }
  }
  function scanText(body, epoch) {
    if (epoch !== state.epoch || typeof body !== 'string' || body.length > MAX_TEXT ||
        !/image_ori_raw/.test(body)) return;
    try { scanTree(nativeParse(body), epoch); return; } catch (_) {}
    let lines = 0;
    for (const line of body.split(/\r?\n/)) {
      if (++lines > 10000) break;
      const part = line.trim().replace(/^data:\s*/, '');
      if (!/image_ori_raw/.test(part)) continue;
      try { scanTree(nativeParse(part), epoch); } catch (_) {}
    }
  }
  function apiUrl(input) {
    try {
      const u = new URL(input, location.origin);
      return (u.hostname === 'doubao.com' || u.hostname.endsWith('.doubao.com')) &&
        !/\.(?:png|jpg|jpeg|webp|gif|avif|mp4|js|css)$/i.test(u.pathname);
    } catch (_) { return false; }
  }
  function installHooks() {
    if (!PAGE.JSON.parse.__dbImage) {
      const original = PAGE.JSON.parse;
      const hook = function() {
        const result = original.apply(this, arguments);
        const text = arguments[0];
        try {
          navigation();
          if (typeof text === 'string' && text.length < MAX_TEXT &&
              /image_ori_raw/.test(text)) scanTree(result, state.epoch);
        } catch (_) {}
        return result;
      };
      Object.defineProperty(hook, '__dbImage', { value: true });
      try { PAGE.JSON.parse = hook; } catch (_) {}
    }
    const originalFetch = PAGE.fetch;
    if (typeof originalFetch === 'function' && !originalFetch.__dbImage) {
      const hook = async function(input) {
        navigation();
        const epoch = state.epoch;
        const response = await originalFetch.apply(this, arguments);
        const url = typeof input === 'string' ? input : String(input?.url || '');
        if (apiUrl(url)) {
          try {
            const type = response.headers.get('content-type') || '';
            const length = Number(response.headers.get('content-length') || 0);
            if ((!length || length <= MAX_TEXT) && /json|text|event-stream|ndjson/i.test(type)) {
              response.clone().text().then(s => scanText(s, epoch)).catch(() => {});
            }
          } catch (_) {}
        }
        return response;
      };
      Object.defineProperty(hook, '__dbImage', { value: true });
      try { PAGE.fetch = hook; } catch (_) {}
    }
    const XHR = PAGE.XMLHttpRequest;
    if (XHR && !XHR.prototype.__dbImage) {
      const open = XHR.prototype.open;
      XHR.prototype.open = function(method, url) {
        navigation();
        const epoch = state.epoch;
        if (apiUrl(String(url || ''))) {
          this.addEventListener('load', () => {
            try {
              if (this.responseType === 'json') scanTree(this.response, epoch);
              else if (!this.responseType || this.responseType === 'text') scanText(this.responseText, epoch);
            } catch (_) {}
          }, { once: true });
        }
        return open.apply(this, arguments);
      };
      Object.defineProperty(XHR.prototype, '__dbImage', { value: true });
    }
  }
  function scheduleUI() { clearTimeout(state.renderTimer); state.renderTimer = setTimeout(render, 140); }
  function scheduleCards() { clearTimeout(state.cardTimer); state.cardTimer = setTimeout(decorate, 220); }
  function decorate() {
    for (const img of document.querySelectorAll('img')) {
      if (img.closest('#dbi-panel')) continue;
      const rect = img.getBoundingClientRect();
      if (rect.width < 140 || rect.height < 140) continue;
      const id = [img.currentSrc, img.src, img.getAttribute('data-src')]
        .map(link => aliases.get(key(link || ''))).find(Boolean);
      if (!id || !resources.has(id) || !img.parentElement) continue;
      const host = img.parentElement;
      let button = host.querySelector(':scope > .dbi-img-btn');
      if (button?.dataset.resource === id) continue;
      if (button) button.remove();
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      button = document.createElement('button');
      button.className = 'dbi-img-btn';
      button.type = 'button';
      button.dataset.resource = id;
      button.textContent = '↓ 无水印原图';
      button.addEventListener('click', event => {
        event.stopPropagation();
        event.preventDefault();
        const item = resources.get(button.dataset.resource);
        if (item) downloadOne(item);
      }, true);
      host.appendChild(button);
    }
  }
  function filenameStamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function fetchImage(link) {
    return new Promise((resolve, reject) => {
      const url = safeUrl(link);
      if (!url) return reject(new Error('不支持的原图 CDN 地址'));
      GM_xmlhttpRequest({
        method: 'GET', url, responseType: 'blob', timeout: 60000,
        onload: response => {
          if (response.status < 200 || response.status >= 300) return reject(new Error('HTTP ' + response.status));
          const blob = response.response;
          if (!blob || typeof blob.slice !== 'function' || !blob.size) return reject(new Error('未获取到图片数据'));
          resolve(blob);
        },
        onerror: () => reject(new Error('网络错误')),
        ontimeout: () => reject(new Error('下载超时'))
      });
    });
  }
  async function detectImage(blob) {
    const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    let ext = '';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ext = 'png';
    else if (b[0] === 0xff && b[1] === 0xd8) ext = 'jpg';
    else if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) ext = 'gif';
    else if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) ext = 'webp';
    else if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) ext = 'avif';
    if (!ext) throw new Error('服务器返回的数据不是受支持的图片');
    return { blob, ext };
  }
  function save(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function status(message) {
    const label = document.getElementById('dbi-status');
    if (label) label.textContent = message;
  }
  async function downloadOne(item) {
    if (!resources.has(item.id)) return;
    if (state.busy) return status('批量下载中，请稍后');
    const epoch = state.epoch;
    try {
      status('正在获取原图…');
      const file = await detectImage(await fetchImage(item.raw));
      if (epoch !== state.epoch) return;
      save(file.blob, 'doubao_original_' + filenameStamp() + '.' + file.ext);
      status('无水印原图已开始下载');
    } catch (error) { status('下载失败：' + error.message); console.warn(tag, error); }
  }

  // 图片本身已压缩；纯 JS 生成 ZIP Store 格式，不依赖第三方库。
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function packZip(files) {
    const localParts = [], centralParts = [], encoder = new TextEncoder();
    let offset = 0;
    for (const file of files) {
      const name = encoder.encode(file.name), bytes = file.bytes, sum = crc32(bytes);
      const l = new Uint8Array(30 + name.length), a = new DataView(l.buffer);
      a.setUint32(0, 0x04034b50, true); a.setUint16(4, 20, true);
      a.setUint16(6, 0x0800, true); a.setUint32(14, sum, true);
      a.setUint32(18, bytes.length, true); a.setUint32(22, bytes.length, true);
      a.setUint16(26, name.length, true); l.set(name, 30);
      const c = new Uint8Array(46 + name.length), v = new DataView(c.buffer);
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true);
      v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true);
      v.setUint32(16, sum, true); v.setUint32(20, bytes.length, true);
      v.setUint32(24, bytes.length, true); v.setUint16(28, name.length, true);
      v.setUint32(42, offset, true); c.set(name, 46);
      localParts.push(l, bytes); centralParts.push(c); offset += l.length + bytes.length;
    }
    const end = new Uint8Array(22), view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, files.length, true); view.setUint16(10, files.length, true);
    view.setUint32(12, centralParts.reduce((n, part) => n + part.length, 0), true);
    view.setUint32(16, offset, true);
    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
  }
  async function downloadZip() {
    if (state.busy) return;
    const targets = [...selected].map(id => resources.get(id)).filter(Boolean);
    if (!targets.length) return status('请先选择图片');
    if (targets.length > 60) return status('一次最多选择 60 张，请分批打包');
    state.busy = true; updateCount();
    const epoch = state.epoch, files = [];
    let total = 0;
    try {
      for (let n = 0; n < targets.length; n++) {
        if (epoch !== state.epoch) throw new Error('已切换聊天，下载取消');
        status('下载图片 ' + (n + 1) + '/' + targets.length);
        const file = await detectImage(await fetchImage(targets[n].raw));
        total += file.blob.size;
        if (total > 300 * 1024 * 1024) throw new Error('已超过 300MB，请分批打包');
        files.push({ name: 'doubao_' + String(n + 1).padStart(3, '0') + '.' + file.ext,
          bytes: new Uint8Array(await file.blob.arrayBuffer()) });
      }
      if (epoch !== state.epoch) return;
      status('正在打包 ZIP…');
      save(packZip(files), 'doubao_images_' + filenameStamp() + '.zip');
      status('ZIP 已开始下载：' + files.length + ' 张');
    } catch (error) {
      if (epoch === state.epoch) status('打包失败：' + error.message);
      console.warn(tag, error);
    } finally { state.busy = false; updateCount(); }
  }

  function styleUI() {
    if (document.getElementById('dbi-style')) return;
    const css = [
      '#dbi-fab{position:fixed!important;left:20px!important;bottom:26px!important;z-index:2147483644!important;background:#18181b!important;color:#fff!important;border:0!important;border-radius:13px!important;padding:13px!important;cursor:pointer!important;font:600 13px sans-serif!important;box-shadow:0 8px 28px #0003!important}',
      '#dbi-panel{position:fixed!important;left:20px!important;bottom:80px!important;z-index:2147483645!important;display:flex!important;flex-direction:column!important;width:380px!important;max-width:calc(100vw - 40px)!important;max-height:min(580px,calc(100vh - 100px))!important;background:#fff!important;color:#222!important;border:1px solid #ddd!important;border-radius:15px!important;overflow:hidden!important;box-shadow:0 16px 48px #0003!important;font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif!important}',
      '#dbi-panel[hidden]{display:none!important}',
      '#dbi-panel *{box-sizing:border-box!important}',
      '#dbi-panel button{cursor:pointer!important}',
      '.dbi-head,.dbi-foot{padding:11px 13px;display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.dbi-head{border-bottom:1px solid #eee}',
      '.dbi-foot{border-top:1px solid #eee}',
      '.dbi-head small{color:#777;font-size:10px}',
      '.dbi-head button,.dbi-foot button{border:1px solid #ddd;border-radius:7px;padding:6px 9px;background:white;color:#222}',
      '.dbi-foot .primary{background:#202020;color:white;border-color:#202020}',
      '.dbi-foot button:disabled{opacity:.5}',
      '#dbi-status{padding:8px 13px;min-height:35px;font-size:12px;color:#666}',
      '#dbi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;overflow:auto;padding:9px 12px;min-height:90px}',
      '.dbi-tile{border:1px solid #e5e5e5;border-radius:10px;overflow:hidden;background:#fafafa}',
      '.dbi-photo{height:130px;position:relative;background:#eee}',
      '.dbi-photo img{width:100%;height:100%;object-fit:contain}',
      '.dbi-photo label{position:absolute;left:6px;top:6px;background:#fffd;border-radius:5px;padding:3px;font-size:11px;color:#222}',
      '.dbi-actions{padding:7px;display:flex;align-items:center;justify-content:space-between}',
      '.dbi-actions span{font-size:11px;color:#666}',
      '.dbi-actions button{padding:5px 9px;color:white;background:#202020;border:0;border-radius:7px;font-size:11px}',
      '.dbi-note{padding:0 12px 11px;font-size:11px;color:#888}',
      '.dbi-img-btn{position:absolute!important;left:8px!important;top:8px!important;z-index:999!important;background:#202020ed!important;color:#fff!important;border:0!important;border-radius:8px!important;padding:7px 9px!important;font:600 12px sans-serif!important;cursor:pointer!important}'
    ].join('\n');
    const style = document.createElement('style');
    style.id = 'dbi-style'; style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }
  function ui() {
    if (document.getElementById('dbi-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'dbi-fab'; fab.type = 'button'; fab.textContent = '🖼️ 原图 0';
    const panel = document.createElement('section');
    panel.id = 'dbi-panel'; panel.hidden = true;
    panel.innerHTML = '<div class="dbi-head"><div><strong>豆包无水印图片</strong> <small>v1.0.1</small></div><button id="dbi-close">关闭</button></div>' +
      '<div id="dbi-status">等待读取无水印原图…</div><div id="dbi-grid"></div>' +
      '<div class="dbi-foot"><button id="dbi-all">全选</button><span id="dbi-count">已选 0</span><button class="primary" id="dbi-zip">下载选中 ZIP</button></div>' +
      '<div class="dbi-note">只保存豆包返回的无水印原图，不裁剪水印。首次安装后请刷新豆包网页。</div>';
    document.documentElement.append(fab, panel);
    fab.addEventListener('click', () => {
      state.opened = !state.opened; panel.hidden = !state.opened; render();
    });
    panel.querySelector('#dbi-close').addEventListener('click', () => {
      state.opened = false; panel.hidden = true;
    });
    panel.querySelector('#dbi-all').addEventListener('click', () => {
      if (resources.size && selected.size === resources.size) selected.clear();
      else { selected.clear(); for (const id of resources.keys()) selected.add(id); }
      render();
    });
    panel.querySelector('#dbi-zip').addEventListener('click', downloadZip);
    render();
  }
  function updateCount() {
    const count = document.getElementById('dbi-count');
    const all = document.getElementById('dbi-all');
    const zip = document.getElementById('dbi-zip');
    if (count) count.textContent = '已选 ' + selected.size + '/' + resources.size;
    if (all) all.textContent = resources.size && selected.size === resources.size ? '取消全选' : '全选';
    if (zip) zip.disabled = state.busy || !selected.size;
  }
  function render() {
    const fab = document.getElementById('dbi-fab'), grid = document.getElementById('dbi-grid');
    if (!fab || !grid) return;
    fab.textContent = '🖼️ 原图 ' + resources.size;
    grid.replaceChildren();
    if (!resources.size) {
      const empty = document.createElement('div');
      empty.style.cssText = 'grid-column:1/-1;text-align:center;padding:25px;color:#888';
      empty.textContent = '还没有捕获到原图。请生成图片，或刷新包含历史生成图的会话。';
      grid.appendChild(empty);
    }
    let number = 0;
    for (const item of resources.values()) {
      const index = ++number;
      const tile = document.createElement('div'), photo = document.createElement('div');
      tile.className = 'dbi-tile'; photo.className = 'dbi-photo';
      const img = document.createElement('img');
      img.src = item.preview; img.loading = 'lazy'; img.alt = '原图 ' + index;
      const label = document.createElement('label'), checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = selected.has(item.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(item.id);
        else selected.delete(item.id);
        updateCount();
      });
      label.append(checkbox, document.createTextNode('选择'));
      photo.append(img, label);
      const actions = document.createElement('div'), title = document.createElement('span'), button = document.createElement('button');
      actions.className = 'dbi-actions'; title.textContent = '无水印原图 ' + index;
      button.textContent = '下载'; button.type = 'button';
      button.addEventListener('click', () => downloadOne(item));
      actions.append(title, button); tile.append(photo, actions); grid.appendChild(tile);
    }
    updateCount();
  }
  function navigation() {
    if (location.href === state.href) return;
    state.href = location.href; state.epoch++;
    resources.clear(); aliases.clear(); selected.clear();
    document.querySelectorAll('.dbi-img-btn').forEach(button => button.remove());
    status('已切换会话，等待图片数据…'); render();
  }
  function boot() {
    styleUI(); ui();
    new MutationObserver(scheduleCards).observe(document.documentElement, { childList: true, subtree: true });
    scheduleCards();
    setInterval(() => { navigation(); scheduleCards(); }, 1500);
    console.info(tag, 'v1.0.1 已启动，不影响视频下载脚本');
  }
  installHooks();
  setInterval(installHooks, 5000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
