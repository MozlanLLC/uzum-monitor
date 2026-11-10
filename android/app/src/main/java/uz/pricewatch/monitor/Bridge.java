package uz.pricewatch.monitor;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

/** Функции приложения, доступные интерфейсу (ui.html) как window.Android. */
public class Bridge {

    private final MainActivity act;

    public Bridge(MainActivity a) {
        act = a;
    }

    @JavascriptInterface
    public String getState() {
        try {
            JSONObject o = new JSONObject();
            o.put("products", Store.get(act).products());
            o.put("busy", CheckService.busy);
            JSONArray pend = new JSONArray();
            synchronized (CheckService.pending) {
                for (Long id : CheckService.pending) pend.put(id);
            }
            o.put("pending", pend);
            o.put("next_run", Store.prefs(act).getLong("next_run", 0));
            o.put("now", System.currentTimeMillis() / 1000);
            JSONObject info = new JSONObject();
            info.put("app", BuildConfig.VERSION_NAME);
            info.put("web", Updater.currentVersion(act));
            info.put("notif", act.getSystemService(NotificationManager.class).areNotificationsEnabled());
            info.put("exact", Scheduler.exactAllowed(act));
            info.put("battery", act.getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(act.getPackageName()));
            info.put("notify_stock", Store.prefs(act).getBoolean("notify_stock", true));
            o.put("info", info);
            return o.toString();
        } catch (Exception e) {
            return "{\"error\":\"state\"}";
        }
    }

    @JavascriptInterface
    public String getHistory(double id) {
        try {
            return new JSONObject().put("checks", Store.get(act).history((long) id)).toString();
        } catch (Exception e) {
            return "{\"checks\":[]}";
        }
    }

    @JavascriptInterface
    public String addProduct(String text) {
        try {
            long id = Store.get(act).addProduct(text);
            CheckService.start(act, id);
            return new JSONObject().put("id", id).toString();
        } catch (Store.UserException e) {
            return error(e.getMessage());
        } catch (Exception e) {
            return error("Не удалось добавить товар.");
        }
    }

    @JavascriptInterface
    public void deleteProduct(double id) {
        Store.get(act).deleteProduct((long) id);
    }

    @JavascriptInterface
    public void check(double id) {
        try {
            CheckService.start(act, (long) id);
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void setPref(String key, String value) {
        if ("notify_stock".equals(key)) {
            Store.prefs(act).edit().putBoolean("notify_stock", "1".equals(value)).apply();
        }
    }

    @JavascriptInterface
    public void openSettings(final String what) {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Uri pkg = Uri.parse("package:" + act.getPackageName());
                    if ("notifications".equals(what)) {
                        if (Build.VERSION.SDK_INT >= 33
                                && act.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                                && act.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
                            act.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
                        } else {
                            act.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                    .putExtra(Settings.EXTRA_APP_PACKAGE, act.getPackageName()));
                        }
                    } else if ("battery".equals(what)) {
                        act.startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg));
                    } else if ("alarms".equals(what) && Build.VERSION.SDK_INT >= 31) {
                        act.startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg));
                    }
                } catch (Exception e) {
                    try {
                        act.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:" + act.getPackageName())));
                    } catch (Exception ignored) {
                    }
                }
            }
        });
    }

    private static String error(String message) {
        try {
            return new JSONObject().put("error", message).toString();
        } catch (Exception e) {
            return "{\"error\":\"\"}";
        }
    }
}
