package com.tinyoutings.app;

import com.getcapacitor.BridgeActivity;

import android.os.Bundle;
import android.content.res.Configuration;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(TinyOutingsGooglePlugin.class);
    super.onCreate(savedInstanceState);
    updateSystemTheme();
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

  @Override
  public void onConfigurationChanged(Configuration configuration) {
    super.onConfigurationChanged(configuration);
    updateSystemTheme();
  }

  // This Activity handles uiMode changes without recreation. Refresh native
  // chrome alongside CSS prefers-color-scheme, preserving the current screen.
  private void updateSystemTheme() {
    boolean dark = (getResources().getConfiguration().uiMode
        & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    int canvas = getResources().getColor(R.color.design19_canvas, getTheme());
    getWindow().setStatusBarColor(canvas);
    getWindow().setNavigationBarColor(canvas);
    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
        .setAppearanceLightStatusBars(!dark);
    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
        .setAppearanceLightNavigationBars(!dark);
    if (getBridge() != null && getBridge().getWebView() != null) {
      getBridge().getWebView().setBackgroundColor(canvas);
    }
  }
}
