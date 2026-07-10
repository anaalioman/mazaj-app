/**
 * A native <input type="file">'s own button+filename rendering is drawn by
 * the browser/WebView's internal shadow DOM, not by our CSS — padding and
 * borders applied to the host element don't reach those internal parts, so
 * the look is inconsistent (and can visibly overlap) across Android WebView
 * versions. Instead we visually hide the native input and drive a plain
 * text label from its `change` event, giving full, predictable control.
 */
export function wireFilePickerLabel(input: HTMLInputElement, nameEl: HTMLElement, placeholder: string): void {
  input.addEventListener('change', () => {
    nameEl.textContent = input.files?.[0]?.name ?? placeholder;
  });
}
