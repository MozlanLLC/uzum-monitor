package uz.pricewatch.monitor;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.Locale;

/**
 * Открывает карточку товара в невидимом WebView (настоящий браузер телефона) и читает её
 * скриптом сайта из web/ (extract.js, extract-ozon.js, extract-wb.js). Все методы вызываются из главного потока.
 */
public class Scraper {

    public interface Callback {
        /** status: "ok" (res заполнен), "not_found" или "error" (message заполнен). */
        void done(String status, JSONObject res, String message);
    }

    private static final long TIMEOUT_MS = 45000;
    private static final long POLL_MS = 800;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private int generation = 0;

    private static class Run {
        JSONObject last;
        String prevKey;
        int stable;
        int notFound;
    }

    @SuppressLint("SetJavaScriptEnabled")
    public Scraper(Context ctx) {
        web = new WebView(ctx.getApplicationContext());
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setBlockNetworkImage(true);   // картинки не грузим — нужны только их адреса
        s.setMediaPlaybackRequiresUserGesture(true);
        web.setWebViewClient(new WebViewClient());
        int w = 1080, h = 2200;
        web.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
        web.layout(0, 0, w, h);
        web.onResume();
        web.resumeTimers();
    }

    public void destroy() {
        generation++;
        handler.removeCallbacksAndMessages(null);
        if (web != null) {
            try {
                web.stopLoading();
                web.loadUrl("about:blank");
                web.destroy();
            } catch (Exception ignored) {
            }
            web = null;
        }
    }

