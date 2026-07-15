package com.mazaj.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GalleryStorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
