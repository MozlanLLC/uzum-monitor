// Проверка общей логики расширения. Запуск: node extension/test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const Core = createRequire(import.meta.url)('./src/core.js');
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

test('ссылки на товар', () => {
  assert.deepEqual(Core.parseUrl('https://uzum.uz/ru/product/detskoe-sidene-na-1792401?skuId=9514199'),
    { site: 'uzum', url: 'https://uzum.uz/ru/product/detskoe-sidene-na-1792401?skuId=9514199', productId: 1792401, skuId: 9514199 });
  assert.deepEqual(Core.parseUrl('Смотри: http://www.uzum.uz/ru/product/shina-777/?utm=1#x'),
    { site: 'uzum', url: 'https://uzum.uz/ru/product/shina-777', productId: 777, skuId: 0 });
  assert.equal(Core.parseUrl('uzum.uz/product/555').productId, 555);
  assert.throws(() => Core.parseUrl(''), /Вставьте ссылку/);
  assert.throws(() => Core.parseUrl('https://example.com/product/a-1'), /не ссылка на Uzum, Ozon, Wildberries или MCosmetic/);
  assert.throws(() => Core.parseUrl('https://uzum.uz/ru/wishes'), /Не похоже на ссылку товара/);
  assert.throws(() => Core.parseUrl('https://uzum.uz.evil.com/ru/product/a-1'), /не ссылка на|Не похоже/);
});

test('ссылки Ozon и Wildberries', () => {
  assert.deepEqual(Core.parseUrl('https://www.ozon.uz/product/maslo-dlya-dereva-elcon-sauna-oil-1-l-205795591/?at=1hWr1ZNj&sh=0anwq-RgiA'),
    { site: 'ozon', url: 'https://www.ozon.uz/product/maslo-dlya-dereva-elcon-sauna-oil-1-l-205795591/', productId: 205795591, skuId: 0 });
  assert.equal(Core.parseUrl('ozon.uz/product/205795591').url, 'https://www.ozon.uz/product/205795591/');
  assert.throws(() => Core.parseUrl('https://ozon.uz/t/AbCdEf'), /ozon\.uz\/product/);
  assert.deepEqual(Core.parseUrl('https://www.wildberries.uz/catalog/262053841/detail.aspx?targetUrl=MI'),
    { site: 'wb', url: 'https://www.wildberries.uz/catalog/262053841/detail.aspx', productId: 262053841, skuId: 0 });
  assert.deepEqual(Core.parseUrl('wildberries.uz/catalog/262053841/detail.aspx?size=407086462&targetUrl=GP'),
    { site: 'wb', url: 'https://www.wildberries.uz/catalog/262053841/detail.aspx?size=407086462', productId: 262053841, skuId: 407086462 });
  assert.throws(() => Core.parseUrl('https://www.wildberries.uz/catalog/obuv'), /wildberries\.uz\/catalog/);
  assert.equal(Core.pageProductId('ozon', 'https://www.ozon.uz/product/a-b-205795591/?__rr=1&sh=x'), 205795591);
  assert.equal(Core.pageProductId('wb', 'https://www.wildberries.uz/catalog/262053841/detail.aspx?size=1'), 262053841);
  assert.equal(Core.pageProductId('wb', 'https://www.wildberries.uz/'), -1);
  assert.equal(Core.pageProductId('uzum', 'https://uzum.uz/ru/product/a-10?skuId=3'), 10);
  assert.ok(Core.allowedUrl('https://www.ozon.uz/')); assert.ok(Core.allowedUrl('https://uzum.uz/ru/wishes'));
  assert.ok(!Core.allowedUrl('http://uzum.uz/')); assert.ok(!Core.allowedUrl('https://ozon.uz.evil.com/')); assert.ok(!Core.allowedUrl('https://example.com/'));
  // одинаковые номера на разных сайтах — разные товары
  const a = Core.newProduct('https://www.ozon.uz/product/x-10/', [], 1);
  assert.equal(a.site, 'ozon');
  assert.equal(Core.newProduct('https://uzum.uz/ru/product/x-10', [a], 2).site, 'uzum');
  assert.throws(() => Core.newProduct('https://ozon.uz/product/drugoe-10/', [a], 3), /уже отслеживается/);
  // товары, сохранённые до появления других сайтов, считаются товарами Uzum
  const old = Object.assign(Core.newProduct('https://uzum.uz/ru/product/y-20', [], 4), { site: undefined });
  assert.throws(() => Core.newProduct('https://uzum.uz/ru/product/y-20', [old], 5), /уже отслеживается/);
});

