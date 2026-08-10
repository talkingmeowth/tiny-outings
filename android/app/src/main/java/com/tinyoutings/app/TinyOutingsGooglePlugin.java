package com.tinyoutings.app;

import android.app.Activity;
import androidx.core.content.ContextCompat;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

@CapacitorPlugin(name = "TinyOutingsGoogle")
public class TinyOutingsGooglePlugin extends Plugin {
  private CredentialManager credentialManager;

  @Override
  public void load() {
    credentialManager = CredentialManager.create(getContext());
  }

  @PluginMethod
  public void signIn(PluginCall call) {
    Activity activity = getActivity();
    if (activity == null) {
      call.reject("Google sign-in cannot open right now.", "NO_ACTIVITY");
      return;
    }

    String clientId = getContext().getString(R.string.google_web_client_id).trim();
    if (clientId.isEmpty()) {
      call.reject("Google sign-in is not configured.", "DEVELOPER_CONFIGURATION_ERROR");
      return;
    }

    GetSignInWithGoogleOption.Builder optionBuilder = new GetSignInWithGoogleOption.Builder(clientId);
    String nonce = call.getString("nonce");
    if (nonce != null && !nonce.isEmpty()) optionBuilder.setNonce(nonce);

    GetCredentialRequest request = new GetCredentialRequest.Builder()
      .addCredentialOption(optionBuilder.build())
      .build();

    credentialManager.getCredentialAsync(
      activity,
      request,
      null,
      ContextCompat.getMainExecutor(activity),
      new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
        @Override
        public void onResult(GetCredentialResponse response) {
          resolveCredential(call, response.getCredential());
        }

        @Override
        public void onError(GetCredentialException error) {
          rejectCredentialError(call, error);
        }
      }
    );
  }

  @PluginMethod
  public void signOut(PluginCall call) {
    credentialManager.clearCredentialStateAsync(
      new ClearCredentialStateRequest(),
      null,
      ContextCompat.getMainExecutor(getContext()),
      new CredentialManagerCallback<Void, ClearCredentialException>() {
        @Override
        public void onResult(Void result) {
          call.resolve();
        }

        @Override
        public void onError(ClearCredentialException error) {
          call.reject("Google credential state could not be cleared.", "CREDENTIAL_CLEAR_FAILED", error);
        }
      }
    );
  }

  private void resolveCredential(PluginCall call, Credential credential) {
    if (!(credential instanceof CustomCredential)) {
      call.reject("Google returned an unsupported credential.", "UNSUPPORTED_CREDENTIAL");
      return;
    }

    CustomCredential customCredential = (CustomCredential) credential;
    if (!GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(customCredential.getType())) {
      call.reject("Google returned an unsupported credential.", "UNSUPPORTED_CREDENTIAL");
      return;
    }

    try {
      GoogleIdTokenCredential googleCredential = GoogleIdTokenCredential.createFrom(customCredential.getData());
      String idToken = googleCredential.getIdToken();
      if (idToken == null || idToken.isEmpty()) {
        call.reject("Google did not return an identity token.", "MISSING_ID_TOKEN");
        return;
      }

      JSObject user = new JSObject();
      user.put("idToken", idToken);
      user.put("email", googleCredential.getId());
      user.put("name", googleCredential.getDisplayName());
      user.put(
        "imageUrl",
        googleCredential.getProfilePictureUri() == null
          ? null
          : googleCredential.getProfilePictureUri().toString()
      );
      call.resolve(user);
    } catch (IllegalArgumentException error) {
      call.reject("Google returned an invalid identity token.", "INVALID_ID_TOKEN", error);
    }
  }

  private void rejectCredentialError(PluginCall call, GetCredentialException error) {
    if (error instanceof GetCredentialCancellationException) {
      call.reject("Google sign-in was cancelled.", "SIGN_IN_CANCELLED", error);
    } else if (error instanceof NoCredentialException) {
      call.reject("No Google account is available on this device.", "NO_GOOGLE_ACCOUNT", error);
    } else {
      call.reject("Google account sign-in failed.", "GOOGLE_SIGN_IN_FAILED", error);
    }
  }
}
