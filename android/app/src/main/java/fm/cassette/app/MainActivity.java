package fm.cassette.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own small plugin: keeps music playing with the screen off (see PlaybackPlugin).
        registerPlugin(PlaybackPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