test('новый товар и повтор', () => {
  const p = Core.newProduct('https://uzum.uz/ru/product/a-10?skuId=3', [], 1);
  assert.equal(p.product_id, 10); assert.equal(p.sku_id, 3); assert.equal(p.status, 'new');
  assert.throws(() => Core.newProduct('uzum.uz/ru/product/drugoe-imya-10?skuId=3', [p], 2), /уже отслеживается/);
  assert.equal(Core.newProduct('uzum.uz/ru/product/a-10?skuId=4', [p], 2).sku_id, 4);
  const id = Core.newId([p.id, 5e15]);
  assert.equal(id, 5e15 + 1);
});

const page = over => Object.assign({ href: 'https://uzum.uz/ru/product/a-10?skuId=3', ready: 'complete', name: 'Товар', price: 1000,
  oldPrice: 1500, cardPrice: 900, image: 'https://images.uzum.uz/x.jpg', ogImage: '', seller: 'Магазин', variant: 'Серый',
  stock: 7, canBuy: true, soldOutText: false, ogTitle: 'Товар', retailerId: '10', notFound: false, blocked: false }, over);

test('оценка прочитанной карточки', () => {
  const ok = Core.finish(page(), 'uzum', 10, 3);
  assert.equal(ok.status, 'ok');
  assert.deepEqual(ok.res, { name: 'Товар', price: 1000, old_price: 1500, card_price: 900, in_stock: true, stock: 7,
    image: 'https://images.uzum.uz/x.jpg', seller: 'Магазин', variant: 'Серый', warning: '', sizes: null, cashback: 0, label: '' });
  assert.match(Core.finish(page({ retailerId: '11' }), 'uzum', 10, 3).message, /другому товару/);
  assert.match(Core.finish(page({ ogTitle: 'Совсем другое' }), 'uzum', 10, 3).message, /не совпало/);
  assert.match(Core.finish(page({ href: 'https://uzum.uz/ru/product/a-10?skuId=4' }), 'uzum', 10, 3).res.warning, /переключил вариант/);
  const out = Core.finish(page({ canBuy: false, price: null, stock: null }), 'uzum', 10, 3).res;
  assert.equal(out.in_stock, false); assert.equal(out.stock, 0);
  assert.equal(Core.finish(page({ image: 'https://evil.example/x.jpg' }), 'uzum', 10, 3).res.image, '');
  assert.equal(Core.finish(page({ cardPrice: 1200 }), 'uzum', 10, 3).res.card_price, 0);
});

test('карточки Ozon и Wildberries', () => {
  const oz = Core.finish(page({ href: 'https://www.ozon.uz/product/a-205/', image: 'https://ir-3.ozone.ru/s3/m/1.jpg', retailerId: '205', variant: '' }), 'ozon', 205, 0);
  assert.equal(oz.status, 'ok'); assert.equal(oz.res.image, 'https://ir-3.ozone.ru/s3/m/1.jpg');
  assert.equal(Core.finish(page({ image: 'https://images.uzum.uz/x.jpg', retailerId: '205' }), 'ozon', 205, 0).res.image, '', 'чужой адрес картинки не принимаем');
  const sizes = [{ id: 1, name: '42', price: 900, qty: 0 }, { id: 2, name: '43', price: 1000, qty: 7 }, { id: 0, name: 'x' }, null];
  const wb = Core.finish(page({ href: 'https://www.wildberries.uz/catalog/262/detail.aspx', image: 'https://basket-16.wbbasket.ru/vol2620/1.webp',
    retailerId: '262', variant: '43', sizes, warning: 'Проверка' }), 'wb', 262, 2);
  assert.equal(wb.status, 'ok'); assert.equal(wb.res.warning, 'Проверка', 'skuId в ссылке сверяется только у Uzum');
  assert.deepEqual(wb.res.sizes, [{ id: 1, name: '42', price: 900, qty: 0 }, { id: 2, name: '43', price: 1000, qty: 7 }]);
  assert.equal(Core.finish(page({ retailerId: '262', sizes: [{ id: 1, name: 'one', price: 5, qty: 1 }] }), 'wb', 262, 0).res.sizes, null, 'один размер — выбирать нечего');
  let p = Core.newProduct('https://www.wildberries.uz/catalog/262/detail.aspx', [], 1);
  const r = Core.applyResult(p, [], wb.res, {});
  assert.equal(r.product.sizes.length, 2); assert.equal(r.product.site, 'wb');
});

