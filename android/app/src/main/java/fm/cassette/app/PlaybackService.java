package fm.cassette.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground service with a real media notification:
 *  - ⏮ ⏯ ⏭ always visible (also when collapsed), on the lock screen and in Android's
 *    media player in Quick Settings (Android 11+), with the album cover and a seek bar
 *  - headphone / Bluetooth / car buttons work through the MediaSession
 * While it runs, Android doesn't put the app to sleep, so songs carry on with the screen off.
 */
public class PlaybackService extends Service {

    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 1017;
    static final String ACTION_BUTTON = "fm.cassette.app.BUTTON";

    /** The running service, so the plugin can refresh the notification directly. */
    static PlaybackService instance;

    private MediaSessionCompat session;
    private final ExecutorService loader = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    private String title = "Cassette.fm";
    private String artist = "";
    private boolean playing = true;
    private long positionMs = 0;
    private long durationMs = 0;
    private String artworkUrl = null;
    private Bitmap artwork = null;

    @Override
    public void onCreate() {
        super.onCreate();
        session = new MediaSessionCompat(this, "Cassette.fm");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { PlaybackPlugin.sendAction("toggle", -1); }
            @Override public void onPause() { PlaybackPlugin.sendAction("toggle", -1); }
            @Override public void onSkipToNext() { PlaybackPlugin.sendAction("next", -1); }
            @Override public void onSkipToPrevious() { PlaybackPlugin.sendAction("previous", -1); }
            @Override public void onStop() { PlaybackPlugin.sendAction("toggle", -1); }
            @Override public void onSeekTo(long pos) { PlaybackPlugin.sendAction("seek", pos / 1000.0); }
        });
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_BUTTON.equals(intent.getAction())) {
            PlaybackPlugin.sendAction(intent.getStringExtra("button"), -1);
            return START_NOT_STICKY;
        }
        if (intent != null) readExtras(intent);

        createChannel();
        updateSession();
        Notification notification = build();
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

    /** Updates the notification of the running service (new song, play/pause, position). */
    void show(Intent extras) {
        readExtras(extras);
        updateSession();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, build());
    }

    private void readExtras(Intent intent) {
        if (intent.hasExtra("title")) title = intent.getStringExtra("title");
        if (intent.hasExtra("artist")) artist = intent.getStringExtra("artist");
        if (intent.hasExtra("playing")) playing = intent.getBooleanExtra("playing", true);
        positionMs = (long) (intent.getDoubleExtra("position", positionMs / 1000.0) * 1000);
        durationMs = (long) (intent.getDoubleExtra("duration", durationMs / 1000.0) * 1000);
        String art = intent.getStringExtra("artwork");
        if (art != null && !art.equals(artworkUrl)) {
            artworkUrl = art;
            artwork = null;
            loadArtwork(art);
        }
    }

    /** Downloads the cover in the background, then refreshes the notification with it. */
    private void loadArtwork(String url) {
        loader.execute(() -> {
            Bitmap bitmap = null;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(6000);
                c.setReadTimeout(8000);
                try (InputStream in = c.getInputStream()) { bitmap = BitmapFactory.decodeStream(in); }
            } catch (Exception ignored) {
                // no cover: the notification shows without one
            }
            final Bitmap result = bitmap;
            main.post(() -> {
                if (!url.equals(artworkUrl) || result == null || instance != this) return;
                artwork = result;
                updateSession();
                NotificationManager manager = getSystemService(NotificationManager.class);
                if (manager != null) manager.notify(NOTIFICATION_ID, build());
            });
        });
    }

    private void updateSession() {
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "Cassette.fm");
        if (durationMs > 0) meta.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);
        if (artwork != null) meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
        session.setMetadata(meta.build());

        session.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO
                | PlaybackStateCompat.ACTION_STOP)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, positionMs, playing ? 1f : 0f)
            .build());
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        session.setActive(false);
        session.release();
        loader.shutdownNow();
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

    private Notification build() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openApp = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText("Cassette.fm")
            .setContentIntent(openApp)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC) // full controls on the lock screen
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(R.drawable.ic_stat_previous, "Previous", button("previous", 1))
            .addAction(playing ? R.drawable.ic_stat_pause : R.drawable.ic_stat_play, playing ? "Pause" : "Play", button("toggle", 2))
            .addAction(R.drawable.ic_stat_next, "Next", button("next", 3))
            // Media style: the three buttons stay visible even when the notification is collapsed.
            .setStyle(new MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        if (artwork != null) b.setLargeIcon(artwork);
        return b.build();
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
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }
}
