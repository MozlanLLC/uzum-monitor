// Проверка общей логики расширения. Запуск: node extension/test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const Core = createRequire(import.meta.url)('./src/core.js');
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

test('ссылки на товар', () => {
  assert.deepEqual(Core.parseUrl('https://uzum.uz/ru/product/detskoe-sidene-na-1792401?skuId=9514199'),
    { url: 'https://uzum.uz/ru/product/detskoe-sidene-na-1792401?skuId=9514199', productId: 1792401, skuId: 9514199 });
  assert.deepEqual(Core.parseUrl('Смотри: http://www.uzum.uz/ru/product/shina-777/?utm=1#x'),
    { url: 'https://uzum.uz/ru/product/shina-777', productId: 777, skuId: 0 });
  assert.equal(Core.parseUrl('uzum.uz/product/555').productId, 555);
  assert.throws(() => Core.parseUrl(''), /Вставьте ссылку/);
  assert.throws(() => Core.parseUrl('https://example.com/product/a-1'), /не ссылка на uzum/);
  assert.throws(() => Core.parseUrl('https://uzum.uz/ru/wishes'), /Не похоже на ссылку товара/);
  assert.throws(() => Core.parseUrl('https://uzum.uz.evil.com/ru/product/a-1'), /не ссылка на uzum|Не похоже/);
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
  const ok = Core.finish(page(), 10, 3);
  assert.equal(ok.status, 'ok');
  assert.deepEqual(ok.res, { name: 'Товар', price: 1000, old_price: 1500, card_price: 900, in_stock: true, stock: 7,
    image: 'https://images.uzum.uz/x.jpg', seller: 'Магазин', variant: 'Серый', warning: '' });
  assert.match(Core.finish(page({ retailerId: '11' }), 10, 3).message, /другому товару/);
  assert.match(Core.finish(page({ ogTitle: 'Совсем другое' }), 10, 3).message, /не совпало/);
  assert.match(Core.finish(page({ href: 'https://uzum.uz/ru/product/a-10?skuId=4' }), 10, 3).res.warning, /переключил вариант/);
  const out = Core.finish(page({ canBuy: false, price: null, stock: null }), 10, 3).res;
  assert.equal(out.in_stock, false); assert.equal(out.stock, 0);
  assert.equal(Core.finish(page({ image: 'https://evil.example/x.jpg' }), 10, 3).res.image, '');
  assert.equal(Core.finish(page({ cardPrice: 1200 }), 10, 3).res.card_price, 0);
});

test('время вышло', () => {
  assert.match(Core.onTimeout(null, { blocked: true }, 10, 0).message, /не робот/);
  assert.match(Core.onTimeout(null, { href: 'https://uzum.uz/ru' }, 10, 0).message, /другую страницу/);
  assert.match(Core.onTimeout(null, null, 10, 0).message, /не загрузилась/);
  assert.match(Core.onTimeout(page({ price: null }), null, 10, 3).message, /прочитать цену/);
  assert.equal(Core.onTimeout(page({ price: null, canBuy: false }), null, 10, 3).status, 'ok');
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
  assert.match(r.notify, /Цена снизилась.*Цена с картой Uzum/, 'ниже желаемой — уведомляем как обычно');
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
});

console.log(`\nВсе проверки пройдены: ${n}`);
