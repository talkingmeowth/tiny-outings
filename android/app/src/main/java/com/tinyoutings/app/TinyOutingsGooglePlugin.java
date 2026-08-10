package com.tinyoutings.app;

import android.app.Activity;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;

@CapacitorPlugin(name = "TinyOutingsGoogle")
public class TinyOutingsGooglePlugin extends Plugin {
  private GoogleSignInClient client;

  @Override
  public void load() {
    String clientId = getContext().getString(R.string.google_web_client_id);
    GoogleSignInOptions options = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
      .requestIdToken(clientId)
      .requestEmail()
      .build();
    client = GoogleSignIn.getClient(getContext(), options);
  }

  @PluginMethod
  public void signIn(PluginCall call) {
    startActivityForResult(call, client.getSignInIntent(), "handleSignInResult");
  }

  @ActivityCallback
  private void handleSignInResult(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
      call.reject("Google sign-in was cancelled.");
      return;
    }

    Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(result.getData());
    try {
      GoogleSignInAccount account = task.getResult(ApiException.class);
      String idToken = account.getIdToken();
      if (idToken == null || idToken.isEmpty()) {
        call.reject("Google did not return an identity token.");
        return;
      }

      JSObject user = new JSObject();
      user.put("idToken", idToken);
      user.put("email", account.getEmail());
      user.put("name", account.getDisplayName());
      user.put("imageUrl", account.getPhotoUrl() == null ? null : account.getPhotoUrl().toString());
      call.resolve(user);
    } catch (ApiException exception) {
      call.reject("Google account sign-in failed.", String.valueOf(exception.getStatusCode()), exception);
    }
  }
}
