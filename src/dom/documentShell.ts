/**
 * Inline replacement for the old global `:root { color-scheme: dark }` and
 * `html, body { margin: 0; ... }` rules in style.css — applied once at
 * startup as direct style assignments instead of a stylesheet.
 */
export function applyDocumentShellStyles(): void {
  document.documentElement.style.colorScheme = 'dark';

  const bodyStyle = document.body.style;
  bodyStyle.margin = '0';
  bodyStyle.padding = '0';
  bodyStyle.width = '100%';
  bodyStyle.height = '100%';
  bodyStyle.overflow = 'hidden';
  bodyStyle.background = '#030512';
  bodyStyle.fontFamily = "'Tajawal', system-ui, 'Segoe UI', Roboto, sans-serif";
}
