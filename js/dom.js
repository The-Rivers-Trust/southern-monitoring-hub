// Small element builder. Text always goes in as text, never as HTML,
// because site names and notes in the data are typed in by the public.
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
