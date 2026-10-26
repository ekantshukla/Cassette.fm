package fm.cassette.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Called from the web code (src/app/services/native.service.ts).
 *  - update(): shows / refreshes the "Now playing" notification and keeps the app alive
 *              while music plays with the screen off.
 *  - stop():   removes the notification.
 * Taps on the notification buttons come back to the web code as "action" events.
 */
@CapacitorPlugin(
    name = "Playback",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class PlaybackPlugin extends Plugin {

    private static PlaybackPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Sent by PlaybackService when a notification button is pressed. */
    static void sendAction(String action) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        instance.notifyListeners("action", data, true);
    }

    @PluginMethod
    public void update(PluginCall call) {
        // Android 13+ asks once before showing notifications. Music plays either way.
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) {
            requestPermissionForAlias("notifications", call, "afterPermission");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        startService(call);
    }

    private void startService(PluginCall call) {
        String title = call.getString("title", "Cassette.fm");
        String artist = call.getString("artist", "");
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", true));
        try {
            // Already running: just refresh the notification (no new start, which Android may refuse in the background).
            PlaybackService running = PlaybackService.instance;
            if (running != null) {
                running.show(title, artist, playing);
                call.resolve();
                return;
            }
            Intent intent = new Intent(getContext(), PlaybackService.class);
            intent.putExtra("title", title);
            intent.putExtra("artist", artist);
            intent.putExtra("playing", playing);
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception e) {
            // e.g. Android refusing a start from the background: music still plays, just no notification.
            call.resolve();
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }
}
