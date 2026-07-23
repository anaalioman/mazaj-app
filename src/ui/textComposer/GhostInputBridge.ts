import { createHiddenTextArea, watchTextAreaSelectionChange } from '../../dom/shadowServices';

export interface GhostInputBridgeCallbacks {
  /**
   * The composer's own current text at the moment an `input` event fires —
   * NOT a value this bridge could safely cache locally, since the composer
   * can set its text programmatically (e.g. reopening pre-filled with
   * previously-committed text), which never fires a native `input` event
   * and would silently desync a locally-tracked "previous value" from the
   * composer's real state.
   */
  getCurrentText: () => string;
  /** Fired on every `input` event, with the text as it was *before* this change (from `getCurrentText()`) and as it is now (`input.value`). */
  onTextChange: (oldText: string, newText: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  /** Fired whenever the real textarea's own selection moves without the text itself changing (arrow keys, a native long-press-drag) — see the constructor's own doc comment on why `selectionchange` needs its own listener separate from `input`. */
  onSelectionChange: () => void;
}

/**
 * The one deliberate DOM element in this whole feature — a real `<textarea>`
 * (not `<input>`: a single-line input silently drops the Enter key, which is
 * exactly the key that has to survive here to produce a real `\n` in the
 * composed text), invisible (`opacity: 0`, `pointer-events: none`, see
 * createHiddenTextArea()) and never positioned over anything: Pixi's own
 * hit-testing on the input pill (see InputFieldView) is what decides whether
 * a tap counts, and `.focus()` needs no visual placement to raise the OS
 * keyboard, so there is nothing to keep in sync on layout/resize.
 *
 * Focusing it (InputFieldView's own `pointerdown` handler calls `.focus()`)
 * raises the device's own OS keyboard — autocorrect, predictive text,
 * personal dictionary, voice input, a real Return key, all free. Its `input`
 * event is the single bridge back into Pixi: the composer's `text` field is
 * fed from `.value` here, driving the exact same refreshInputVisual()
 * pipeline every other change to that text already goes through, so the
 * scroll/mask built for it works identically regardless of where a
 * character (or a newline) came from.
 *
 * A prior revision of TextComposer instead hand-drew every key of a full
 * Arabic keyboard in Pixi, trading every one of the OS features above away
 * for zero DOM. Both are legitimate, deliberate architectural choices —
 * this is the second one.
 */
export function createGhostInputBridge(callbacks: GhostInputBridgeCallbacks): HTMLTextAreaElement {
  const input = createHiddenTextArea();
  input.addEventListener('input', () => {
    const oldText = callbacks.getCurrentText();
    const newText = input.value;
    callbacks.onTextChange(oldText, newText);
  });
  input.addEventListener('focus', () => callbacks.onFocus());
  input.addEventListener('blur', () => callbacks.onBlur());
  watchTextAreaSelectionChange(input, callbacks.onSelectionChange);
  return input;
}
