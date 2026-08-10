import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGoogleNoncePair,
  googleSignInErrorMessage,
  signInWithNativeGoogle,
} from './googleAuth.js';

const nonceFactory = async () => ({ nonce: 'raw-nonce', hashedNonce: 'hashed-nonce' });

test('nonce generation returns a random value and its SHA-256 hash', async () => {
  const cryptoApi = {
    getRandomValues: (bytes) => {
      bytes.fill(7);
      return bytes;
    },
    subtle: {
      digest: async () => new Uint8Array(32).fill(0xab).buffer,
    },
  };

  const pair = await createGoogleNoncePair(cryptoApi);
  assert.ok(pair.nonce.length > 20);
  assert.equal(pair.hashedNonce, 'ab'.repeat(32));
});

test('native Google token is exchanged for a Supabase session', async () => {
  const calls = [];
  const nativeGoogle = {
    signIn: async (options) => {
      calls.push(['native', options]);
      return { idToken: 'google-id-token' };
    },
  };
  const supabaseClient = {
    auth: {
      signInWithIdToken: async (credentials) => {
        calls.push(['supabase', credentials]);
        return { data: { session: { access_token: 'supabase-token' } }, error: null };
      },
    },
  };

  const data = await signInWithNativeGoogle({ supabaseClient, nativeGoogle, nonceFactory });

  assert.equal(data.session.access_token, 'supabase-token');
  assert.deepEqual(calls, [
    ['native', { nonce: 'hashed-nonce' }],
    ['supabase', { provider: 'google', token: 'google-id-token', nonce: 'raw-nonce' }],
  ]);
});

test('missing Google ID token never reaches Supabase', async () => {
  let exchanged = false;
  const supabaseClient = {
    auth: {
      signInWithIdToken: async () => {
        exchanged = true;
        return { data: null, error: null };
      },
    },
  };

  await assert.rejects(
    signInWithNativeGoogle({
      supabaseClient,
      nativeGoogle: { signIn: async () => ({}) },
      nonceFactory,
    }),
    /identity token/,
  );
  assert.equal(exchanged, false);
});

test('Supabase token exchange errors are preserved', async () => {
  const providerError = new Error('Provider is disabled');
  await assert.rejects(
    signInWithNativeGoogle({
      supabaseClient: {
        auth: { signInWithIdToken: async () => ({ data: null, error: providerError }) },
      },
      nativeGoogle: { signIn: async () => ({ idToken: 'token' }) },
      nonceFactory,
    }),
    providerError,
  );
});

test('native cancellation and missing-account errors have useful copy', () => {
  assert.equal(
    googleSignInErrorMessage({ code: 'SIGN_IN_CANCELLED' }),
    'Google sign-in was cancelled.',
  );
  assert.match(googleSignInErrorMessage({ code: 'NO_GOOGLE_ACCOUNT' }), /Android settings/);
});
