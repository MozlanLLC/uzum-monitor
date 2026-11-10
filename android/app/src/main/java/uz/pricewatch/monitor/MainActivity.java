package uz.pricewatch.monitor;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {

    private static final String UI_BASE = "https://app.uzum-monitor.invalid/";
    private static final int REQ_EXPORT = 11;
    private static final int REQ_IMPORT = 12;
    private static final int MAX_BACKUP = 30 * 1024 * 1024;
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

    /** Резервная копия: системное окно выбора файла — куда сохранить или откуда загрузить. */
    void pickFile(boolean export) {
        try {
            if (export) {
                String name = "uzum-monitor-" + new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()) + ".json";
                startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("application/json").putExtra(Intent.EXTRA_TITLE, name), REQ_EXPORT);
            } else {
                startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("*/*"), REQ_IMPORT);
            }
        } catch (Exception e) {
            Toast.makeText(this, "На телефоне нет приложения для выбора файла", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(final int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if ((requestCode != REQ_EXPORT && requestCode != REQ_IMPORT) || resultCode != RESULT_OK
                || data == null || data.getData() == null) return;
        final Uri uri = data.getData();
        new Thread(new Runnable() {
            @Override
            public void run() {
                final String message = requestCode == REQ_EXPORT ? exportTo(uri) : importFrom(uri);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (isFinishing() || isDestroyed()) return;
                        Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
                        refreshUi();
                    }
                });
            }
        }).start();
    }

    private String exportTo(Uri uri) {
        try (OutputStream out = getContentResolver().openOutputStream(uri)) {
            if (out == null) return "Не удалось открыть файл для записи";
            JSONObject data = Store.get(this).exportJson();
            out.write(data.toString().getBytes(StandardCharsets.UTF_8));
            return "Сохранено товаров: " + data.getJSONArray("products").length();
        } catch (Exception e) {
            return "Не удалось сохранить резервную копию";
        }
    }

    private String importFrom(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) return "Не удалось открыть файл";
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) {
                buf.write(chunk, 0, n);
                if (buf.size() > MAX_BACKUP) return "Файл слишком большой для резервной копии";
            }
            int[] r = Store.get(this).importJson(new JSONObject(new String(buf.toByteArray(), StandardCharsets.UTF_8)));
            return "Загружено товаров: " + r[0] + (r[1] > 0 ? ", пропущено (уже есть или не подошли): " + r[1] : "");
        } catch (Store.UserException e) {
            return e.getMessage();
        } catch (Exception e) {
            return "Это не файл резервной копии Uzum Монитора.";
        }
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
