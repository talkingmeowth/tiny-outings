import { comparisonTokens } from './activityDuplicates.js';

function comparableName(value) {
  return comparisonTokens(value).join(' ');
}

export function activityNameMatchesSearch(activity, query) {
  const queryTokens = comparisonTokens(query);
  if (!queryTokens.length) return false;

  const nameTokens = comparisonTokens(activity?.activity_name);
  if (!nameTokens.length) return false;

  return queryTokens.every((queryToken) => nameTokens.some((nameToken) => (
    nameToken === queryToken
      || (queryToken.length >= 3 && nameToken.startsWith(queryToken))
  )));
}

export function activityNameSearchScore(activity, query) {
  const queryName = comparableName(query);
  const activityName = comparableName(activity?.activity_name);
  if (!queryName || !activityName) return 0;
  if (activityName === queryName) return 3;
  if (activityName.startsWith(queryName)) return 2;
  return 1;
}

export function sortActivityNameSearchResults(activities, query) {
  return [...activities].sort((left, right) => {
    const scoreDifference = activityNameSearchScore(right, query) - activityNameSearchScore(left, query);
    if (scoreDifference) return scoreDifference;
    return String(left.activity_name || '').localeCompare(String(right.activity_name || ''));
  });
}
