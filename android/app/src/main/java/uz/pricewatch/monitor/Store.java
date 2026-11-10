package uz.pricewatch.monitor;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Хранилище: товары и история проверок. */
public class Store extends SQLiteOpenHelper {

    public static class UserException extends Exception {
        public UserException(String m) { super(m); }
    }

    /** Что изменилось после проверки. */
    public static class Change {
        public String event = "";   // запись в историю
        public String notify = "";  // текст уведомления ("" — не уведомлять)
    }

    private static Store inst;

    public static synchronized Store get(Context c) {
        if (inst == null) inst = new Store(c.getApplicationContext());
        return inst;
    }

    private final Context ctx;

    private Store(Context c) {
        super(c, "monitor.db", null, 3);
        ctx = c;
    }

    public static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences("cfg", Context.MODE_PRIVATE);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE products(id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, "
                + "product_id INTEGER NOT NULL, sku_id INTEGER NOT NULL DEFAULT 0, name TEXT DEFAULT '', "
                + "image TEXT DEFAULT '', seller TEXT DEFAULT '', variant TEXT DEFAULT '', price INTEGER, "
                + "old_price INTEGER, card_price INTEGER, in_stock INTEGER, stock INTEGER, added_at INTEGER, last_try INTEGER, "
                + "last_ok INTEGER, status TEXT DEFAULT 'new', error TEXT DEFAULT '', warning TEXT DEFAULT '', "
                + "target_price INTEGER)");
        db.execSQL("CREATE TABLE checks(id INTEGER PRIMARY KEY AUTOINCREMENT, product INTEGER NOT NULL, "
                + "ts INTEGER NOT NULL, price INTEGER, old_price INTEGER, card_price INTEGER, in_stock INTEGER, stock INTEGER, "
                + "event TEXT DEFAULT '')");
        db.execSQL("CREATE INDEX ix_checks ON checks(product, ts)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE products ADD COLUMN card_price INTEGER");
            db.execSQL("ALTER TABLE checks ADD COLUMN card_price INTEGER");
        }
        if (oldVersion < 3) {
            db.execSQL("ALTER TABLE products ADD COLUMN target_price INTEGER");
        }
    }

    // ───────── ссылки ─────────

    private static final Pattern LINK = Pattern.compile("https?://(?:www\\.)?uzum\\.uz/[^\\s\"'<>]+", Pattern.CASE_INSENSITIVE);
    private static final Pattern BARE = Pattern.compile("(?:^|\\s)((?:www\\.)?uzum\\.uz/[^\\s\"'<>]+)", Pattern.CASE_INSENSITIVE);
    public static final Pattern PRODUCT_PATH = Pattern.compile("/product/(?:[^/?#]*?-)?(\\d+)/?(?:[?#].*)?$");
    private static final Pattern SKU = Pattern.compile("[?&]skuId=(\\d+)");

    /** Находит ссылку на товар в тексте. Возвращает {ссылка, id товара, id варианта или "0"}. */
    public static String[] parseUrl(String text) throws UserException {
        String t = text == null ? "" : text.trim();
        if (t.isEmpty()) throw new UserException("Вставьте ссылку на товар.");
        String url;
        Matcher m = LINK.matcher(t);
        if (m.find()) {
            url = m.group();
        } else {
            Matcher b = BARE.matcher(t);
            if (!b.find()) throw new UserException("Это не ссылка на uzum.uz.");
            url = "https://" + b.group(1);
        }
        int hash = url.indexOf('#');
        if (hash >= 0) url = url.substring(0, hash);
        Matcher p = PRODUCT_PATH.matcher(url);
        if (!p.find()) {
            throw new UserException("Не похоже на ссылку товара. Нужна ссылка вида uzum.uz/ru/product/название-123456");
        }
        String productId = p.group(1);
        Matcher s = SKU.matcher(url);
        String sku = s.find() ? s.group(1) : "0";
        int q = url.indexOf('?');
        String path = q >= 0 ? url.substring(0, q) : url;
        path = path.replaceFirst("^(?i)https?://(?:www\\.)?uzum\\.uz", "https://uzum.uz");
        while (path.endsWith("/")) path = path.substring(0, path.length() - 1);
        String clean = "0".equals(sku) ? path : path + "?skuId=" + sku;
        return new String[]{clean, productId, sku};
    }

    public long addProduct(String text) throws UserException {
        String[] u = parseUrl(text);
        SQLiteDatabase db = getWritableDatabase();
        try (Cursor c = db.rawQuery("SELECT id FROM products WHERE product_id=? AND sku_id=?",
                new String[]{u[1], u[2]})) {
            if (c.moveToFirst()) throw new UserException("Этот товар уже отслеживается.");
        }
        ContentValues v = new ContentValues();
        v.put("url", u[0]);
        v.put("product_id", Long.parseLong(u[1]));
        v.put("sku_id", Long.parseLong(u[2]));
        v.put("added_at", now());
        return db.insert("products", null, v);
    }

    public void deleteProduct(long id) {
        SQLiteDatabase db = getWritableDatabase();
        String[] a = {String.valueOf(id)};
        db.delete("checks", "product=?", a);
        db.delete("products", "id=?", a);
    }

    /** Желаемая цена: о цене уведомляем, только когда она не выше этой. 0 — убрать. */
    public void setTarget(long id, long price) {
        ContentValues v = new ContentValues();
        if (price > 0) v.put("target_price", price); else v.putNull("target_price");
        getWritableDatabase().update("products", v, "id=?", new String[]{String.valueOf(id)});
    }

    public List<Long> allIds() {
        List<Long> ids = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT id FROM products ORDER BY id", null)) {
            while (c.moveToNext()) ids.add(c.getLong(0));
        }
        return ids;
    }

    public JSONObject product(long id) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT * FROM products WHERE id=?",
                new String[]{String.valueOf(id)})) {
            return c.moveToFirst() ? row(c) : null;
        }
    }

    public JSONArray products() {
        JSONArray out = new JSONArray();
        String sql = "SELECT p.*, "
                + "(SELECT MIN(price) FROM checks WHERE product=p.id AND price IS NOT NULL) AS min_price, "
                + "(SELECT MAX(price) FROM checks WHERE product=p.id AND price IS NOT NULL) AS max_price, "
                + "(SELECT price FROM checks WHERE product=p.id AND price IS NOT NULL ORDER BY ts, id LIMIT 1) AS first_price, "
                + "(SELECT COUNT(*) FROM checks WHERE product=p.id) AS checks_count "
                + "FROM products p ORDER BY p.id DESC";
        try (Cursor c = getReadableDatabase().rawQuery(sql, null)) {
            while (c.moveToNext()) out.put(row(c));
        }
        return out;
    }

    public JSONArray history(long id) {
        JSONArray out = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT ts, price, old_price, card_price, in_stock, stock, event FROM checks WHERE product=? ORDER BY ts, id",
                new String[]{String.valueOf(id)})) {
            while (c.moveToNext()) out.put(row(c));
        }
        return out;
    }

    private static JSONObject row(Cursor c) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i < c.getColumnCount(); i++) {
                String k = c.getColumnName(i);
                switch (c.getType(i)) {
                    case Cursor.FIELD_TYPE_NULL: o.put(k, JSONObject.NULL); break;
                    case Cursor.FIELD_TYPE_INTEGER: o.put(k, c.getLong(i)); break;
                    case Cursor.FIELD_TYPE_FLOAT: o.put(k, c.getDouble(i)); break;
                    default: o.put(k, c.getString(i));
                }
            }
        } catch (JSONException ignored) {
        }
        return o;
    }

    // ───────── результаты проверок ─────────

    public static String money(long n) {
        return String.format(Locale.US, "%,d", n).replace(',', ' ') + " сум";
    }

    private static long now() {
        return System.currentTimeMillis() / 1000;
    }

    public void saveError(long id, String message) {
        ContentValues v = new ContentValues();
        v.put("last_try", now());
        v.put("status", "error");
        v.put("error", message);
        getWritableDatabase().update("products", v, "id=?", new String[]{String.valueOf(id)});
    }

    public void saveNotFound(long id) {
        ContentValues v = new ContentValues();
        v.put("last_try", now());
        v.put("status", "not_found");
        v.put("error", "Страница товара не найдена — возможно, товар снят с продажи.");
        getWritableDatabase().update("products", v, "id=?", new String[]{String.valueOf(id)});
    }

    /** Записывает успешную проверку и возвращает, что изменилось с прошлой. */
    public Change saveResult(long id, JSONObject res) {
        Change ch = new Change();
        SQLiteDatabase db = getWritableDatabase();
        String[] a = {String.valueOf(id)};
        boolean hasPrev = false, prevInStock = false;
        long prevPrice = 0, prevStock = -1, prevCard = 0;
        try (Cursor c = db.rawQuery(
                "SELECT price, in_stock, stock, card_price FROM checks WHERE product=? ORDER BY ts DESC, id DESC LIMIT 1", a)) {
            if (c.moveToFirst()) {
                hasPrev = true;
                prevPrice = c.isNull(0) ? 0 : c.getLong(0);
                prevInStock = !c.isNull(1) && c.getLong(1) != 0;
                prevStock = c.isNull(2) ? -1 : c.getLong(2);
                prevCard = c.isNull(3) ? 0 : c.getLong(3);
            }
        }
        long price = res.optLong("price", 0);
        if (price <= 0 && hasPrev) price = prevPrice;   // товара нет — помним последнюю известную цену
        long oldPrice = res.optLong("old_price", 0);
        long cardPrice = res.optLong("card_price", 0);
        boolean inStock = res.optBoolean("in_stock", false);
        long stock = res.isNull("stock") ? -1 : res.optLong("stock", -1);

        long target = 0;
        try (Cursor c = db.rawQuery("SELECT target_price FROM products WHERE id=?", a)) {
            if (c.moveToFirst() && !c.isNull(0)) target = c.getLong(0);
        }
        long best = best(price, cardPrice), prevBest = best(prevPrice, prevCard);
        boolean reached = target > 0 && inStock && best > 0 && best <= target;
        boolean prevReached = target > 0 && prevInStock && prevBest > 0 && prevBest <= target;
        // Задана желаемая цена и она не достигнута — изменения цены пишем в историю, но не уведомляем
        boolean quiet = target > 0 && !reached;

        if (!hasPrev) {
            ch.event = "Начало наблюдения";
        } else {
            List<String> ev = new ArrayList<>();
            List<String> nt = new ArrayList<>();
            if (prevInStock != inStock) {
                String s = inStock ? "Появился в наличии" : "Нет в наличии";
                ev.add(s);
                nt.add(s);
            }
            if (prevPrice > 0 && price > 0 && prevPrice != price) {
                double pct = (price - prevPrice) * 100.0 / prevPrice;
                String s = String.format(Locale.US, "Цена %s: %s → %s (%+.1f%%)",
                        price < prevPrice ? "снизилась" : "выросла", money(prevPrice), money(price), pct);
                ev.add(s);
                if (!quiet) nt.add(s);
            }
            if (prevCard > 0 && cardPrice > 0 && prevCard != cardPrice) {
                String s = "Цена с картой Uzum: " + money(prevCard) + " → " + money(cardPrice);
                ev.add(s);
                if (!quiet) nt.add(s);
            }
            if (reached && !prevReached) {
                String s = "Цена не выше желаемой (" + money(target) + ")";
                ev.add(s);
                nt.add(s);
            }
            if (prevInStock && inStock && prevStock >= 0 && stock >= 0 && prevStock != stock) {
                String s = "Количество: " + prevStock + " → " + stock + " шт";
                ev.add(s);
                if (prefs(ctx).getBoolean("notify_stock", true)) nt.add(s);
            }
            ch.event = join(ev);
            ch.notify = join(nt);
        }

        ContentValues k = new ContentValues();
        k.put("product", id);
        k.put("ts", now());
        putOrNull(k, "price", price);
        putOrNull(k, "old_price", oldPrice);
        putOrNull(k, "card_price", cardPrice);
        k.put("in_stock", inStock ? 1 : 0);
        if (stock >= 0) k.put("stock", stock); else k.putNull("stock");
        k.put("event", ch.event);
        db.insert("checks", null, k);

        ContentValues v = new ContentValues();
        v.put("name", res.optString("name"));
        String image = res.optString("image");
        if (!image.isEmpty()) v.put("image", image);
        v.put("seller", res.optString("seller"));
        v.put("variant", res.optString("variant"));
        putOrNull(v, "price", price);
        putOrNull(v, "old_price", oldPrice);
        putOrNull(v, "card_price", cardPrice);
        v.put("in_stock", inStock ? 1 : 0);
        if (stock >= 0) v.put("stock", stock); else v.putNull("stock");
        v.put("last_try", now());
        v.put("last_ok", now());
        v.put("status", "ok");
        v.put("error", "");
        v.put("warning", res.optString("warning"));
        db.update("products", v, "id=?", a);
        return ch;
    }

    /** Лучшая доступная цена: с картой Uzum, если она есть и ниже обычной. */
    private static long best(long price, long card) {
        return card > 0 && card < price ? card : price;
    }

    // ───────── резервная копия ─────────

    private static final String BACKUP_FORMAT = "uzum-monitor-backup";
    private static final String[] NUMBERS = {"price", "old_price", "card_price", "in_stock", "stock"};

    /** Все товары вместе с историей проверок. */
    public JSONObject exportJson() throws JSONException {
        JSONObject out = new JSONObject();
        out.put("format", BACKUP_FORMAT);
        out.put("version", 1);
        out.put("exported_at", now());
        JSONArray ps = new JSONArray();
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor c = db.rawQuery("SELECT * FROM products ORDER BY id", null)) {
            while (c.moveToNext()) {
                JSONObject p = row(c);
                long id = p.optLong("id");
                p.remove("id");
                p.put("checks", history(id));
                ps.put(p);
            }
        }
        out.put("products", ps);
        return out;
    }

    /** Добавляет товары из резервной копии. Уже отслеживаемые пропускает. Возвращает {добавлено, пропущено}. */
    public int[] importJson(JSONObject data) throws UserException {
        JSONArray ps = data.optJSONArray("products");
        if (!BACKUP_FORMAT.equals(data.optString("format")) || ps == null) {
            throw new UserException("Это не файл резервной копии Uzum Монитора.");
        }
        int added = 0, skipped = 0;
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (int i = 0; i < ps.length(); i++) {
                JSONObject p = ps.optJSONObject(i);
                String[] u = null;
                try {
                    if (p != null) u = parseUrl(p.optString("url"));
                } catch (UserException ignored) {
                }
                if (u == null || exists(db, u[1], u[2])) {
                    skipped++;
                    continue;
                }
                ContentValues v = new ContentValues();
                v.put("url", u[0]);
                v.put("product_id", Long.parseLong(u[1]));
                v.put("sku_id", Long.parseLong(u[2]));
                v.put("name", text(p, "name", 300));
                String image = text(p, "image", 500);
                v.put("image", image.startsWith("https://images.uzum.uz/") ? image : "");
                v.put("seller", text(p, "seller", 200));
                v.put("variant", text(p, "variant", 200));
                for (String k : NUMBERS) copyLong(v, p, k);
                copyLong(v, p, "added_at");
                copyLong(v, p, "last_try");
                copyLong(v, p, "last_ok");
                copyLong(v, p, "target_price");
                String status = text(p, "status", 20);
                v.put("status", status.matches("new|ok|error|not_found") ? status : "new");
                v.put("error", text(p, "error", 500));
                v.put("warning", text(p, "warning", 500));
                long id = db.insert("products", null, v);
                if (id < 0) {
                    skipped++;
                    continue;
                }
                JSONArray checks = p.optJSONArray("checks");
                for (int j = 0; checks != null && j < checks.length(); j++) {
                    JSONObject k = checks.optJSONObject(j);
                    if (k == null || k.optLong("ts", 0) <= 0) continue;
                    ContentValues r = new ContentValues();
                    r.put("product", id);
                    r.put("ts", k.optLong("ts"));
                    for (String n : NUMBERS) copyLong(r, k, n);
                    r.put("event", text(k, "event", 500));
                    db.insert("checks", null, r);
                }
                added++;
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return new int[]{added, skipped};
    }

    private static boolean exists(SQLiteDatabase db, String productId, String skuId) {
        try (Cursor c = db.rawQuery("SELECT id FROM products WHERE product_id=? AND sku_id=?",
                new String[]{productId, skuId})) {
            return c.moveToFirst();
        }
    }

    private static String text(JSONObject o, String key, int max) {
        String s = o.isNull(key) ? "" : o.optString(key);
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static void copyLong(ContentValues v, JSONObject o, String key) {
        if (o.isNull(key)) v.putNull(key); else v.put(key, o.optLong(key));
    }

    private static void putOrNull(ContentValues v, String key, long n) {
        if (n > 0) v.put(key, n); else v.putNull(key);
    }

    private static String join(List<String> parts) {
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (sb.length() > 0) sb.append("; ");
            sb.append(p);
        }
        return sb.toString();
    }
}
