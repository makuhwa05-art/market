const ASSET_MODULES = import.meta.glob('../assets/images/*', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const ASSET_BY_PATH: Record<string, string> = {};
for (const [relativePath, resolvedUrl] of Object.entries(ASSET_MODULES)) {
  // relativePath looks like "../assets/images/foo.jpg"
  const filename = relativePath.split('/').pop();
  if (filename) {
    ASSET_BY_PATH[`/src/assets/images/${filename}`] = resolvedUrl;
  }
}

export function resolveAssetUrl(src?: string | null): string | undefined {
  if (!src) return undefined;
  return ASSET_BY_PATH[src] ?? src;
}
