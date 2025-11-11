// Wrap react-dnd refs safely for TypeScript
// Accept any function-like dndRef and forward the DOM node.
export function wrapDndRef<T extends HTMLElement>(
  node: T | null,
  dndRef?: ((instance: T | null) => void) | any
) {
  if (!dndRef) return;
  try {
    // cast to any to allow react-dnd's ConnectDragSource / ConnectDropTarget types
    (dndRef as any)(node);
  } catch (e) {
    // ignore
  }
}

