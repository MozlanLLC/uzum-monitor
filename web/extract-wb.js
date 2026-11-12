// Чтение карточки товара на wildberries.uz. Возвращает те же поля, что extract.js для Uzum, плюс список размеров.
// Страница сама запрашивает данные товара (с вашим городом и скидкой) — скрипт повторяет тот же запрос.
// Нужный размер приложение передаёт в window.__pmSku (0 — не выбран).
(() => {
  const W = window;
  const txt = e => (e ? (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const num = t => { const m = String(t == null ? '' : t).replace(/[\s  ]/g, '').match(/\d+/); return m ? parseInt(m[0], 10) : null; };
  const meta = p => { const m = document.querySelector('meta[property="' + p + '"]'); return m ? (m.getAttribute('content') || '') : ''; };
  const nm = (location.pathname.match(/\/catalog\/(\d+)\/detail/) || [])[1] || '';
  const st = W.__pm && W.__pm.nm === nm ? W.__pm : (W.__pm = { nm, data: null, busy: false, tries: 0, t0: Date.now() });

  if (nm && !st.data && !st.busy && st.tries < 4) {
    const mine = new RegExp('[?&]nm=(?:[^&]*[;,])?' + nm + '(?:[;,&]|$)');
    const url = performance.getEntriesByType('resource').map(e => e.name)
      .filter(u => /\/cards\/v\d+\/detail/.test(u) && mine.test(u)).pop();
    let ok = false;
    try { const h = new URL(url).hostname; ok = h === location.hostname || /(^|\.)wb\.ru$/.test(h); } catch (e) { /* адреса ещё нет */ }
    if (ok) {
      st.busy = true; st.tries++;
      fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).then(j => { if (j) st.data = j; })
        .catch(() => {}).then(() => { st.busy = false; });
    }
  }

  const list = st.data ? st.data.products || (st.data.data && st.data.data.products) || [] : null;
  const p = list ? list.find(x => String(x.id) === nm) : null;
  const qty = s => (s.stocks || []).reduce((a, x) => a + (Number(x.qty) || 0), 0);
  // На сайте цена — это цена товара плюс доставка; в данных они в сотых долях сума
  const total = (pr, field) => (pr && pr[field] > 0 ? Math.round((pr[field] + (pr.logistics || 0)) / 100) : null);
  const sizes = p ? (p.sizes || []).map(s => ({
    id: Number(s.optionId) || 0, name: String(s.name || s.origName || '').slice(0, 40), price: total(s.price, 'product'),
    old: s.price && s.price.basic > 0 ? Math.round(s.price.basic / 100) : null,
    card: s.price && s.price.wallet > 0 && s.price.wallet < s.price.product ? total(s.price, 'wallet') : null, qty: qty(s),
  })) : [];
  const want = Number(W.__pmSku) || 0;
  const chosen = want ? sizes.find(s => s.id === want) : sizes.find(s => s.qty > 0 && s.price) || sizes.find(s => s.price) || sizes[0];
  const top = (document.title + ' ' + (document.body ? document.body.innerText.slice(0, 400) : '')).replace(/\s+/g, ' ');
  const ogImage = meta('og:image').split('?')[0];

  let name = '', price = null, oldPrice = null, cardPrice = null, stock = null, canBuy = false, soldOut = false, warning = '';
  if (p) {
    name = String(p.name || '');
    if (chosen) {
      price = chosen.price; oldPrice = chosen.old > price ? chosen.old : null; cardPrice = chosen.card;
      stock = chosen.qty; canBuy = chosen.qty > 0 && price > 0; soldOut = !canBuy;
    } else {
      soldOut = true;
      if (want) warning = 'Выбранного размера больше нет в карточке товара.';
    }
  } else if (!st.data && !st.busy && document.readyState === 'complete' && (st.tries >= 1 || Date.now() - st.t0 > 12000)) {
    // Данные получить не удалось — читаем то, что видно на странице
    name = meta('og:title');
    price = num(txt(document.querySelector('ins')));
    canBuy = [...document.querySelectorAll('button')].some(b => /в корзину|savatga/i.test(txt(b)));
  }

  return JSON.stringify({
    href: location.href,
    ready: document.readyState,
    name,
    price,
    oldPrice,
    cardPrice,
    image: ogImage,
    ogImage,
    seller: p ? String(p.supplier || p.brand || '') : '',
    variant: p && sizes.length > 1 && chosen ? chosen.name : '',
    stock: canBuy ? stock : null,
    canBuy,
    soldOutText: soldOut,
    ogTitle: p ? meta('og:title') : '',
    retailerId: p ? String(p.id) : nm,
    sizes: sizes.length > 1 ? sizes.slice(0, 60) : null,
    warning,
    notFound: !!list && !p && document.readyState === 'complete',
    blocked: !name && !st.data && /почти готово|подозрительн|captcha|не робот|доступ ограничен/i.test(top),
  });
})()
