export const THEMES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'liquid-glass', label: 'Liquid Glass' },
  { value: 'material-you', label: 'Material You' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'hand-drawn', label: 'Hand-drawn' },
  { value: 'y2k-chrome', label: 'Y2K Chrome' },
  { value: 'bauhaus', label: 'Bauhaus' },
  { value: 'pixel-art', label: 'Pixel Art' },
  { value: 'aurora-gradient', label: 'Aurora Gradient' },
  { value: 'vaporwave', label: 'Vaporwave' },
  { value: 'manga', label: 'Manga' },
] as const;

export type Theme = (typeof THEMES)[number]['value'];

export function resolveTheme(value: unknown): Theme {
  return THEMES.find(theme => theme.value === value)?.value ?? 'dark';
}