test('время вышло', () => {
  assert.match(Core.onTimeout(null, { blocked: true }, 'uzum', 10, 0).message, /не робот/);
  assert.match(Core.onTimeout(null, { href: 'https://uzum.uz/ru' }, 'uzum', 10, 0).message, /другую страницу/);
  assert.match(Core.onTimeout(null, { href: 'https://www.ozon.uz/' }, 'ozon', 10, 0).message, /другую страницу/);
  assert.match(Core.onTimeout(null, null, 'wb', 10, 0).message, /не загрузилась/);
  assert.match(Core.onTimeout(page({ price: null }), null, 'uzum', 10, 3).message, /прочитать цену/);
  assert.equal(Core.onTimeout(page({ price: null, canBuy: false }), null, 'uzum', 10, 3).status, 'ok');
});

test('изменения и уведомления', () => {
  let p = Core.newProduct('https://uzum.uz/ru/product/a-10?skuId=3', [], 1), checks = [];
  const step = (res, prefs) => { const r = Core.applyResult(p, checks, Object.assign({ name: 'Товар', price: 1000, old_price: 0,
    card_price: 0, in_stock: true, stock: 5, image: '', seller: '', variant: '', warning: '' }, res), prefs || {});
    p = r.product; checks = checks.concat([r.check]); return r; };
  let r = step({});
  assert.equal(r.event, 'Начало наблюдения'); assert.equal(r.notify, ''); assert.equal(p.status, 'ok'); assert.equal(p.price, 1000);
  r = step({});
  assert.equal(r.event, ''); assert.equal(r.notify, '');
  r = step({ price: 900 });
  assert.equal(r.notify, 'Цена снизилась: 1 000 сум → 900 сум (-10.0%)');
  r = step({ price: 990 });
  assert.equal(r.notify, 'Цена выросла: 900 сум → 990 сум (+10.0%)');
  r = step({ price: 990, stock: 3 });
  assert.equal(r.notify, 'Количество: 5 → 3 шт');
  r = step({ price: 990, stock: 2 }, { notify_stock: false });
  assert.equal(r.event, 'Количество: 3 → 2 шт'); assert.equal(r.notify, '');
  r = step({ price: 0, in_stock: false, stock: 0 });
  assert.equal(r.notify, 'Нет в наличии'); assert.equal(p.price, 990); assert.equal(p.in_stock, 0);
  r = step({ price: 990, stock: 4 });
  assert.equal(r.notify, 'Появился в наличии');
});

test('желаемая цена', () => {
  let p = Object.assign(Core.newProduct('https://uzum.uz/ru/product/a-10', [], 1), { target_price: 800 }), checks = [];
  const step = res => { const r = Core.applyResult(p, checks, Object.assign({ name: 'Товар', price: 1000, old_price: 0, card_price: 0,
    in_stock: true, stock: null, image: '', seller: '', variant: '', warning: '' }, res), {});
    p = r.product; checks = checks.concat([r.check]); return r; };
  step({});
  let r = step({ price: 900 });
  assert.match(r.event, /Цена снизилась/); assert.equal(r.notify, '', 'выше желаемой — молчим');
  r = step({ price: 900, card_price: 790 });
  assert.equal(r.notify, 'Цена не выше желаемой (800 сум)', 'достигнута ценой с картой');
  r = step({ price: 850, card_price: 780 });
  assert.match(r.notify, /Цена снизилась.*Цена с картой/, 'ниже желаемой — уведомляем как обычно');
  r = step({ price: 950, card_price: 0 });
  assert.match(r.event, /Цена выросла/); assert.equal(r.notify, '');
  assert.equal(p.target_price, 800);
});

