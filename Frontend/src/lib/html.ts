const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};

// For HTML text and quoted attributes only, never URLs, CSS or JavaScript.
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, character => entities[character]);

// Administrative fields and messages also accept numbers and missing values.
export const escapeHtmlValue = (value: unknown): string =>
  escapeHtml(String(value ?? ''));
