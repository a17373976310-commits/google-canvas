const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.86;

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Image decode failed'));
  img.src = src;
});

export const fileToOptimizedImageDataUrl = async (
  file: File,
  options: { maxEdge?: number; quality?: number } = {}
): Promise<string> => {
  const original = await readFileAsDataUrl(file);
  const maxEdge = options.maxEdge || DEFAULT_MAX_EDGE;
  const quality = options.quality || DEFAULT_QUALITY;

  try {
    const image = await loadImage(original);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) return original;

    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;

    // White backing avoids black backgrounds when transparent PNGs are encoded as JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    const optimized = canvas.toDataURL('image/jpeg', quality);
    return optimized.length < original.length ? optimized : original;
  } catch {
    return original;
  }
};