test('резервная копия туда и обратно', () => {
  const a = Object.assign(Core.newProduct('https://uzum.uz/ru/product/a-10?skuId=3', [], 5), { name: 'А', price: 100, target_price: 90 });
  const b = Core.newProduct('https://uzum.uz/ru/product/b-20', [], 6);
  const checks = { 5: [{ ts: 200, price: 100, old_price: null, card_price: null, in_stock: 1, stock: 2, event: 'x' }] };
  const data = JSON.parse(JSON.stringify(Core.exportData([b, a], checks)));
  assert.equal(data.format, 'uzum-monitor-backup'); assert.equal(data.products[0].id, undefined); assert.equal(data.products[0].name, 'А');
  const r = Core.importData(data, [b]);
  assert.equal(r.added, 1); assert.equal(r.skipped, 1);
  assert.equal(r.items[0].product.target_price, 90); assert.equal(r.items[0].product.sku_id, 3);
  assert.deepEqual(r.items[0].checks, checks[5]);
  assert.throws(() => Core.importData({ format: 'other' }, []), /не файл резервной копии/);
  const bad = Core.importData({ format: 'uzum-monitor-backup', products: [null, { url: 'https://evil.example/product/x-1' },
    { url: 'https://uzum.uz/ru/product/c-30', image: 'https://evil.example/i.png', status: 'weird', name: 5, checks: [{ ts: 'x' }, null] }] }, []);
  assert.equal(bad.added, 1); assert.equal(bad.skipped, 2);
  assert.equal(bad.items[0].product.image, ''); assert.equal(bad.items[0].product.status, 'new'); assert.equal(bad.items[0].product.name, '5');
  assert.deepEqual(bad.items[0].checks, []);
  const mix = Core.importData({ format: 'uzum-monitor-backup', products: [
    { url: 'https://www.ozon.uz/product/a-10/?sh=1', image: 'https://ir-3.ozone.ru/i.jpg', site: 'uzum' },
    { url: 'https://uzum.uz/ru/product/a-10' }, { url: 'https://www.wildberries.uz/catalog/10/detail.aspx?size=7' }] }, []);
  assert.deepEqual(mix.items.map(x => [x.product.site, x.product.url, x.product.sku_id]), [['ozon', 'https://www.ozon.uz/product/a-10/', 0],
    ['uzum', 'https://uzum.uz/ru/product/a-10', 0], ['wb', 'https://www.wildberries.uz/catalog/10/detail.aspx?size=7', 7]], 'сайт определяется по ссылке');
  assert.equal(mix.items[0].product.image, 'https://ir-3.ozone.ru/i.jpg');
});

test('MCosmetic: ссылки и карточка', () => {
  assert.deepEqual(Core.parseUrl('https://www.mcosmetic.uz/p/loreal-paradise-6-4-50372'),
    { site: 'mc', url: 'https://www.mcosmetic.uz/p/loreal-paradise-6-4-50372', productId: 50372, skuId: 0 });
  assert.deepEqual(Core.parseUrl('Смотри mcosmetic.uz/p/loreal-paris-infaillible-320-11-50327/?sku=1000279035&utm=x'),
    { site: 'mc', url: 'https://www.mcosmetic.uz/p/loreal-paris-infaillible-320-11-50327?sku=1000279035', productId: 50327, skuId: 1000279035 });
  assert.throws(() => Core.parseUrl('https://www.mcosmetic.uz/c/tushi-dlya-resnits-4991'), /mcosmetic\.uz\/p/);
  assert.equal(Core.pageProductId('mc', 'https://www.mcosmetic.uz/p/loreal-paris-infaillible-320-11-50327?sku=1'), 50327);
  assert.ok(Core.allowedUrl('https://www.mcosmetic.uz/cabinet'));
  const d = { href: 'https://www.mcosmetic.uz/p/a-50327?sku=7', ready: 'complete', name: 'Консилер, тон 324', price: 136400, oldPrice: 160500,
    cardPrice: null, image: 'https://s3.eu-west-2.amazonaws.com/catalog.jiffy-software.com/offers/1.jpg', ogImage: '', seller: '', variant: '11 мл, тон 324',
    stock: 2, canBuy: true, soldOutText: false, ogTitle: '', retailerId: '50327', cashback: 15, warning: '',
    sizes: [{ id: 7, name: 'тон 324', price: 136400, qty: 2 }, { id: 8, name: 'тон 325', price: null, qty: 0 }] };
  const r = Core.finish(d, 'mc', 50327, 7);
  assert.equal(r.status, 'ok'); assert.equal(r.res.cashback, 15); assert.equal(r.res.stock, 2); assert.equal(r.res.sizes.length, 2);
  assert.equal(r.res.image, d.image);
  assert.match(Core.finish(Object.assign({}, d, { retailerId: '50372' }), 'mc', 50327, 7).message, /другому товару/);
  assert.equal(Core.finish(Object.assign({}, d, { image: 'https://evil.example/1.jpg' }), 'mc', 50327, 7).res.image, '');
});

