function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function createGoogleNoncePair(cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.getRandomValues || !cryptoApi?.subtle?.digest) {
    throw new Error('Secure sign-in is not supported on this device.');
  }

  const randomBytes = cryptoApi.getRandomValues(new Uint8Array(32));
  const nonce = bytesToBase64Url(randomBytes);
  const encodedNonce = new TextEncoder().encode(nonce);
  const hashBuffer = await cryptoApi.subtle.digest('SHA-256', encodedNonce);
  const hashedNonce = Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return { nonce, hashedNonce };
}

export async function signInWithNativeGoogle({
  supabaseClient,
  nativeGoogle,
  nonceFactory = createGoogleNoncePair,
}) {
  if (!supabaseClient?.auth || !nativeGoogle?.signIn) {
    throw new Error('Google sign-in is not configured in this build.');
  }

  const { nonce, hashedNonce } = await nonceFactory();
  const googleUser = await nativeGoogle.signIn({ nonce: hashedNonce });
  if (!googleUser?.idToken) {
    throw new Error('Google did not return an identity token.');
  }

  const { data, error } = await supabaseClient.auth.signInWithIdToken({
    provider: 'google',
    token: googleUser.idToken,
    nonce,
  });
  if (error) throw error;
  if (!data?.session) throw new Error('Google sign-in did not create a session.');
  return data;
}

export function googleSignInErrorMessage(error) {
  if (error?.code === 'SIGN_IN_CANCELLED') {
    return 'Google sign-in closed before it finished. If you selected an account, the Android sign-in setup needs checking.';
  }
  if (error?.code === 'NO_GOOGLE_ACCOUNT') {
    return 'No Google account is available on this device. Add one in Android settings and try again.';
  }
  if (error?.code === 'DEVELOPER_CONFIGURATION_ERROR') {
    return 'Google sign-in is not configured for this Android app.';
  }
  if (error?.code === 'SIGN_IN_INTERRUPTED') {
    return 'Google sign-in was interrupted. Please try again.';
  }
  if (error?.code === 'SIGN_IN_IN_PROGRESS') {
    return 'Google sign-in is already open.';
  }
  if (error?.code === 'UNSUPPORTED_DEVICE') {
    return 'Google sign-in is not supported by this device.';
  }
  return error?.message || 'Please try again.';
}
