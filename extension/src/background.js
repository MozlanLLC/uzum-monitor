// Фоновый скрипт расширения: каждые полчаса открывает страницы товаров (Uzum, Ozon, Wildberries) в свёрнутом окне,
// читает их теми же скриптами web/extract*.js, что и приложение для Android, записывает историю и показывает уведомления.
importScripts('core.js');

const L = chrome.storage.local;
const TIMEOUT_MS = 45000, POLL_MS = 800, PAUSE_MS = 3000, HALF_HOUR = 30 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async key => (await L.get(key))[key];
const getPrefs = async () => (await get('prefs')) || {};

// Все записи идут по очереди, чтобы проверка и действие пользователя не затёрли друг друга.
let chain = Promise.resolve();
function lock(fn) {
  const r = chain.then(fn);
  chain = r.catch(() => {});
  return r;
}

async function setRun(patch) {
  const run = Object.assign({ busy: false, pending: [], next_run: 0 }, await get('run'), patch);
  await L.set({ run });
}

const nextSlot = () => (Math.floor(Date.now() / HALF_HOUR) + 1) * HALF_HOUR;

/** Будильник на ближайшие :00 или :30, дальше каждые полчаса. */
async function schedule() {
  const when = nextSlot();
  const a = await chrome.alarms.get('check');
  if (!a || a.periodInMinutes !== 30 || Math.abs(a.scheduledTime - when) > 60000) {
    await chrome.alarms.create('check', { when, periodInMinutes: 30 });
  }
  await setRun({ next_run: Math.floor(when / 1000) });
}

// ───────── страница, на которой читаются товары ─────────

let work = null;   // {tabId, windowId?}

async function closeTarget(t) {
  if (!t) return;
  try {
    if (t.windowId != null) await chrome.windows.remove(t.windowId);
    else await chrome.tabs.remove(t.tabId);
  } catch (e) { /* уже закрыто */ }
}

/** Открывает страницу там, где она не мешает: в свёрнутом окне или, по настройке, в фоновой вкладке. */
async function openHidden(url) {
  const prefs = await getPrefs();
  let t = null;
  if (!prefs.tab_mode) {
    try {
      const w = await chrome.windows.create({ url, state: 'minimized', type: 'normal' });
      if (w && w.tabs && w.tabs[0]) t = { tabId: w.tabs[0].id, windowId: w.id };
    } catch (e) { /* браузер не умеет сворачивать окна — откроем вкладку */ }
  }
  if (!t) {
    try {
      const tab = await chrome.tabs.create({ url, active: false });
      t = { tabId: tab.id };
    } catch (e) {
      const w = await chrome.windows.create({ url, focused: false, type: 'normal' });   // у браузера нет открытых окон
      t = { tabId: w.tabs[0].id, windowId: w.id };
    }
  }
  try { await chrome.tabs.update(t.tabId, { muted: true }); } catch (e) { /* не страшно */ }
  return t;
}

async function navigate(url) {
  if (work) {
    try {
      await chrome.tabs.update(work.tabId, { url });
      return;
    } catch (e) {
      work = null;   // вкладку закрыли
    }
  }
  work = await openHidden(url);
  await chrome.storage.session.set({ work });
}

async function closeWork() {
  const t = work;
  work = null;
  await closeTarget(t);
  await chrome.storage.session.remove('work');
}

async function readPage(site, skuId) {
  try {
    // нужный размер (Wildberries) скрипт чтения берёт из window.__pmSku
    await chrome.scripting.executeScript({ target: { tabId: work.tabId }, func: sku => { window.__pmSku = sku; }, args: [skuId] });
    const r = await chrome.scripting.executeScript({ target: { tabId: work.tabId }, files: [Core.SITES[site].extract] });
    const v = r && r[0] ? r[0].result : null;
    return typeof v === 'string' ? JSON.parse(v) : null;
  } catch (e) {
    return null;   // страница ещё переходит по ссылке или вкладка закрыта
  }
}

