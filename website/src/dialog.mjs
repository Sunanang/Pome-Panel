// Native <dialog> retargets backdrop clicks to the dialog itself. Its padding
// also targets the dialog, so the target alone cannot distinguish the two.
export function isDialogBackdropEvent(event) {
  if (event.target !== event.currentTarget) return false;
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right
    || event.clientY < rect.top || event.clientY > rect.bottom;
}
