import type { CollectionFolder } from '../types/api';

export const MAX_FOLDER_DEPTH = 32;

export function folderAncestors(id: string, byId: ReadonlyMap<string, CollectionFolder>) {
  const ancestors: CollectionFolder[] = [];
  const seen = new Set([id]);
  let parent = byId.get(id)?.desktopParent;
  while (parent && !seen.has(parent)) {
    const folder = byId.get(parent);
    if (!folder) break;
    ancestors.unshift(folder);
    seen.add(parent);
    parent = folder.desktopParent;
  }
  return ancestors;
}
