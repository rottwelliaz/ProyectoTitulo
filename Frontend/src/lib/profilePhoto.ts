// This is a rendering boundary, not an image decoder. The backend decodes uploads.
// Keep legacy raster data URLs and http(s)/local image URLs, reject active schemes.
export function safePhotoUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f<>"'\\]/.test(value)) return null;
  if (value.startsWith('data:')) {
    if (value.length > 5_600_000) return null;
    return /^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
  }
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export const photoBackground = (value: unknown) => {
  const url = safePhotoUrl(value);
  return url ? `url(${JSON.stringify(url)})` : '';
};

// Assign only a CSSOM property, never interpolate a photo into parsed HTML/style.
export function setPhotoBackground(element: HTMLElement, value: unknown, property = 'background-image') {
  const background = photoBackground(value);
  element.style.setProperty(property, background);
  element.classList.toggle('has-photo', Boolean(background));
  return Boolean(background);
}
