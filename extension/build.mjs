// Собирает расширение в extension/dist: файлы из extension/src плюс интерфейс и чтение карточки из web/.
// Интерфейс общий с приложением для Android; здесь его встроенный скрипт выносится в отдельный файл,
// потому что расширениям запрещены скрипты внутри страницы.
// Запуск: node extension/build.mjs [версия] [--store]
// --store — вариант для загрузки в магазин расширений: без поля key, идентификатор назначит магазин.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..', 'web');
const dist = join(here, 'dist');
const args = process.argv.slice(2);
const store = args.includes('--store');
const version = args.find(a => !a.startsWith('--')) || process.env.EXT_VERSION || '';

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(here, 'src'), dist, { recursive: true });
cpSync(join(web, 'extract.js'), join(dist, 'extract.js'));

const html = readFileSync(join(web, 'ui.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) throw new Error('В web/ui.html не найден встроенный скрипт');
writeFileSync(join(dist, 'ui.js'), m[1]);
const page = html.replace(m[0], ['buildinfo.js', 'core.js', 'shim.js', 'ui.js'].map(f => `<script src="${f}"></script>`).join('\n'));
if (/<script>|\son[a-z]+=/.test(page)) throw new Error('В странице остался встроенный скрипт — расширение его не выполнит');
writeFileSync(join(dist, 'ui.html'), page);

const webVersion = JSON.parse(readFileSync(join(web, 'manifest.json'), 'utf8')).version;
writeFileSync(join(dist, 'buildinfo.js'), `const BUILD = ${JSON.stringify({ web: webVersion })};\n`);

const manifestPath = join(dist, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (version) {
  if (!/^\d+(\.\d+){0,3}$/.test(version)) throw new Error('Версия должна состоять из чисел через точку: ' + version);
  manifest.version = version;
}
if (store) delete manifest.key;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Расширение ${manifest.version} (интерфейс №${webVersion})${store ? ' для магазина' : ''} собрано в ${dist}`);
