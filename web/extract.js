(() => {
  // Читает карточку ОСНОВНОГО товара на странице uzum.uz (мобильная и настольная вёрстка).
  // Блоки находятся по data-test-id, поэтому «похожие товары» в результат не попадают.
  const q = s => document.querySelector('[data-test-id="' + s + '"]');
  const qa = s => [...document.querySelectorAll('[data-test-id="' + s + '"]')];
  const meta = p => { const m = document.querySelector('meta[property="' + p + '"]'); return m ? (m.content || '') : ''; };
  const num = t => { const m = (t || '').replace(/[\s   ]/g, '').match(/\d+/); return m ? parseInt(m[0], 10) : null; };
  const txt = e => e ? (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : '';

  const nameEl = q('text__product-name');
  const priceEl = q('text__product-price');
  const price = priceEl ? num(txt(priceEl)) : null;

  let oldPrice = null;
  const oldEl = q('text__product-old-price');
  if (oldEl) {
    const n = num(txt(oldEl));
    if (n && price && n > price) oldPrice = n;
  } else if (priceEl && price) {
    const box = priceEl.closest('.price') || priceEl.parentElement;
    if (box) {
      for (const e of box.querySelectorAll('*')) {
        if (priceEl.contains(e) || e.contains(priceEl)) continue;
        const t = txt(e);
        if (/^[\d\s  ]+\s*(сум|so.m)?$/i.test(t)) {
          const n = num(t);
          if (n && n > price && (oldPrice === null || n < oldPrice)) oldPrice = n;
        }
      }
    }
  }

  let image = '';
  const photos = q('block__product-photos');
  if (photos) {
    const img = photos.querySelector('img.active') || photos.querySelector('img');
    if (img) image = img.currentSrc || img.getAttribute('src') || '';
  }
  const ogImage = meta('og:image');

  const banners = qa('text__product-banner').map(txt);
  let stock = null;
  const amountEl = document.querySelector('[availableamount]');
  if (amountEl && /^\d+$/.test(amountEl.getAttribute('availableamount') || '')) {
    stock = parseInt(amountEl.getAttribute('availableamount'), 10);
  } else {
    for (const b of banners) {
      const m = b.match(/(?:Можно купить|Остал[оа]сь|Sotuvda|Xarid qilish mumkin)\D{0,12}(\d+)/i);
      if (m) { stock = parseInt(m[1], 10); break; }
    }
  }

  const cartWrap = q('button__add-to-cart');
  const cartBtn = cartWrap ? (cartWrap.querySelector('button') || cartWrap) : null;
  const canBuy = !!cartBtn && !cartBtn.disabled;

  const zone = txt(q('block__main-info')) + ' ' + txt(nameEl ? nameEl.parentElement : null) + ' ' +
    txt(priceEl ? (priceEl.closest('.price') || priceEl.parentElement).parentElement : null);
  const soldOutText = /нет в наличии|закончился|распродан|sotuvda yo.q|tugadi/i.test(zone);

  const bodyText = txt(document.body).slice(0, 4000);
  const notFound = !nameEl && /не найден|не существует|topilmadi|mavjud emas/i.test(bodyText);
  const blocked = !nameEl && /captcha|вы не робот|access denied|доступ ограничен/i.test(bodyText);

  return JSON.stringify({
    href: location.href,
    ready: document.readyState,
    name: txt(nameEl),
    price: price, oldPrice: oldPrice, image: image, ogImage: ogImage,
    seller: txt(q('text__shop-title')),
    variant: txt(q('text__selected-sku-value')),
    stock: stock, canBuy: canBuy, soldOutText: soldOutText,
    ogTitle: meta('og:title'),
    retailerId: meta('product:retailer_item_id'),
    notFound: notFound, blocked: blocked
  });
})()
