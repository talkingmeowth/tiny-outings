package com.tinyoutings.app;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.credentials.CredentialManager;
import androidx.credentials.GetCredentialRequest;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Instrumented test, which will execute on an Android device.
 *
 * @see <a href="http://d.android.com/tools/testing">Testing documentation</a>
 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {

    @Test
    public void useAppContext() throws Exception {
        // Context of the app under test.
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        assertEquals("com.tinyoutings.app", appContext.getPackageName());
    }

    @Test
    public void googleCredentialRequestIsConfigured() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String clientId = appContext.getString(R.string.google_web_client_id);
        CredentialManager credentialManager = CredentialManager.create(appContext);
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(clientId).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build();

        assertFalse(clientId.trim().isEmpty());
        assertTrue(clientId.endsWith(".apps.googleusercontent.com"));
        assertNotNull(credentialManager);
        assertEquals(1, request.getCredentialOptions().size());
    }
}
