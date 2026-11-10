package uz.pricewatch.monitor;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

public class MainActivity extends Activity {

    private static final String UI_BASE = "https://app.uzum-monitor.invalid/";
    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Notifier.channels(this);
        Scheduler.scheduleNext(this);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // Мост window.Android получает только собственный интерфейс; страницы Uzum
        // открываются в отдельном WebView (Scraper) без моста.
        web.addJavascriptInterface(new Bridge(this), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                } catch (Exception ignored) {
                }
                return true;
            }
        });
        setContentView(web);
        loadUi();

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        handleShare(getIntent());

        new Thread(new Runnable() {
            @Override
            public void run() {
                if (Updater.sync(getApplicationContext())) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (!isFinishing() && !isDestroyed()) {
                                loadUi();
                                Toast.makeText(MainActivity.this, "Приложение обновлено", Toast.LENGTH_SHORT).show();
                            }
                        }
                    });
                }
            }
        }).start();
    }

    private void loadUi() {
        web.loadDataWithBaseURL(UI_BASE, Updater.read(this, "ui.html"), "text/html", "utf-8", null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShare(intent);
    }

    /** «Поделиться» из приложения Uzum или браузера → товар добавляется в список. */
    private void handleShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        intent.setAction(Intent.ACTION_MAIN);
        try {
            long id = Store.get(this).addProduct(text);
            CheckService.start(this, id);
            Toast.makeText(this, "Товар добавлен", Toast.LENGTH_SHORT).show();
        } catch (Store.UserException e) {
            Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "Не удалось добавить товар", Toast.LENGTH_LONG).show();
        }
        refreshUi();
    }

    /** Передаёт интерфейсу ответ фоновой страницы (см. Bridge.runOnPage). */
    void deliver(String token, String result) {
        if (web == null) return;
        web.evaluateJavascript("window.onPageResult&&window.onPageResult(" + JSONObject.quote(token) + ","
                + (result == null ? "null" : JSONObject.quote(result)) + ")", null);
    }

    private void refreshUi() {
        if (web != null) web.evaluateJavascript("window.onAppResume&&window.onAppResume()", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Scheduler.scheduleNext(this);
        refreshUi();
    }

    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