/** Читает карточку товара. Возвращает {status:'ok',res} | {status:'not_found'} | {status:'error',message}. */
async function fetchProduct(p) {
  const site = Core.siteOf(p), productId = Number(p.product_id), skuId = Number(p.sku_id || 0);
  try {
    await navigate(p.url);
  } catch (e) {
    return { status: 'error', message: 'Не удалось открыть страницу товара в браузере.' };
  }
  const deadline = Date.now() + TIMEOUT_MS;
  let last = null, any = null, prevKey = null, stable = 0, notFound = 0;
  await sleep(1500);
  for (;;) {
    const d = await readPage(site, skuId);
    if (d) any = d;
    if (d && Core.pageProductId(site, d.href) === productId) {
      last = d;
      if (d.notFound && d.ready === 'complete') {
        if (++notFound >= 4) return { status: 'not_found' };
      } else if (d.name) {
        // страница может ещё дорисовываться: ждём, пока данные перестанут меняться
        const verdict = Number(d.price) > 0 || !!d.soldOutText;
        const key = Core.stableKey(d);
        if (verdict && key === prevKey) {
          if (++stable >= 3) return Core.finish(d, site, productId, skuId);
        } else {
          stable = 0;
        }
        prevKey = key;
      }
    }
    if (Date.now() > deadline) return Core.onTimeout(last, any, site, productId, skuId);
    await sleep(POLL_MS);
  }
}

// ───────── проверка ─────────

let running = false;
const queue = [];

/** Счётчик непросмотренных изменений на значке расширения: виден, даже если система прячет уведомления. */
async function setBadge(count) {
  await L.set({ badge: count });
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#7000FF' });
    await chrome.action.setBadgeText({ text: count > 0 ? (count > 99 ? '99+' : String(count)) : '' });
  } catch (e) { /* значок недоступен */ }
}

/** Показывает уведомление. Возвращает '' или текст ошибки браузера. */
function show(id, title, message) {
  return new Promise(resolve => {
    try {
      // requireInteraction: уведомление не исчезает само через несколько секунд
      chrome.notifications.create(id, {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/128.png'), title, message, priority: 2, requireInteraction: true,
      }, () => resolve(chrome.runtime.lastError ? String(chrome.runtime.lastError.message) : ''));
    } catch (e) {
      resolve(String(e && e.message));
    }
  });
}

async function notify(product, textMessage) {
  await setBadge(((await get('badge')) || 0) + 1);
  const error = await show('p:' + product.id + ':' + Date.now(), product.name || 'Товар', textMessage);
  if (error) await L.set({ notify_error: error });
}

async function save(id, result) {
  await lock(async () => {
    const p = await get('p:' + id);
    if (!p) return;   // товар удалили, пока шла проверка
    if (result.status === 'ok') {
      const checks = (await get('c:' + id)) || [];
      const r = Core.applyResult(p, checks, result.res, await getPrefs());
      checks.push(r.check);
      await L.set({ ['p:' + id]: r.product, ['c:' + id]: checks });
      if (r.notify) await notify(r.product, r.notify);
    } else if (result.status === 'not_found') {
      if (p.status !== 'not_found') await notify(p, Core.NOT_FOUND);
      await L.set({ ['p:' + id]: Core.withNotFound(p) });
    } else {
      await L.set({ ['p:' + id]: Core.withError(p, result.message || 'Неизвестная ошибка') });
    }
  });
}

async function allIds() {
  const all = await L.get(null);
  return Object.keys(all).filter(k => k.startsWith('p:')).map(k => all[k].id).sort((a, b) => a - b);
}

/** ids — какие товары проверить; пустой список — все. */
async function runChecks(ids) {
  await ready;
  for (const id of ids.length ? ids : await allIds()) if (!queue.includes(id)) queue.push(id);
  if (!queue.length) return;
  await setRun({ busy: true, pending: queue.slice() });
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue[0];
      const p = await get('p:' + id);
      if (p) await save(id, await fetchProduct(p));
      queue.shift();
      await setRun({ busy: true, pending: queue.slice() });
      if (queue.length) await sleep(PAUSE_MS);
    }
  } finally {
    running = false;
    queue.length = 0;
    await closeWork();
    await setRun({ busy: false, pending: [] });
  }
}

// ───────── запуск ─────────

// Фоновый скрипт браузер будит заново при каждом событии. Если он только что запустился,
// прошлая проверка точно не идёт: убираем её следы и окно, которое могло остаться.
const ready = (async () => {
  try {
    const s = await chrome.storage.session.get(['work', 'tmp']);
    await closeTarget(s.work);
    for (const t of s.tmp || []) await closeTarget(t);
    await chrome.storage.session.remove(['work', 'tmp']);
  } catch (e) { /* нечего закрывать */ }
  await setRun({ busy: false, pending: [] });
  await schedule();
})();

