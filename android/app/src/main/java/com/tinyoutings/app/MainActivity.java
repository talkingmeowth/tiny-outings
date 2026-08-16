package com.tinyoutings.app;

import com.getcapacitor.BridgeActivity;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(TinyOutingsGooglePlugin.class);
    super.onCreate(savedInstanceState);
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        if (getBridge() == null) {
          setEnabled(false);
          getOnBackPressedDispatcher().onBackPressed();
          setEnabled(true);
          return;
        }
        getBridge().triggerJSEvent("tinyoutingsback", "window");
      }
    });
  }
}
