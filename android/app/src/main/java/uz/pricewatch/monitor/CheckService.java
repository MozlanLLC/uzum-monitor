package uz.pricewatch.monitor;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/** Проверяет товары по очереди, пока приложение свёрнуто или закрыто. */
public class CheckService extends Service {

    public static volatile boolean busy = false;
    public static final Set<Long> pending = Collections.synchronizedSet(new LinkedHashSet<Long>());

    private static final long PAUSE_MS = 3000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ArrayDeque<Long> queue = new ArrayDeque<>();
    private Scraper scraper;
    private PowerManager.WakeLock wakeLock;
    private boolean started = false;
    private boolean scraping = false;

    /** id = 0 — проверить все товары. */
    public static void start(Context c, long id) {
        Intent i = new Intent(c, CheckService.class).putExtra("id", id);
        c.startForegroundService(i);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, Notifier.working(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(1, Notifier.working(this));
        }
        long id = intent == null ? 0 : intent.getLongExtra("id", 0);
        if (id == 0) {
            for (Long x : Store.get(this).allIds()) enqueue(x);
        } else {
            enqueue(id);
        }
        if (!started) {
            started = true;
            busy = true;
            PowerManager pm = getSystemService(PowerManager.class);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "uzummonitor:check");
            wakeLock.acquire(15 * 60 * 1000L);
            final Context app = getApplicationContext();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    Updater.sync(app);   // перед проверкой подтягиваем свежую логику чтения карточки
                    handler.post(new Runnable() {
                        @Override
                        public void run() {
                            begin();
                        }
                    });
                }
            }).start();
        }
        return START_NOT_STICKY;
    }

    private void enqueue(long id) {
        if (pending.add(id)) queue.add(id);
    }

    private void begin() {
        try {
            scraper = new Scraper(this, Updater.read(this, "extract.js"));
        } catch (Exception e) {
            // на телефоне нет или обновляется системный WebView
            Long id;
            while ((id = queue.poll()) != null) {
                Store.get(this).saveError(id, "Не удалось запустить встроенный браузер (Android System WebView).");
            }
            finish();
            return;
        }
        scraping = true;
        next();
    }

    private void next() {
        final Long id = queue.poll();
        if (id == null) {
            finish();
            return;
        }
        final Store store = Store.get(this);
        final JSONObject p = store.product(id);
        if (p == null) {
            pending.remove(id);
            next();
            return;
        }
        scraper.fetch(p.optString("url"), p.optLong("product_id"), p.optLong("sku_id"), new Scraper.Callback() {
            @Override
            public void done(String status, JSONObject res, String message) {
                if ("ok".equals(status)) {
                    Store.Change ch = store.saveResult(id, res);
                    if (!ch.notify.isEmpty()) {
                        Notifier.change(CheckService.this, id, res.optString("name"), ch.notify);
                    }
                } else if ("not_found".equals(status)) {
                    if (!"not_found".equals(p.optString("status"))) {
                        Notifier.change(CheckService.this, id, p.optString("name", "Товар"),
                                "Страница товара не найдена — возможно, товар снят с продажи.");
                    }
                    store.saveNotFound(id);
                } else {
                    store.saveError(id, message == null ? "Неизвестная ошибка" : message);
                }
                pending.remove(id);
                handler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        next();
                    }
                }, queue.isEmpty() ? 0 : PAUSE_MS);
            }
        });
    }

    private void finish() {
        cleanup();
        stopForeground(true);
        stopSelf();
    }

    private void cleanup() {
        scraping = false;
        if (scraper != null) {
            scraper.destroy();
            scraper = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {
            }
        }
        pending.clear();
        queue.clear();
        busy = false;
        started = false;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        cleanup();
        super.onDestroy();
    }
}