chrome.runtime.onInstalled.addListener(() => { ready.then(schedule); });
chrome.runtime.onStartup.addListener(() => {
  // Браузер только что открыли: проверяем, не дожидаясь следующих :00 или :30
  chrome.alarms.create('startup', { delayInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'check') ready.then(() => setRun({ next_run: Math.floor(nextSlot() / 1000) })).then(() => runChecks([]));
  if (alarm.name === 'startup') runChecks([]);
});

chrome.notifications.onClicked.addListener(async nid => {
  const m = /^p:(\d+):/.exec(nid);
  const p = m && await get('p:' + m[1]);
  if (p) chrome.tabs.create({ url: p.url });
  chrome.notifications.clear(nid);
});

// ───────── команды от интерфейса ─────────

async function handle(m) {
  await ready;
  if (m.t === 'add') {
    const p = m.product;
    // ссылку проверяем заново: в хранилище попадает только то, что разобрал сам фоновый скрипт
    const u = Core.parseUrl(p.url);
    await lock(async () => {
      const all = await L.get(null);
      const exists = Object.keys(all).some(k => k.startsWith('p:') && Core.siteOf(all[k]) === u.site
        && Number(all[k].product_id) === u.productId && Number(all[k].sku_id || 0) === u.skuId);
      if (!exists) await L.set({ ['p:' + p.id]: Core.newProduct(u.url, [], Number(p.id)), ['c:' + p.id]: [] });
    });
    runChecks([Number(p.id)]);
    return { ok: true };
  }
  if (m.t === 'del') {
    await lock(() => L.remove(['p:' + m.id, 'c:' + m.id]));
    return { ok: true };
  }
  if (m.t === 'check') {
    runChecks(m.id ? [Number(m.id)] : []);
    return { ok: true };
  }
  if (m.t === 'target') {
    await lock(async () => {
      const p = await get('p:' + m.id);
      if (p) await L.set({ ['p:' + m.id]: Object.assign({}, p, { target_price: m.price > 0 ? Math.trunc(m.price) : null }) });
    });
    return { ok: true };
  }
  if (m.t === 'pref') {
    if (m.key !== 'notify_stock' && m.key !== 'tab_mode') return { ok: false };
    await lock(async () => L.set({ prefs: Object.assign({}, await getPrefs(), { [m.key]: !!m.value }) }));
    return { ok: true };
  }
  if (m.t === 'seen') {
    await setBadge(0);
    return { ok: true };
  }
  if (m.t === 'testnotify') {
    const level = await new Promise(r => chrome.notifications.getPermissionLevel(r));
    const error = await show('test:' + Date.now(), 'Монитор цен', 'Проверка: так выглядит уведомление об изменении цены.');
    return { level, error };
  }
  if (m.t === 'import') {
    return lock(async () => {
      const all = await L.get(null);
      const existing = Object.keys(all).filter(k => k.startsWith('p:')).map(k => all[k]);
      const r = Core.importData(m.data, existing);
      const patch = {};
      for (const it of r.items) { patch['p:' + it.product.id] = it.product; patch['c:' + it.product.id] = it.checks; }
      if (r.items.length) await L.set(patch);
      return { added: r.added, skipped: r.skipped };
    });
  }
  return { ok: false };
}

chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(m).then(send, e => send({ error: e instanceof Core.UserError ? e.message : 'Не получилось: ' + (e && e.message) }));
  return true;
});

// Интерфейс сам открывает скрытые страницы (избранное, диагностика) и сообщает о них сюда.
// Если всплывающее окно закрыли раньше времени, страницу закрываем мы.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'tmp') return;
  let mine = null;
  port.onMessage.addListener(async t => {
    mine = t;
    const s = await chrome.storage.session.get('tmp');
    await chrome.storage.session.set({ tmp: (s.tmp || []).concat([t]) });
  });
  port.onDisconnect.addListener(async () => {
    if (!mine) return;
    await closeTarget(mine);
    const s = await chrome.storage.session.get('tmp');
    await chrome.storage.session.set({ tmp: (s.tmp || []).filter(x => x.tabId !== mine.tabId) });
  });
});
