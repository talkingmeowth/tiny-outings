export function activityIdBatches(queueRows, batchSize = 100) {
  const uniqueIds = [...new Set(
    (queueRows || [])
      .map((item) => item?.activity_id)
      .filter(Boolean)
      .map(String),
  )];

  return Array.from(
    { length: Math.ceil(uniqueIds.length / batchSize) },
    (_, index) => uniqueIds.slice(index * batchSize, (index + 1) * batchSize),
  );
}
