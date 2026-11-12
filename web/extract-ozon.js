// Чтение карточки товара на ozon.uz. Возвращает те же поля, что extract.js для Uzum.
// Основа — блок данных о товаре, который сайт сам кладёт в страницу (JSON-LD), и блок цены webPrice.
(() => {
  const txt = e => (e ? (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const num = t => { const m = String(t == null ? '' : t).replace(/[\s  ]/g, '').match(/\d+/); return m ? parseInt(m[0], 10) : null; };
  const meta = p => { const m = document.querySelector('meta[property="' + p + '"]'); return m ? (m.getAttribute('content') || '') : ''; };
  const widget = name => document.querySelector('[data-widget="' + name + '"]');

  let ld = null;
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { const j = JSON.parse(s.textContent); if (j && j['@type'] === 'Product') { ld = j; break; } } catch (e) { /* не тот блок */ }
  }
  const offer = (ld && (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers)) || {};
  const ldPrice = offer.price != null && isFinite(parseFloat(offer.price)) ? Math.round(parseFloat(offer.price)) : null;

  // В блоке цены суммы идут по порядку: [с картой Ozon,] обычная, старая
  const priceBox = widget('webPrice');
  const MONEY = /^[\d\s  ]+\s*(so[ʻ'’`]?m|сум|sum|uzs)\.?$/i;
  const sums = priceBox ? [...priceBox.querySelectorAll('span')].filter(s => !s.children.length && MONEY.test(txt(s))).map(s => num(txt(s))).filter(Boolean) : [];
  const withCard = !!priceBox && /карт|kart/i.test(txt(priceBox)) && sums.length >= 2 && sums[0] < sums[1];
  let price = null, cardPrice = null, oldPrice = null;
  if (withCard) { cardPrice = sums[0]; price = sums[1]; oldPrice = sums[2] > price ? sums[2] : null; }
  else if (sums.length) { price = sums[0]; oldPrice = sums[1] > price ? sums[1] : null; }
  else price = ldPrice;

  const soldOut = !!widget('webOutOfStock') || /OutOfStock|SoldOut|Discontinued/i.test(offer.availability || '');
  const cart = widget('webAddToCart');
  const canBuy = !soldOut && (!!(cart && cart.querySelector('button')) || /InStock/i.test(offer.availability || ''));

  // Остаток сайт показывает не всегда — например, «1575 единиц осталось» на распродаже
  let stock = null;
  for (const w of [widget('bigPromoPDP'), widget('webSale')]) {
    const t = txt(w);
    const m = t.match(/(\d[\d\s  ]*)\s*(?:единиц\S*|ед\.?|шт\.?)\s*остал/i) || t.match(/остал\S*\s+(\d[\d\s  ]*)\s*(?:шт|ед)/i);
    if (m) { stock = num(m[1]); break; }
  }

  const heading = widget('webProductHeading');
  const name = txt(heading && heading.querySelector('h1')) || txt(document.querySelector('h1')) || String((ld && ld.name) || '');
  const sellerLink = [...document.querySelectorAll('a[href*="/seller/"]')].find(a => txt(a));
  const image = ld ? String(Array.isArray(ld.image) ? ld.image[0] || '' : ld.image || '') : '';
  const top = (document.title + ' ' + (document.body ? document.body.innerText.slice(0, 400) : '')).replace(/\s+/g, ' ');

  return JSON.stringify({
    href: location.href,
    ready: document.readyState,
    name,
    price,
    oldPrice,
    cardPrice,
    image,
    ogImage: meta('og:image'),
    seller: txt(sellerLink),
    variant: '',
    stock: canBuy ? stock : null,
    canBuy,
    soldOutText: soldOut,
    ogTitle: meta('og:title'),
    retailerId: String((ld && ld.sku) || ''),
    notFound: !name && !ld && (!!widget('error') || /не существует|не найден|ошибка 404|page not found/i.test(top)),
    blocked: !name && /antibot|challenge|доступ ограничен|access denied|не робот|не бот/i.test(top),
  });
})()
