import { ensureCanvasFontsLoaded, getCanvasFontStack } from '../services/fontRegistry';
import { DesignBoardConfig, DesignBoardTextLayer } from '../types';
import { normalizeDesignBoardConfig } from './designBoard';
import { normalizeImageSrc } from './normalizeImageSrc';

const imageCache = new Map<string, Promise<HTMLImageElement>>();

const loadImage = (src: string) => {
  if (imageCache.has(src)) return imageCache.get(src)!;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (/^https?:\/\//i.test(src)) {
      image.crossOrigin = 'anonymous';
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load design board background image.'));
    image.src = src;
  });

  imageCache.set(src, promise);
  return promise;
};

const drawImageCover = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number
) => {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const canvasRatio = width / height;
  const drawWidth = imageRatio > canvasRatio ? height * imageRatio : width;
  const drawHeight = imageRatio > canvasRatio ? height : width / imageRatio;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
};

const segmentText = (text: string) => {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  return normalized.split('\n').map((line) => {
    const tokens = line.match(/[A-Za-z0-9_.,!?;:'"()\-]+|\s+|./g);
    return tokens && tokens.length > 0 ? tokens : [''];
  });
};

const measureTextWithSpacing = (
  ctx: CanvasRenderingContext2D,
  text: string,
  letterSpacing: number
) => {
  if (!text) return 0;
  return ctx.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
};

const wrapLayerText = (
  ctx: CanvasRenderingContext2D,
  layer: DesignBoardTextLayer,
  maxWidth: number
) => {
  const lines: string[] = [];
  const letterSpacing = Number(layer.letterSpacing || 0);

  segmentText(layer.text).forEach((tokens) => {
    let current = '';
    tokens.forEach((token) => {
      const next = current ? `${current}${token}` : token;
      if (current && measureTextWithSpacing(ctx, next, letterSpacing) > maxWidth) {
        lines.push(current.trimEnd());
        current = token.trimStart();
      } else {
        current = next;
      }
    });
    lines.push(current || '');
  });

  return lines.length > 0 ? lines : [''];
};

const drawTextWithLetterSpacing = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
  draw: 'fill' | 'stroke'
) => {
  if (!letterSpacing) {
    if (draw === 'stroke') ctx.strokeText(text, x, y);
    else ctx.fillText(text, x, y);
    return;
  }

  let cursorX = x;
  Array.from(text).forEach((char) => {
    if (draw === 'stroke') ctx.strokeText(char, cursorX, y);
    else ctx.fillText(char, cursorX, y);
    cursorX += ctx.measureText(char).width + letterSpacing;
  });
};

const getAlignedX = (
  ctx: CanvasRenderingContext2D,
  line: string,
  boxLeft: number,
  boxWidth: number,
  align: DesignBoardTextLayer['align'],
  letterSpacing: number
) => {
  const width = measureTextWithSpacing(ctx, line, letterSpacing);
  if (align === 'right') return boxLeft + boxWidth - width;
  if (align === 'center') return boxLeft + (boxWidth - width) / 2;
  return boxLeft;
};

const renderLayer = (
  ctx: CanvasRenderingContext2D,
  layer: DesignBoardTextLayer,
  board: DesignBoardConfig
) => {
  const x = (layer.x / 100) * board.boardWidth;
  const y = (layer.y / 100) * board.boardHeight;
  const boxWidth = (layer.width / 100) * board.boardWidth;
  const fontSize = Number(layer.fontSize || 72);
  const lineHeight = fontSize * Number(layer.lineHeight || 1.05);
  const letterSpacing = Number(layer.letterSpacing || 0);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((Number(layer.rotation || 0) * Math.PI) / 180);
  ctx.globalAlpha = Number(layer.opacity ?? 1);
  ctx.font = `${fontSize}px ${getCanvasFontStack(layer.fontId)}`;
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.fillStyle = layer.color || '#171717';

  const lines = wrapLayerText(ctx, layer, boxWidth);
  const blockHeight = lines.length * lineHeight;
  const boxLeft = -boxWidth / 2;
  const startY = -blockHeight / 2;

  if (layer.shadow?.enabled) {
    ctx.shadowColor = layer.shadow.color || 'rgba(0,0,0,0.22)';
    ctx.shadowOffsetX = Number(layer.shadow.x || 0);
    ctx.shadowOffsetY = Number(layer.shadow.y || 0);
    ctx.shadowBlur = Number(layer.shadow.blur || 0);
  }

  lines.forEach((line, index) => {
    const lineX = getAlignedX(ctx, line, boxLeft, boxWidth, layer.align, letterSpacing);
    const lineY = startY + index * lineHeight;

    if (layer.stroke?.enabled && Number(layer.stroke.width || 0) > 0) {
      ctx.strokeStyle = layer.stroke.color || '#ffffff';
      ctx.lineWidth = Number(layer.stroke.width || 0);
      drawTextWithLetterSpacing(ctx, line, lineX, lineY, letterSpacing, 'stroke');
    }

    drawTextWithLetterSpacing(ctx, line, lineX, lineY, letterSpacing, 'fill');
  });

  ctx.restore();
};

export const renderDesignBoardToDataUrl = async (
  config?: Partial<DesignBoardConfig> | Record<string, any>,
  inputs?: Record<string, any>
) => {
  if (typeof document === 'undefined') {
    throw new Error('Design board rendering requires a browser environment.');
  }

  const board = normalizeDesignBoardConfig(config);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(board.boardWidth);
  canvas.height = Math.round(board.boardHeight);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas renderer is not available.');

  await ensureCanvasFontsLoaded();

  ctx.fillStyle = board.backgroundColor || '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const upstreamBackground = normalizeImageSrc(
    inputs?.cleanImage
    ?? inputs?.backgroundImage
    ?? inputs?.image
    ?? inputs?.sourceImage
    ?? inputs?.default
  );
  const backgroundImage = upstreamBackground || board.backgroundImage;
  if (backgroundImage) {
    const image = await loadImage(backgroundImage);
    drawImageCover(ctx, image, canvas.width, canvas.height);
  }

  board.layers
    .map((layer, index) => ({ layer, index }))
    .sort((left, right) => (
      Number(left.layer.zIndex ?? 10) - Number(right.layer.zIndex ?? 10)
      || left.index - right.index
    ))
    .forEach(({ layer }) => renderLayer(ctx, layer, board));

  return canvas.toDataURL('image/png');
};
