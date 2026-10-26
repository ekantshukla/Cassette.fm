package fm.cassette.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Foreground service with a "Now playing" notification (previous / play-pause / next).
 * While it runs, Android doesn't put the app to sleep, so songs carry on with the screen off.
 */
public class PlaybackService extends Service {

    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 1017;
    static final String ACTION_BUTTON = "fm.cassette.app.BUTTON";

    /** The running service, so the plugin can refresh the notification directly. */
    static PlaybackService instance;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_BUTTON.equals(intent.getAction())) {
            PlaybackPlugin.sendAction(intent.getStringExtra("button"));
            return START_NOT_STICKY;
        }

        String title = intent != null ? intent.getStringExtra("title") : null;
        String artist = intent != null ? intent.getStringExtra("artist") : null;
        boolean playing = intent == null || intent.getBooleanExtra("playing", true);

        createChannel();
        Notification notification = build(title != null ? title : "Cassette.fm", artist != null ? artist : "", playing);
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
            instance = this;
        } catch (Exception e) {
            // Android refused (e.g. started from the background): music plays on, just without the notification.
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    /** Updates the notification of the running service (new song, play/pause). */
    void show(String title, String artist, boolean playing) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, build(title, artist, playing));
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    /** Swiping the app away from recent apps stops the music too. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (instance == this) instance = null;
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification build(String title, String artist, boolean playing) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openApp = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(openApp)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .addAction(R.drawable.ic_stat_previous, "Previous", button("previous", 1))
            .addAction(playing ? R.drawable.ic_stat_pause : R.drawable.ic_stat_play, playing ? "Pause" : "Play", button("toggle", 2))
            .addAction(R.drawable.ic_stat_next, "Next", button("next", 3))
            .build();
    }

    private PendingIntent button(String name, int requestCode) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(ACTION_BUTTON).putExtra("button", name);
        return PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Now playing", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Song controls while music plays");
        channel.setShowBadge(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }
}
