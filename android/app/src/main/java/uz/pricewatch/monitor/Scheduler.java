package uz.pricewatch.monitor;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Будильник на ближайшие :00 или :30.
 * Проверки можно остановить: на время (paused_until — время возобновления в секундах) или пока пользователь
 * не включит их снова (paused_until = -1). Пока проверки остановлены, будильник не ставится и приложение
 * не работает в фоне.
 */
public class Scheduler {

    private static final long HALF_HOUR = 30 * 60 * 1000L;

    public static long nextSlot(long nowMs) {
        return (nowMs / HALF_HOUR + 1) * HALF_HOUR;
    }

    public static boolean exactAllowed(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        return Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
    }

    /** Время возобновления проверок в секундах; -1 — остановлены, пока не включат; 0 — работают. */
    public static long pausedUntil(Context c) {
        return Store.prefs(c).getLong("paused_until", 0);
    }

    public static boolean paused(Context c) {
        long p = pausedUntil(c);
        return p < 0 || p * 1000 > System.currentTimeMillis();
    }

    /** until: 0 — возобновить, -1 — остановить, пока не включат, иначе — время возобновления в секундах. */
    public static void setPaused(Context c, long until) {
        if (until > 0 && until * 1000 <= System.currentTimeMillis()) until = 0;
        Store.prefs(c).edit().putLong("paused_until", until < 0 ? -1 : until).apply();
        scheduleNext(c);
    }

    private static PendingIntent alarm(Context c) {
        return PendingIntent.getBroadcast(c, 1, new Intent(c, AlarmReceiver.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void scheduleNext(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = alarm(c);
        long now = System.currentTimeMillis(), p = pausedUntil(c);
        if (p < 0) {
            am.cancel(pi);
            Store.prefs(c).edit().putLong("next_run", 0).apply();
            return;
        }
        long t = nextSlot(now);
        if (p * 1000 > now) t = Math.max(t, nextSlot(p * 1000 - 1));   // первое :00 или :30 после возобновления
        try {
            if (exactAllowed(c)) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi);
            }
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi);
        }
        Store.prefs(c).edit().putLong("next_run", t / 1000).apply();
    }
}
