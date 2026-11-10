package uz.pricewatch.monitor;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

public class Notifier {

    private static final String CH_CHANGES = "changes";
    private static final String CH_WORK = "work";

    public static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel changes = new NotificationChannel(CH_CHANGES, "Изменения цены и наличия",
                NotificationManager.IMPORTANCE_HIGH);
        NotificationChannel work = new NotificationChannel(CH_WORK, "Идёт проверка",
                NotificationManager.IMPORTANCE_LOW);
        work.setShowBadge(false);
        nm.createNotificationChannel(changes);
        nm.createNotificationChannel(work);
    }

    private static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static Notification working(Context c) {
        channels(c);
        return new Notification.Builder(c, CH_WORK)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("Проверяю цены на Uzum")
                .setOngoing(true)
                .setContentIntent(openApp(c))
                .build();
    }

    public static void change(Context c, long productId, String name, String text) {
        channels(c);
        Notification n = new Notification.Builder(c, CH_CHANGES)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(name)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(openApp(c))
                .build();
        try {
            c.getSystemService(NotificationManager.class).notify((int) (1000 + productId), n);
        } catch (Exception ignored) {
        }
    }
}
