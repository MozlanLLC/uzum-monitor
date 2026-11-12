// Подставляет интерфейсу (web/ui.html) объект window.Android — тот же набор функций, что даёт приложение
// для Android (Bridge.java), но на средствах браузера. Данные лежат в chrome.storage.local, пишет их
// только фоновый скрипт; здесь хранится копия для мгновенного показа.
(() => {
  const L = chrome.storage.local;
  const isTab = /[?&]tab=1/.test(location.search);
  document.documentElement.classList.add('ext', isTab ? 'tab' : 'popup');

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const send = m => chrome.runtime.sendMessage(m).catch(() => null);
  const RUN0 = { busy: false, pending: [], next_run: 0 };
  const cache = { p: {}, c: {}, run: RUN0, prefs: {} };

  function put(key, value) {
    if (key.startsWith('p:')) { if (value === undefined) delete cache.p[key.slice(2)]; else cache.p[key.slice(2)] = value; }
    else if (key.startsWith('c:')) { if (value === undefined) delete cache.c[key.slice(2)]; else cache.c[key.slice(2)] = value; }
    else if (key === 'run') cache.run = value || RUN0;
    else if (key === 'prefs') cache.prefs = value || {};
  }
  const redraw = force => { if (typeof window.refresh === 'function') window.refresh(force); };

  L.get(null).then(all => {
    for (const k in all) put(k, all[k]);
    redraw(true);
    send({ t: 'seen' });   // окно открыли — изменения увидены, счётчик на значке сбрасываем
    const go = /[?&]go=(\w+)/.exec(location.search);
    const b = go && document.querySelector('[data-tab="' + go[1] + '"]');
    if (b) b.click();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const k in changes) put(k, changes[k].newValue);
    redraw(false);
  });

  const products = () => Object.values(cache.p).sort((a, b) => b.id - a.id);

  function toast(message) {
    let el = document.getElementById('exttoast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'exttoast';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:84px;z-index:20;background:var(--ink);color:var(--bg);'
        + 'padding:12px 14px;border-radius:12px;font-size:14px;text-align:center;max-width:448px;margin:0 auto';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 5000);
  }

  // ───────── скрытая страница для избранного и диагностики ─────────

  async function openHidden(url) {
    let t = null;
    if (!cache.prefs.tab_mode) {
      try {
        const w = await chrome.windows.create({ url, state: 'minimized', type: 'normal' });
        if (w && w.tabs && w.tabs[0]) t = { tabId: w.tabs[0].id, windowId: w.id };
      } catch (e) { /* откроем вкладку */ }
    }
    if (!t) {
      const tab = await chrome.tabs.create({ url, active: false });
      t = { tabId: tab.id };
    }
    try { await chrome.tabs.update(t.tabId, { muted: true }); } catch (e) { /* не страшно */ }
    return t;
  }

  /** Выполняет функцию на странице uzum.uz, пока та не вернёт строку (как PageRunner.java). */
  async function runFn(url, fn, cb) {
    let target = null, result = null;
    const port = chrome.runtime.connect({ name: 'tmp' });
    try {
      if (!/^https:\/\/(www\.)?uzum\.uz\//.test(url)) throw new Error('not uzum');
      target = await openHidden(url);
      port.postMessage(target);
      const deadline = Date.now() + 35000;
      await sleep(1500);
      while (Date.now() < deadline) {
        let v = null;
        try {
          const r = await chrome.scripting.executeScript({ target: { tabId: target.tabId }, func: fn });
          v = r && r[0] ? r[0].result : null;
        } catch (e) { /* страница ещё загружается */ }
        if (typeof v === 'string') { result = v; break; }
        await sleep(800);
      }
    } catch (e) { /* результат останется пустым */ }
    port.disconnect();   // фоновый скрипт закроет скрытую страницу
    cb(result);
  }

  // ───────── резервная копия ─────────

  function exportData() {
    const data = Core.exportData(Object.values(cache.p), cache.c);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = 'uzum-monitor-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast('Сохранено товаров: ' + data.products.length);
  }

  function importData() {
    // Окно выбора файла закрывает всплывающее окно расширения, поэтому загрузка идёт в отдельной вкладке.
    if (!isTab) { chrome.tabs.create({ url: chrome.runtime.getURL('ui.html?tab=1&go=settings') }); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 30 * 1024 * 1024) { toast('Файл слишком большой для резервной копии'); return; }
      let data = null;
      try { data = JSON.parse(await file.text()); } catch (e) { /* не JSON */ }
      const r = data ? await send({ t: 'import', data }) : null;
      if (!r || r.error) toast((r && r.error) || 'Это не файл резервной копии Uzum Монитора.');
      else toast('Загружено товаров: ' + r.added + (r.skipped ? ', пропущено (уже есть или не подошли): ' + r.skipped : ''));
    });
    input.click();
  }

  // ───────── то, что видит интерфейс ─────────

  window.Android = {
    platform: 'ext',

    getState() {
      const list = products().map(p => {
        const checks = cache.c[p.id] || [], prices = checks.filter(k => k.price != null).map(k => k.price);
        return Object.assign({}, p, {
          min_price: prices.length ? Math.min(...prices) : null, max_price: prices.length ? Math.max(...prices) : null,
          first_price: prices.length ? prices[0] : null, checks_count: checks.length,
        });
      });
      return JSON.stringify({
        products: list, busy: !!cache.run.busy, pending: cache.run.pending || [], next_run: cache.run.next_run || 0,
        now: Math.floor(Date.now() / 1000),
        info: {
          platform: 'ext', app: chrome.runtime.getManifest().version, web: typeof BUILD === 'object' ? BUILD.web : '',
          notif: true, battery: true, exact: true, notify_stock: cache.prefs.notify_stock !== false,
          tab_mode: !!cache.prefs.tab_mode,
        },
      });
    },
    getHistory(id) { return JSON.stringify({ checks: cache.c[id] || [] }); },

    addProduct(textValue) {
      try {
        const list = products();
        const p = Core.newProduct(textValue, list, Core.newId(list.map(x => x.id)));
        cache.p[p.id] = p;
        cache.c[p.id] = [];
        send({ t: 'add', product: p });
        return JSON.stringify({ id: p.id });
      } catch (e) {
        return JSON.stringify({ error: e instanceof Core.UserError ? e.message : 'Не удалось добавить товар.' });
      }
    },
    deleteProduct(id) { delete cache.p[id]; delete cache.c[id]; send({ t: 'del', id }); },
    check(id) { send({ t: 'check', id }); },
    setTarget(id, price) {
      if (cache.p[id]) cache.p[id] = Object.assign({}, cache.p[id], { target_price: price > 0 ? Math.trunc(price) : null });
      send({ t: 'target', id, price });
    },
    setPref(key, value) { cache.prefs = Object.assign({}, cache.prefs, { [key]: value === '1' }); send({ t: 'pref', key, value: value === '1' }); },

    openSettings() {},
    openUrl(url) { if (/^https:\/\//.test(url)) chrome.tabs.create({ url }); },
    openUzum(url) { this.openUrl(url); },
    openTab() { chrome.tabs.create({ url: chrome.runtime.getURL('ui.html?tab=1') }); },
    copy(textValue) { navigator.clipboard.writeText(textValue).catch(() => {}); },
    runOnPage() {},   // в расширении вместо строки со скриптом передаётся сама функция: см. runFn
    runFn,
    /** Ссылка на товар, открытый в текущей вкладке браузера. */
    currentUrl(cb) {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(tabs => {
        const url = tabs[0] && tabs[0].url;
        try { cb(url ? Core.parseUrl(url).url : ''); } catch (e) { cb(''); }
      }, () => cb(''));
    },
    exportData,
    importData,
    testNotify() {
      send({ t: 'testnotify' }).then(r => {
        if (!r || r.error || r.level === 'denied') toast('Браузер не смог показать уведомление' + (r && r.error ? ': ' + r.error : '') + '. Проверьте, что уведомления для него разрешены в системе.');
        else toast('Уведомление отправлено. Если вы его не увидели — оно скрыто настройками системы, см. подсказку выше.');
      });
    },
  };

  // Ссылки открываем в новой вкладке браузера, а не внутри окна расширения.
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.hasAttribute('download')) return;
    e.preventDefault();
    window.Android.openUrl(a.href);
  });
})();
