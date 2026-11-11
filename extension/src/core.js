// Общая логика расширения: разбор ссылок, оценка прочитанной карточки, запись результата проверки,
// резервная копия. Повторяет Store.java и Scraper.java из приложения для Android, чтобы оба вели себя одинаково.
// Подключается в фоновом скрипте (importScripts), на странице интерфейса (<script>) и в тестах (require).
const Core = (() => {
  class UserError extends Error {}

  const LINK = /https?:\/\/(?:www\.)?uzum\.uz\/[^\s"'<>]+/i;
  const BARE = /(?:^|\s)((?:www\.)?uzum\.uz\/[^\s"'<>]+)/i;
  const PRODUCT_PATH = /\/product\/(?:[^\/?#]*?-)?(\d+)\/?(?:[?#].*)?$/;
  const SKU = /[?&]skuId=(\d+)/;
  const IMAGES = 'https://images.uzum.uz/';

  const now = () => Math.floor(Date.now() / 1000);
  const money = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' сум';
  const int = v => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; };
  const posOrNull = n => (n > 0 ? n : null);

  /** Находит ссылку на товар в тексте. */
  function parseUrl(text) {
    const t = (text == null ? '' : String(text)).trim();
    if (!t) throw new UserError('Вставьте ссылку на товар.');
    let url;
    const m = t.match(LINK);
    if (m) {
      url = m[0];
    } else {
      const b = t.match(BARE);
      if (!b) throw new UserError('Это не ссылка на uzum.uz.');
      url = 'https://' + b[1];
    }
    const hash = url.indexOf('#');
    if (hash >= 0) url = url.slice(0, hash);
    const p = url.match(PRODUCT_PATH);
    if (!p) throw new UserError('Не похоже на ссылку товара. Нужна ссылка вида uzum.uz/ru/product/название-123456');
    const s = url.match(SKU);
    const skuId = s ? Number(s[1]) : 0;
    const q = url.indexOf('?');
    let path = (q >= 0 ? url.slice(0, q) : url).replace(/^https?:\/\/(?:www\.)?uzum\.uz/i, 'https://uzum.uz');
    while (path.endsWith('/')) path = path.slice(0, -1);
    return { url: skuId ? path + '?skuId=' + skuId : path, productId: Number(p[1]), skuId };
  }

  const pageProductId = href => { const m = String(href || '').match(PRODUCT_PATH); return m ? Number(m[1]) : -1; };

  /** Номер новой записи: по времени, чтобы интерфейс и фоновый скрипт не выдали одинаковый. */
  function newId(existingIds) {
    const max = Math.max(0, ...existingIds.map(Number).filter(Number.isFinite));
    const t = Date.now();
    return t > max ? t : max + 1;
  }

  const sameProduct = (p, productId, skuId) => Number(p.product_id) === productId && Number(p.sku_id || 0) === skuId;

  function newProduct(text, existing, id) {
    const u = parseUrl(text);
    if (existing.some(p => sameProduct(p, u.productId, u.skuId))) throw new UserError('Этот товар уже отслеживается.');
    return {
      id, url: u.url, product_id: u.productId, sku_id: u.skuId, name: '', image: '', seller: '', variant: '',
      price: null, old_price: null, card_price: null, in_stock: null, stock: null, added_at: now(),
      last_try: null, last_ok: null, status: 'new', error: '', warning: '', target_price: null,
    };
  }

  // ───────── чтение карточки (Scraper.java) ─────────

  /** Ключ «данные перестали меняться»: страница может дорисовываться после загрузки. */
  function stableKey(d) {
    return [d.name, int(d.price), int(d.oldPrice), !!d.canBuy, d.stock == null ? -1 : int(d.stock), d.image,
      d.retailerId, int(d.cardPrice)].join('|');
  }

  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();

  /** Перекрёстные проверки: это точно тот товар? Возвращает {status:'ok',res} или {status:'error',message}. */
  function finish(d, productId, skuId) {
    try {
      const retailer = String(d.retailerId || '');
      if (/^\d+$/.test(retailer) && Number(retailer) !== productId) {
        return { status: 'error', message: 'Данные страницы относятся к другому товару (id ' + retailer + ').' };
      }
      const name = String(d.name || '');
      const ogTitle = norm(d.ogTitle);
      const head = norm(name).slice(0, 40);
      if (ogTitle && !ogTitle.startsWith(head)) {
        return { status: 'error', message: 'Название на странице не совпало со служебным заголовком — данные не записаны.' };
      }
      let warning = '';
      if (skuId > 0) {
        const m = String(d.href || '').match(SKU);
        if (m && Number(m[1]) !== skuId) {
          warning = 'Сайт переключил вариант товара (skuId ' + m[1] + ' вместо ' + skuId + ').';
        }
      }
      const price = int(d.price);
      const inStock = price > 0 && !!d.canBuy && !d.soldOutText;
      let image = String(d.image || '');
      if (!image.startsWith(IMAGES)) image = String(d.ogImage || '');
      if (!image.startsWith(IMAGES)) image = '';
      const card = int(d.cardPrice);
      return {
        status: 'ok',
        res: {
          name, price, old_price: int(d.oldPrice), card_price: card > 0 && card < price ? card : 0, in_stock: inStock,
          stock: !inStock ? 0 : d.stock == null ? null : int(d.stock), image, seller: String(d.seller || ''),
          variant: String(d.variant || ''), warning,
        },
      };
    } catch (e) {
      return { status: 'error', message: 'Не удалось разобрать данные страницы: ' + (e && e.message) };
    }
  }

  /** Время вышло: что делать с тем, что успели прочитать. last — последнее чтение нужного товара, any — любое. */
  function onTimeout(last, any, productId, skuId) {
    if (!last || !last.name) {
      if (any && any.blocked) {
        return { status: 'error', message: 'Сайт показал проверку «вы не робот». Откройте товар в браузере и попробуйте позже.' };
      }
      if (any && pageProductId(any.href) !== productId && String(any.href || '').startsWith('http')) {
        return { status: 'error', message: 'Сайт открыл другую страницу вместо товара.' };
      }
      return { status: 'error', message: 'Карточка товара не загрузилась (нет интернета или сайт недоступен).' };
    }
    if (int(last.price) <= 0 && last.canBuy) return { status: 'error', message: 'Не удалось прочитать цену на странице.' };
    return finish(last, productId, skuId);   // название есть, цены и кнопки «В корзину» нет — товара нет в наличии
  }

  // ───────── результат проверки (Store.saveResult) ─────────

  /** Лучшая доступная цена: с картой Uzum, если она есть и ниже обычной. */
  const best = (price, card) => (card > 0 && card < price ? card : price);

  /**
   * Применяет успешную проверку. Не меняет аргументы; возвращает обновлённый товар, новую запись истории
   * и текст уведомления ('' — не уведомлять).
   */
  function applyResult(product, checks, res, prefs) {
    const prev = checks.length ? checks[checks.length - 1] : null;
    const prevPrice = prev ? int(prev.price) : 0, prevCard = prev ? int(prev.card_price) : 0;
    const prevInStock = !!(prev && prev.in_stock), prevStock = prev && prev.stock != null ? int(prev.stock) : -1;
    let price = int(res.price);
    if (price <= 0 && prev) price = prevPrice;   // товара нет — помним последнюю известную цену
    const oldPrice = int(res.old_price), cardPrice = int(res.card_price);
    const inStock = !!res.in_stock, stock = res.stock == null ? -1 : int(res.stock);

    const target = int(product.target_price);
    const b = best(price, cardPrice), prevBest = best(prevPrice, prevCard);
    const reached = target > 0 && inStock && b > 0 && b <= target;
    const prevReached = target > 0 && prevInStock && prevBest > 0 && prevBest <= target;
    // Задана желаемая цена и она не достигнута — изменения цены пишем в историю, но не уведомляем
    const quiet = target > 0 && !reached;

    const ev = [], nt = [];
    if (!prev) {
      ev.push('Начало наблюдения');
    } else {
      if (prevInStock !== inStock) { const s = inStock ? 'Появился в наличии' : 'Нет в наличии'; ev.push(s); nt.push(s); }
      if (prevPrice > 0 && price > 0 && prevPrice !== price) {
        const pct = (price - prevPrice) * 100 / prevPrice;
        const s = 'Цена ' + (price < prevPrice ? 'снизилась' : 'выросла') + ': ' + money(prevPrice) + ' → ' + money(price)
          + ' (' + (pct > 0 ? '+' : '') + pct.toFixed(1) + '%)';
        ev.push(s); if (!quiet) nt.push(s);
      }
      if (prevCard > 0 && cardPrice > 0 && prevCard !== cardPrice) {
        const s = 'Цена с картой Uzum: ' + money(prevCard) + ' → ' + money(cardPrice);
        ev.push(s); if (!quiet) nt.push(s);
      }
      if (reached && !prevReached) { const s = 'Цена не выше желаемой (' + money(target) + ')'; ev.push(s); nt.push(s); }
      if (prevInStock && inStock && prevStock >= 0 && stock >= 0 && prevStock !== stock) {
        const s = 'Количество: ' + prevStock + ' → ' + stock + ' шт';
        ev.push(s); if (!prefs || prefs.notify_stock !== false) nt.push(s);
      }
    }
    const ts = now(), event = ev.join('; ');
    const check = {
      ts, price: posOrNull(price), old_price: posOrNull(oldPrice), card_price: posOrNull(cardPrice),
      in_stock: inStock ? 1 : 0, stock: stock >= 0 ? stock : null, event,
    };
    const next = Object.assign({}, product, {
      name: res.name || '', seller: res.seller || '', variant: res.variant || '',
      price: check.price, old_price: check.old_price, card_price: check.card_price, in_stock: check.in_stock,
      stock: check.stock, last_try: ts, last_ok: ts, status: 'ok', error: '', warning: res.warning || '',
    });
    if (res.image) next.image = res.image;
    return { product: next, check, event, notify: prev ? nt.join('; ') : '' };
  }

  const withError = (product, message) => Object.assign({}, product, { last_try: now(), status: 'error', error: message });
  const NOT_FOUND = 'Страница товара не найдена — возможно, товар снят с продажи.';
  const withNotFound = product => Object.assign({}, product, { last_try: now(), status: 'not_found', error: NOT_FOUND });

  // ───────── резервная копия: тот же формат, что у приложения для Android ─────────

  const BACKUP_FORMAT = 'uzum-monitor-backup';
  const NUMBERS = ['price', 'old_price', 'card_price', 'in_stock', 'stock'];
  const text = (o, k, max) => { const s = o[k] == null ? '' : String(o[k]); return s.length > max ? s.slice(0, max) : s; };
  const numOrNull = v => (v == null || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));

  function exportData(products, checksById) {
    return {
      format: BACKUP_FORMAT, version: 1, exported_at: now(),
      products: products.slice().sort((a, b) => a.id - b.id).map(p => {
        const o = Object.assign({}, p, { checks: checksById[p.id] || [] });
        delete o.id;
        return o;
      }),
    };
  }

  /** Возвращает {items:[{product,checks}], added, skipped}. Уже отслеживаемые товары пропускает. */
  function importData(data, existing) {
    if (!data || data.format !== BACKUP_FORMAT || !Array.isArray(data.products)) {
      throw new UserError('Это не файл резервной копии Uzum Монитора.');
    }
    const items = [], all = existing.slice();
    let skipped = 0;
    for (const p of data.products) {
      let u = null;
      try { if (p && typeof p === 'object') u = parseUrl(p.url); } catch (e) { /* не ссылка на товар */ }
      if (!u || all.some(x => sameProduct(x, u.productId, u.skuId))) { skipped++; continue; }
      const image = text(p, 'image', 500), status = text(p, 'status', 20);
      const product = {
        id: newId(all.map(x => x.id)), url: u.url, product_id: u.productId, sku_id: u.skuId,
        name: text(p, 'name', 300), image: image.startsWith(IMAGES) ? image : '', seller: text(p, 'seller', 200),
        variant: text(p, 'variant', 200), added_at: numOrNull(p.added_at), last_try: numOrNull(p.last_try),
        last_ok: numOrNull(p.last_ok), target_price: numOrNull(p.target_price),
        status: /^(new|ok|error|not_found)$/.test(status) ? status : 'new', error: text(p, 'error', 500),
        warning: text(p, 'warning', 500),
      };
      for (const k of NUMBERS) product[k] = numOrNull(p[k]);
      const checks = [];
      for (const k of Array.isArray(p.checks) ? p.checks : []) {
        if (!k || typeof k !== 'object' || !(Number(k.ts) > 0)) continue;
        const r = { ts: Math.trunc(Number(k.ts)), event: text(k, 'event', 500) };
        for (const n of NUMBERS) r[n] = numOrNull(k[n]);
        checks.push(r);
      }
      checks.sort((a, b) => a.ts - b.ts);
      items.push({ product, checks });
      all.push(product);
    }
    return { items, added: items.length, skipped };
  }

  return { UserError, parseUrl, pageProductId, newId, newProduct, stableKey, finish, onTimeout, applyResult, withError,
    withNotFound, NOT_FOUND, exportData, importData, money, now };
})();

if (typeof module !== 'undefined') module.exports = Core;
