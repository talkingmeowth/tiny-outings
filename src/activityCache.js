import { ACTIVITY_SELECT_COLUMNS } from './activityColumns.js';

const CACHE_VERSION = 1;
export const ACTIVITY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const privateFields = new Set(['submitted_by_user_id', 'submission_notes', 'submission_rating']);
const cacheFields = [...ACTIVITY_SELECT_COLUMNS.split(','), 'user_uploaded_image_url']
  .filter((field) => !privateFields.has(field));

export function createActivityCacheSnapshot(activities, now = Date.now()) {
  return {
    version: CACHE_VERSION,
    savedAt: now,
    activities: activities
      .filter((activity) => activity.activity_id && activity.public_listing_status === 'published' && activity.archive === false)
      .map((activity) => Object.fromEntries(cacheFields
        .filter((field) => activity[field] !== undefined)
        .map((field) => [field, activity[field]]))),
  };
}

export function activitiesFromCacheSnapshot(snapshot, now = Date.now()) {
  if (snapshot?.version !== CACHE_VERSION || !Number.isFinite(snapshot.savedAt)
    || snapshot.savedAt > now || now - snapshot.savedAt > ACTIVITY_CACHE_MAX_AGE_MS
    || !Array.isArray(snapshot.activities)) return null;
  if (snapshot.activities.some((activity) => !activity || typeof activity !== 'object')) return null;
  return createActivityCacheSnapshot(snapshot.activities, snapshot.savedAt).activities;
}

// IndexedDB keeps the directory out of synchronous localStorage and its small
// quota. A disabled/full database is a cache miss, never a startup failure.
function cacheRequest(mode, value) {
  return new Promise((resolve) => {
    let database;
    let settled = false;
    const finish = (result = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      database?.close();
      resolve(result);
    };
    const timeout = setTimeout(() => finish(), 1500);
    try {
      const request = globalThis.indexedDB.open('tiny-outings-public-directory', CACHE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('directory')) request.result.createObjectStore('directory');
      };
      request.onerror = () => finish();
      request.onblocked = () => finish();
      request.onsuccess = () => {
        database = request.result;
        if (settled) { database.close(); return; }
        try {
          const transaction = database.transaction('directory', mode);
          const store = transaction.objectStore('directory');
          const action = mode === 'readwrite' ? store.put(value, 'published') : store.get('published');
          let result = null;
          action.onsuccess = () => { result = action.result; };
          transaction.oncomplete = () => finish(result);
          transaction.onerror = () => finish();
          transaction.onabort = () => finish();
        } catch { finish(); }
      };
    } catch { finish(); }
  });
}

export async function readActivityDirectoryCache() {
  return activitiesFromCacheSnapshot(await cacheRequest('readonly'));
}

export async function writeActivityDirectoryCache(activities) {
  await cacheRequest('readwrite', createActivityCacheSnapshot(activities));
}