    /**
     * @param site      сайт товара (см. Sites)
     * @param extractJs скрипт чтения карточки этого сайта из web/
     */
    public void fetch(final String site, final String url, final long productId, final long skuId,
                      final String extractJs, final Callback cb) {
        // нужный размер (Wildberries) скрипт чтения берёт из window.__pmSku
        final String js = "window.__pmSku=" + skuId + ";" + extractJs;
        final int my = ++generation;
        final long deadline = SystemClock.elapsedRealtime() + TIMEOUT_MS;
        final Run run = new Run();
        web.loadUrl(url);
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (my != generation || web == null) return;
                final Runnable self = this;
                web.evaluateJavascript(js, new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (my != generation) return;
                        JSONObject d = parse(value);
                        if (d != null && Sites.pageProductId(site, d.optString("href")) == productId) {
                            run.last = d;
                            if (d.optBoolean("notFound") && "complete".equals(d.optString("ready"))) {
                                if (++run.notFound >= 4) {
                                    cb.done("not_found", null, null);
                                    return;
                                }
                            } else if (!d.optString("name").isEmpty()) {
                                // страница может ещё дорисовываться: ждём, пока данные перестанут меняться
                                boolean verdict = d.optLong("price", 0) > 0 || d.optBoolean("soldOutText");
                                String key = d.optString("name") + "|" + d.optLong("price", 0) + "|" + d.optLong("oldPrice", 0)
                                        + "|" + d.optBoolean("canBuy") + "|" + d.optLong("stock", -1) + "|" + d.optString("image")
                                        + "|" + d.optString("retailerId") + "|" + d.optLong("cardPrice", 0);
                                if (verdict && key.equals(run.prevKey)) {
                                    if (++run.stable >= 3) {
                                        finish(d, site, productId, skuId, cb);
                                        return;
                                    }
                                } else {
                                    run.stable = 0;
                                }
                                run.prevKey = key;
                            }
                        }
                        if (SystemClock.elapsedRealtime() > deadline) {
                            timeout(run.last, d, site, productId, skuId, cb);
                            return;
                        }
                        handler.postDelayed(self, POLL_MS);
                    }
                });
            }
        }, 1500);
    }

    private static JSONObject parse(String value) {
        try {
            if (value == null || "null".equals(value)) return null;
            Object v = new JSONTokener(value).nextValue();
            if (v instanceof String) return new JSONObject((String) v);
            if (v instanceof JSONObject) return (JSONObject) v;
        } catch (Exception ignored) {
        }
        return null;
    }

    private void timeout(JSONObject last, JSONObject any, String site, long productId, long skuId, Callback cb) {
        if (last == null || last.optString("name").isEmpty()) {
            if (any != null && any.optBoolean("blocked")) {
                cb.done("error", null, "Сайт показал проверку «вы не робот». Откройте товар в браузере телефона и попробуйте позже.");
            } else if (any != null && Sites.pageProductId(site, any.optString("href")) != productId
                    && any.optString("href").startsWith("http")) {
                cb.done("error", null, "Сайт открыл другую страницу вместо товара.");
            } else {
                cb.done("error", null, "Карточка товара не загрузилась (нет интернета или сайт недоступен).");
            }
            return;
        }
        if (last.optLong("price", 0) <= 0 && last.optBoolean("canBuy")) {
            cb.done("error", null, "Не удалось прочитать цену на странице.");
            return;
        }
        finish(last, site, productId, skuId, cb);   // название есть, цены и кнопки «В корзину» нет — товара нет в наличии
    }

    /** Размеры (Wildberries): из них пользователь выбирает, за каким следить. */
    private static JSONArray sizes(JSONArray in) throws JSONException {
        JSONArray out = new JSONArray();
        for (int i = 0; in != null && i < in.length() && i < 60; i++) {
            JSONObject x = in.optJSONObject(i);
            if (x == null || x.optLong("id", 0) <= 0) continue;
            JSONObject o = new JSONObject();
            o.put("id", x.optLong("id"));
            String name = x.isNull("name") ? "" : x.optString("name");
            o.put("name", name.length() > 40 ? name.substring(0, 40) : name);
            long price = x.optLong("price", 0);
            o.put("price", price > 0 ? price : JSONObject.NULL);
            o.put("qty", Math.max(0, x.optLong("qty", 0)));
            out.put(o);
        }
        return out;
    }

    private static String norm(String s) {
        return (s == null ? "" : s).replaceAll("\\s+", " ").trim().toLowerCase(Locale.ROOT);
    }

    /** Перекрёстные проверки: это точно тот товар? */
    private void finish(JSONObject d, String site, long productId, long skuId, Callback cb) {
        try {
            String retailer = d.optString("retailerId");
            if (retailer.matches("\\d+") && Long.parseLong(retailer) != productId) {
                cb.done("error", null, "Данные страницы относятся к другому товару (id " + retailer + ").");
                return;
            }
            String name = d.optString("name");
            String ogTitle = norm(d.optString("ogTitle"));
            String head = norm(name);
            if (head.length() > 40) head = head.substring(0, 40);
            if (!ogTitle.isEmpty() && !ogTitle.startsWith(head)) {
                cb.done("error", null, "Название на странице не совпало со служебным заголовком — данные не записаны.");
                return;
            }
            String warning = d.optString("warning");
            if (warning.length() > 200) warning = warning.substring(0, 200);
            if (Sites.UZUM.equals(Sites.normalize(site)) && skuId > 0) {
                long shown = Sites.pageSku(d.optString("href"));
                if (shown > 0 && shown != skuId) {
                    warning = "Сайт переключил вариант товара (skuId " + shown + " вместо " + skuId + ").";
                }
            }
            long price = d.optLong("price", 0);
            boolean inStock = price > 0 && d.optBoolean("canBuy") && !d.optBoolean("soldOutText");
            String image = d.optString("image");
            if (!Sites.imageOk(site, image)) image = d.optString("ogImage");
            if (!Sites.imageOk(site, image)) image = "";

            JSONObject res = new JSONObject();
            res.put("name", name);
            res.put("price", price);
            res.put("old_price", d.optLong("oldPrice", 0));
            long card = d.optLong("cardPrice", 0);
            res.put("card_price", card > 0 && card < price ? card : 0);
            res.put("in_stock", inStock);
            if (!inStock) res.put("stock", 0);
            else if (d.isNull("stock")) res.put("stock", JSONObject.NULL);
            else res.put("stock", d.optLong("stock", -1));
            res.put("image", image);
            res.put("seller", d.optString("seller"));
            res.put("variant", d.optString("variant"));
            res.put("warning", warning);
            res.put("sizes", sizes(d.optJSONArray("sizes")));
            cb.done("ok", res, null);
        } catch (Exception e) {
            cb.done("error", null, "Не удалось разобрать данные страницы: " + e.getMessage());
        }
    }
}