test('кешбэк', () => {
  assert.equal(Core.cashbackSet('10 %'), '10%'); assert.equal(Core.cashbackSet('7,5%'), '7.5%'); assert.equal(Core.cashbackSet('10 000'), '10000');
  assert.equal(Core.cashbackSet('0'), ''); assert.equal(Core.cashbackSet('150%'), ''); assert.equal(Core.cashbackSet('abc'), ''); assert.equal(Core.cashbackSet(null), '');
  assert.deepEqual(Core.cashbackOf({ cashback_set: '10%' }, 100000), { pct: 10, sum: 10000, own: true });
  assert.deepEqual(Core.cashbackOf({ cashback_set: '12000', cashback: 15 }, 100000), { pct: null, sum: 12000, own: true });
  assert.deepEqual(Core.cashbackOf({ cashback: 15 }, 112600), { pct: 15, sum: 16890, own: false });
  assert.equal(Core.cashbackOf({ cashback: 0 }, 100000), null);
  // изменение кешбэка на сайте попадает в историю и уведомление
  let p = Core.newProduct('https://www.mcosmetic.uz/p/a-50327', [], 1), checks = [];
  const step = cb => { const r = Core.applyResult(p, checks, { name: 'Т', price: 1000, old_price: 0, card_price: 0, in_stock: true, stock: 3,
    image: '', seller: '', variant: '', warning: '', cashback: cb }, {}); p = r.product; checks = checks.concat([r.check]); return r; };
  assert.equal(step(15).event, 'Начало наблюдения'); assert.equal(p.cashback, 15);
  assert.equal(step(15).notify, '');
  assert.equal(step(20).notify, 'Кешбэк: 15% → 20%');
  assert.equal(step(0).notify, 'Кешбэк 20% больше не действует');
  assert.equal(step(10).notify, 'Появился кешбэк 10%');
  // метка «Финальная цена»: появилась и снята
  assert.equal(Core.applyResult(p, checks, { name: 'Т', price: 1000, in_stock: true, stock: 3, cashback: 10, label: 'Финальная цена' }, {}).notify, 'Метка: «Финальная цена»');
  const lp = Object.assign({}, p, { label: 'Финальная цена', cashback: 0 });
  assert.equal(Core.applyResult(lp, checks, { name: 'Т', price: 1000, in_stock: true, stock: 3, cashback: 0, label: '' }, {}).notify, 'Метка «Финальная цена» снята');
  assert.equal(Core.finish({ href: 'https://www.mcosmetic.uz/p/nivea-100-49541', name: 'NIVEA', price: 87600, canBuy: true, retailerId: '49541', label: 'Финальная цена', cashback: 0 }, 'mc', 49541, 0).res.label, 'Финальная цена');
  // товары без кешбэка на сайте (Uzum и др.) не дают лишних записей
  let q = Core.newProduct('https://uzum.uz/ru/product/a-10', [], 2), qc = [];
  for (let i = 0; i < 2; i++) { const r = Core.applyResult(q, qc, { name: 'Т', price: 1000, in_stock: true, stock: null }, {}); q = r.product; qc = qc.concat([r.check]); assert.equal(r.notify, ''); }
  // резервная копия хранит кешбэк, указанный вручную
  const back = Core.importData(JSON.parse(JSON.stringify(Core.exportData([Object.assign(p, { cashback_set: '5%' })], {}))), []);
  assert.equal(back.items[0].product.cashback_set, '5%'); assert.equal(back.items[0].product.site, 'mc');
});

console.log(`\nВсе проверки пройдены: ${n}`);
