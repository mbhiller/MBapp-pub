export async function forEachBatched<T>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (batchSize <= 0) {
    throw new Error("batchSize must be positive");
  }

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map((item) => fn(item)));
  }
}
