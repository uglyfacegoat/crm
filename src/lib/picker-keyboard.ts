// Move focus without changing the saved choice. Enter on an option confirms it;
// Home/End still edit text normally while the search input has focus.
export function focusPickerOption(root: HTMLElement | null, key: string) {
  if (!root || !["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return false;
  const options = Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-picker-option]:not(:disabled)"));
  if (!options.length) return false;
  const current = options.findIndex(option => option === root.ownerDocument.activeElement);
  if ((key === "Home" || key === "End") && current < 0) return false;
  const next = key === "Home" ? 0 : key === "End" ? options.length - 1
    : current < 0 ? key === "ArrowUp" ? options.length - 1 : 0
      : (current + (key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
  options[next].focus();
  return true;
}
