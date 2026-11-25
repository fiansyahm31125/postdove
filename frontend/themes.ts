export const COLOR_MODES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
] as const;

export const STYLES = [
  { value: 'minimalism', label: 'Minimalism', defaultMode: 'dark' },
  { value: 'liquid-glass', label: 'Liquid Glass', defaultMode: 'dark' },
  { value: 'material-you', label: 'Material You', defaultMode: 'light' },
  { value: 'terminal', label: 'Terminal', defaultMode: 'dark' },
  { value: 'hand-drawn', label: 'Hand-drawn', defaultMode: 'light' },
  { value: 'y2k-chrome', label: 'Y2K Chrome', defaultMode: 'light' },
  { value: 'bauhaus', label: 'Bauhaus', defaultMode: 'light' },
  { value: 'pixel-art', label: 'Pixel Art', defaultMode: 'dark' },
  { value: 'aurora-gradient', label: 'Aurora Gradient', defaultMode: 'dark' },
  { value: 'vaporwave', label: 'Vaporwave', defaultMode: 'dark' },
  { value: 'manga', label: 'Manga', defaultMode: 'light' },
] as const;

export interface Appearance {
  mode: (typeof COLOR_MODES)[number]['value'];
  style: (typeof STYLES)[number]['value'];
}

export function resolveAppearance(saved?: Appearance, legacyTheme?: string): Appearance {
  const style = STYLES.find(option => option.value === (saved?.style ?? legacyTheme));
  const mode = COLOR_MODES.find(option => option.value === (saved?.mode ?? legacyTheme));
  return { mode: mode?.value ?? style?.defaultMode ?? 'dark', style: style?.value ?? 'minimalism' };
}
