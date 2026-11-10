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

import org.json.JSONTokener;

/**
 * Открывает страницу uzum.uz в невидимом WebView и выполняет на ней скрипт из обновляемой
 * части (web/), пока тот не вернёт строку. Нужен для избранного и диагностики.
 * Вызывать из главного потока.
 */
public class PageRunner {

    public interface Callback {
        /** result == null — страница не ответила за отведённое время. */
        void done(String result);
    }

    @SuppressLint("SetJavaScriptEnabled")
    public static void run(Context ctx, String url, final String js, final long timeoutMs, final Callback cb) {
        final WebView web;
        try {
            web = new WebView(ctx.getApplicationContext());
        } catch (Exception e) {
            cb.done(null);
            return;
        }
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setBlockNetworkImage(true);
        web.setWebViewClient(new WebViewClient());
        int w = 1080, h = 2200;
        web.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
        web.layout(0, 0, w, h);
        web.onResume();
        web.resumeTimers();

        final Handler handler = new Handler(Looper.getMainLooper());
        final long deadline = SystemClock.elapsedRealtime() + timeoutMs;
        web.loadUrl(url);
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                final Runnable self = this;
                web.evaluateJavascript(js, new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        String result = null;
                        try {
                            if (value != null && !"null".equals(value)) {
                                Object v = new JSONTokener(value).nextValue();
                                if (v instanceof String) result = (String) v;
                            }
                        } catch (Exception ignored) {
                        }
                        if (result != null || SystemClock.elapsedRealtime() > deadline) {
                            try {
                                web.stopLoading();
                                web.destroy();
                            } catch (Exception ignored) {
                            }
                            cb.done(result);
                            return;
                        }
                        handler.postDelayed(self, 800);
                    }
                });
            }
        }, 1500);
    }
}
