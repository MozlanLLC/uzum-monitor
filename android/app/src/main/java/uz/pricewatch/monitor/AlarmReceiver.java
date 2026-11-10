package uz.pricewatch.monitor;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        Scheduler.scheduleNext(c);
        try {
            if (!Store.get(c).allIds().isEmpty()) CheckService.start(c, 0);
        } catch (Exception e) {
            Log.w("UzumMonitor", "Не удалось запустить проверку", e);
        }
    }
}
