// Historical fixture contracts continue to assert every released video unchanged.
// New image-post contracts are covered separately by ready-posts.test.mjs.
export function legacyVideoCatalog(value) {
  value.catalog = value.catalog.filter(item => item.mediaKind !== 'image');
  const ids = new Set(value.catalog.map(item => item.id));
  value.dailySelection.videoIds = value.dailySelection.videoIds.filter(id => ids.has(id));
  return value;
}
