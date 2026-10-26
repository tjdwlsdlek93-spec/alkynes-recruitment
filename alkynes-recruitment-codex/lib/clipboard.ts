// Private VPN HTTP addresses may not expose navigator.clipboard.
export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch {}
  }
  const previous = document.activeElement as HTMLElement | null;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px;';
  // A modal makes the rest of the document inert; select inside the open dialog.
  const container = previous?.closest('dialog[open]') || document.querySelector('dialog[open]') || document.body;
  container.appendChild(input);
  try {
    input.focus(); input.select(); input.setSelectionRange(0, input.value.length);
    if (!document.execCommand('copy')) throw Error('복사할 수 없습니다.');
  } finally {
    input.remove(); previous?.focus({ preventScroll: true });
    if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
  }
}
