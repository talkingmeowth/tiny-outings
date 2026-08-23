export function assertPipelineOptions({ applyChanges, applyOnly }) {
  if (applyOnly && !applyChanges) {
    throw new Error('--apply-only reuses prior generated SQL and must be used together with --apply.');
  }
}

export function hasActivityDatabaseChanges(sqlText) {
  return /\b(?:insert|update|delete)\s+(?:into\s+)?public\.activities\b/i.test(String(sqlText || ''));
}

export function generatedOutputIsFresh(previousModifiedAt, nextModifiedAt) {
  if (!Number.isFinite(nextModifiedAt)) return false;
  return !Number.isFinite(previousModifiedAt) || nextModifiedAt > previousModifiedAt;
}
