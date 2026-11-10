package uz.pricewatch.monitor;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Обновление «начинки» без переустановки APK: интерфейс (ui.html) и логика чтения
 * карточки (extract.js) скачиваются из папки web/ репозитория, если там версия новее.
 */
public class Updater {

    private static final Object LOCK = new Object();

    /** Единственный адрес, с которого принимаются обновления: папка web/ ветки main этого репозитория. */
    private static final String ALLOWED_BASE =
            "https://raw.githubusercontent.com/MozlanLLC/uzum-monitor/main/web/";

    private static File dir(Context c) {
        return new File(c.getFilesDir(), "web");
    }

    private static int bundledVersion(Context c) {
        try (InputStream in = c.getAssets().open("web/manifest.json")) {
            return new JSONObject(new String(readAll(in), StandardCharsets.UTF_8)).optInt("version", 0);
        } catch (Exception e) {
            return 0;
        }
    }

    private static int downloadedVersion(Context c) {
        return Store.prefs(c).getInt("web_version", 0);
    }

    public static int currentVersion(Context c) {
        return Math.max(bundledVersion(c), downloadedVersion(c));
    }

    /** Текст файла: скачанная версия, если она новее встроенной, иначе встроенная. */
    public static String read(Context c, String name) {
        synchronized (LOCK) {
            if (downloadedVersion(c) > bundledVersion(c)) {
                File f = new File(dir(c), name);
                if (f.exists()) {
                    try (InputStream in = new FileInputStream(f)) {
                        return new String(readAll(in), StandardCharsets.UTF_8);
                    } catch (IOException ignored) {
                    }
                }
            }
            try (InputStream in = c.getAssets().open("web/" + name)) {
                return new String(readAll(in), StandardCharsets.UTF_8);
            } catch (IOException e) {
                return "";
            }
        }
    }

    /** Проверяет обновление. Вызывать не из главного потока. true — скачана новая версия. */
    public static boolean sync(Context c) {
        try {
            String base = BuildConfig.UPDATE_BASE;
            if (!ALLOWED_BASE.equals(base)) return false;
            String bust = "?t=" + (System.currentTimeMillis() / 60000);
            JSONObject man = new JSONObject(new String(download(base + "manifest.json" + bust), StandardCharsets.UTF_8));
            int version = man.optInt("version", 0);
            if (version <= currentVersion(c)) return false;
            JSONArray files = man.optJSONArray("files");
            if (files == null || files.length() == 0) return false;
            String[] names = new String[files.length()];
            byte[][] data = new byte[files.length()][];
            for (int i = 0; i < names.length; i++) {
                names[i] = files.getString(i);
                if (!names[i].matches("[A-Za-z0-9._-]+")) return false;
                data[i] = download(base + names[i] + bust);
                if (data[i].length == 0) return false;
            }
            synchronized (LOCK) {
                File d = dir(c);
                if (!d.exists() && !d.mkdirs()) return false;
                for (int i = 0; i < names.length; i++) {
                    File tmp = new File(d, names[i] + ".tmp");
                    try (FileOutputStream out = new FileOutputStream(tmp)) {
                        out.write(data[i]);
                    }
                    File dst = new File(d, names[i]);
                    if (dst.exists() && !dst.delete()) return false;
                    if (!tmp.renameTo(dst)) return false;
                }
                Store.prefs(c).edit().putInt("web_version", version).apply();
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static byte[] download(String url) throws IOException {
        if (!url.startsWith(ALLOWED_BASE)) throw new IOException("Чужой адрес обновления");
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        // Переадресацию не принимаем: файл должен прийти именно с разрешённого адреса
        con.setInstanceFollowRedirects(false);
        con.setConnectTimeout(7000);
        con.setReadTimeout(10000);
        con.setUseCaches(false);
        try {
            if (con.getResponseCode() != 200) throw new IOException("HTTP " + con.getResponseCode());
            try (InputStream in = con.getInputStream()) {
                return readAll(in);
            }
        } finally {
            con.disconnect();
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }
}
