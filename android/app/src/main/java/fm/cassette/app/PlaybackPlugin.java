package fm.cassette.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

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

    /** Sent by PlaybackService when a notification / lock-screen / headphone button is pressed. */
    static void sendAction(String action, double position) {
        if (instance == null || action == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        if (position >= 0) data.put("position", position);
        instance.notifyListeners("action", data, true);
    }

    /** Whether Android lets the app show notifications (needed for the controls with the screen off). */
    @PluginMethod
    public void notificationsEnabled(PluginCall call) {
        JSObject res = new JSObject();
        res.put("enabled", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(res);
    }

    /** Opens this app's notification settings, so the listener can switch them on. */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= 26) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + getContext().getPackageName()));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
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
        Intent intent = new Intent(getContext(), PlaybackService.class);
        intent.putExtra("title", call.getString("title", "Cassette.fm"));
        intent.putExtra("artist", call.getString("artist", ""));
        intent.putExtra("playing", Boolean.TRUE.equals(call.getBoolean("playing", true)));
        intent.putExtra("position", (double) call.getDouble("position", 0.0));
        intent.putExtra("duration", (double) call.getDouble("duration", 0.0));
        String artwork = call.getString("artwork");
        if (artwork != null) intent.putExtra("artwork", artwork);
        try {
            // Already running: just refresh the notification (no new start, which Android may refuse in the background).
            PlaybackService running = PlaybackService.instance;
            if (running != null) {
                running.show(intent);
                call.resolve();
                return;
            }
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
