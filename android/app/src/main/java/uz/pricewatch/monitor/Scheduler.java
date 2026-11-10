package uz.pricewatch.monitor;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Будильник на ближайшие :00 или :30. */
public class Scheduler {

    private static final long HALF_HOUR = 30 * 60 * 1000L;

    public static long nextSlot(long nowMs) {
        return (nowMs / HALF_HOUR + 1) * HALF_HOUR;
    }

    public static boolean exactAllowed(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        return Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
    }

    public static void scheduleNext(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = PendingIntent.getBroadcast(c, 1, new Intent(c, AlarmReceiver.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        long t = nextSlot(System.currentTimeMillis());
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
