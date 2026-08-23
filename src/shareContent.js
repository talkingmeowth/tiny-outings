import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

export async function shareContent(shareData, {
  isNative = Capacitor.isNativePlatform(),
  nativeShare = Share,
  navigatorApi = globalThis.navigator,
} = {}) {
  if (isNative) {
    await nativeShare.share(shareData);
    return 'native';
  }

  if (navigatorApi?.share) {
    await navigatorApi.share(shareData);
    return 'web';
  }

  if (navigatorApi?.clipboard?.writeText) {
    await navigatorApi.clipboard.writeText(`${shareData.text || ''} ${shareData.url || ''}`.trim());
    return 'clipboard';
  }

  throw new Error('Sharing is not supported on this device.');
}
