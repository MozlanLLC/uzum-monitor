// Чтение карточки товара на mcosmetic.uz. Возвращает те же поля, что extract.js для Uzum,
// плюс кешбэк в процентах и список вариантов (оттенок, объём).
// Сайт кладёт в страницу готовый блок данных window.__INITIAL_STATE__ — скрипт читает его из текста страницы,
// потому что в расширении переменные страницы скрипту не видны. Нужный вариант передаётся в window.__pmSku.
(() => {
  const W = window;
  const txt = e => (e ? (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const cents = v => (Number(v) > 0 ? Math.round(Number(v) / 100) : null);   // цены в данных — в сотых долях сума

  let S = null;
  for (const s of document.querySelectorAll('script:not([src])')) {
    const t = s.textContent;
    const i = t.indexOf('__INITIAL_STATE__');
    if (i < 0) continue;
    const start = t.indexOf('{', i);
    try { S = JSON.parse(t.slice(start).trim().replace(/;\s*$/, '')); } catch (e) { /* блок ещё не дописан */ }
    break;
  }
  const P = S && S.product && S.product.offers ? S.product : null;
  const O = P ? P.offers[0] || null : null;

  const want = String(Number(W.__pmSku) || '');
  const stockOf = o => (o && Array.isArray(o.stocks) ? o.stocks.reduce((a, x) => a + (Number(x.stock) || 0), 0) : 0);
  const variantName = values => Object.keys(values || {}).map(k => String(values[k])).filter(Boolean).join(', ');
  const ownVariant = O ? variantName(Object.fromEntries((O.properties || []).filter(p => p.isOfferVariants)
    .map(p => [p.code, Array.isArray(p.values) && p.values.length ? p.values.join(', ') : p.value]))) : '';

  // Варианты: текущий и соседние. Цена у соседних в данных не указана — её покажет проверка после выбора.
  const others = P && Array.isArray(P.variantOffers) ? P.variantOffers : [];
  const sizes = O && others.length ? [{ id: Number(O.code) || 0, name: ownVariant.slice(0, 40), price: cents(O.discountPrice || O.price), qty: stockOf(O) }]
    .concat(others.map(v => ({ id: Number(v.sku) || 0, name: variantName(v.values).slice(0, 40), price: null, qty: stockOf(v) })))
    .filter(v => v.id > 0) : null;

  // Значки товара: «Кешбэк 15%» — кешбэк, остальные (например «Финальная цена») — метки
  let cashback = 0;
  const labels = [];
  for (const b of (O && O.badges) || []) {
    const name = String(b.name || '').replace(/\s+/g, ' ').trim(), code = String(b.code || '');
    if (/кешб|кэшб|keshb|cashback/i.test(name + ' ' + code)) {
      const m = name.match(/(\d{1,2})\s*%/) || code.match(/(\d{1,2})$/);
      if (m && !cashback) cashback = Number(m[1]);
    } else if (name && !/^-?\d+\s*%$/.test(name) && labels.indexOf(name) < 0) {
      labels.push(name);
    }
  }

  let price = null, oldPrice = null, stock = null, canBuy = false, warning = '';
  if (O) {
    price = cents(O.discountPrice || O.price);
    const full = cents(O.price);
    oldPrice = full && price && full > price ? full : null;
    stock = stockOf(O);
    canBuy = !!price && (stock > 0 || !!O.isBackorderAvailable);
    if (want && String(O.code) !== want) warning = 'Выбранного варианта больше нет в карточке товара.';
  }
  const h1 = txt(document.querySelector('h1'));
  let image = '';
  for (const im of [].concat((O && O.images) || [], (P && P.images) || [])) { if (im && im.url) { image = String(im.url); break; } }

  return JSON.stringify({
    href: location.href,
    ready: document.readyState,
    name: P ? h1 || String((O && O.name) || P.name || '') : '',
    price,
    oldPrice,
    cardPrice: null,
    image,
    ogImage: '',
    seller: '',
    variant: others.length ? ownVariant : '',
    stock: canBuy ? stock : null,
    canBuy,
    soldOutText: !!O && !canBuy,
    ogTitle: '',
    retailerId: P ? String(P.id) : '',
    sizes: sizes && sizes.length > 1 ? sizes.slice(0, 60) : null,
    cashback,
    label: labels.slice(0, 2).join(', ').slice(0, 60),
    warning,
    notFound: !!S && !P && document.readyState === 'complete',
    blocked: !S && /challenge|не робот|captcha/i.test(document.title),
  });
})()
