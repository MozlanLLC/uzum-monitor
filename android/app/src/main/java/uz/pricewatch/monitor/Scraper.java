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

import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Открывает карточку товара в невидимом WebView (настоящий браузер телефона) и читает её
 * скриптом extract.js. Все методы вызываются из главного потока.
 */
public class Scraper {

    public interface Callback {
        /** status: "ok" (res заполнен), "not_found" или "error" (message заполнен). */
        void done(String status, JSONObject res, String message);
    }

    private static final long TIMEOUT_MS = 45000;
    private static final long POLL_MS = 800;
    private static final Pattern HREF_SKU = Pattern.compile("[?&]skuId=(\\d+)");

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final String js;
    private WebView web;
    private int generation = 0;

    private static class Run {
        JSONObject last;
        String prevKey;
        int stable;
        int notFound;
    }

    @SuppressLint("SetJavaScriptEnabled")
    public Scraper(Context ctx, String extractJs) {
        js = extractJs;
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

    public void fetch(final String url, final long productId, final long skuId, final Callback cb) {
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
                        if (d != null && pageProductId(d.optString("href")) == productId) {
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
                                        + "|" + d.optString("retailerId");
                                if (verdict && key.equals(run.prevKey)) {
                                    if (++run.stable >= 3) {
                                        finish(d, productId, skuId, cb);
                                        return;
                                    }
                                } else {
                                    run.stable = 0;
                                }
                                run.prevKey = key;
                            }
                        }
                        if (SystemClock.elapsedRealtime() > deadline) {
                            timeout(run.last, d, productId, skuId, cb);
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

    private static long pageProductId(String href) {
        Matcher m = Store.PRODUCT_PATH.matcher(href == null ? "" : href);
        try {
            return m.find() ? Long.parseLong(m.group(1)) : -1;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private void timeout(JSONObject last, JSONObject any, long productId, long skuId, Callback cb) {
        if (last == null || last.optString("name").isEmpty()) {
            if (any != null && any.optBoolean("blocked")) {
                cb.done("error", null, "Сайт показал проверку «вы не робот». Откройте товар в браузере телефона и попробуйте позже.");
            } else if (any != null && pageProductId(any.optString("href")) != productId
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
        finish(last, productId, skuId, cb);   // название есть, цены и кнопки «В корзину» нет — товара нет в наличии
    }

    private static String norm(String s) {
        return (s == null ? "" : s).replaceAll("\\s+", " ").trim().toLowerCase(Locale.ROOT);
    }

    /** Перекрёстные проверки: это точно тот товар? */
    private void finish(JSONObject d, long productId, long skuId, Callback cb) {
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
            String warning = "";
            if (skuId > 0) {
                Matcher m = HREF_SKU.matcher(d.optString("href"));
                if (m.find() && Long.parseLong(m.group(1)) != skuId) {
                    warning = "Сайт переключил вариант товара (skuId " + m.group(1) + " вместо " + skuId + ").";
                }
            }
            long price = d.optLong("price", 0);
            boolean inStock = price > 0 && d.optBoolean("canBuy") && !d.optBoolean("soldOutText");
            String image = d.optString("image");
            if (!image.startsWith("https://images.uzum.uz/")) image = d.optString("ogImage");
            if (!image.startsWith("https://images.uzum.uz/")) image = "";

            JSONObject res = new JSONObject();
            res.put("name", name);
            res.put("price", price);
            res.put("old_price", d.optLong("oldPrice", 0));
            res.put("in_stock", inStock);
            if (!inStock) res.put("stock", 0);
            else if (d.isNull("stock")) res.put("stock", JSONObject.NULL);
            else res.put("stock", d.optLong("stock", -1));
            res.put("image", image);
            res.put("seller", d.optString("seller"));
            res.put("variant", d.optString("variant"));
            res.put("warning", warning);
            cb.done("ok", res, null);
        } catch (Exception e) {
            cb.done("error", null, "Не удалось разобрать данные страницы: " + e.getMessage());
        }
    }
}
