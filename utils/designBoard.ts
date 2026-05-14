import { DEFAULT_CANVAS_FONT_ID } from '../services/fontRegistry';
import { DesignBoardConfig, DesignBoardOutput, DesignBoardTextLayer } from '../types';
import { normalizeImageSrc } from './normalizeImageSrc';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toNumber = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export const createDesignBoardLayerId = () => `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const createDesignBoardTextLayer = (
  patch: Partial<DesignBoardTextLayer> = {}
): DesignBoardTextLayer => ({
  id: patch.id || createDesignBoardLayerId(),
  type: 'text',
  name: patch.name || '文字图层',
  text: patch.text || '可编辑文字',
  x: patch.x ?? 50,
  y: patch.y ?? 42,
  width: patch.width ?? 72,
  rotation: patch.rotation ?? 0,
  fontId: patch.fontId || DEFAULT_CANVAS_FONT_ID,
  fontSize: patch.fontSize ?? 88,
  color: patch.color || '#171717',
  opacity: patch.opacity ?? 1,
  align: patch.align || 'center',
  letterSpacing: patch.letterSpacing ?? 0,
  lineHeight: patch.lineHeight ?? 1.05,
  role: patch.role || 'other',
  readingOrder: patch.readingOrder,
  zIndex: patch.zIndex,
  stroke: patch.stroke || { enabled: false, color: '#ffffff', width: 2 },
  shadow: patch.shadow || { enabled: true, color: 'rgba(0,0,0,0.22)', x: 0, y: 8, blur: 18 },
});

export const createDefaultDesignBoardConfig = (): DesignBoardConfig => ({
  boardWidth: 1080,
  boardHeight: 1350,
  backgroundColor: '#f6f2ea',
  selectedLayerId: 'text-headline',
  layers: [
    createDesignBoardTextLayer({
      id: 'text-headline',
      name: '主标题',
      text: '品牌主标题',
      x: 50,
      y: 42,
      width: 74,
      fontId: 'youshe-title',
      fontSize: 108,
      color: '#161616',
      letterSpacing: 1,
      shadow: { enabled: true, color: 'rgba(0,0,0,0.18)', x: 0, y: 10, blur: 22 },
    }),
    createDesignBoardTextLayer({
      id: 'text-subtitle',
      name: '副标题',
      text: '在这里编辑可移动文字',
      x: 50,
      y: 53,
      width: 66,
      fontId: 'maoken-rounded',
      fontSize: 42,
      color: '#5b4b3d',
      letterSpacing: 0,
      shadow: { enabled: false, color: 'rgba(0,0,0,0.18)', x: 0, y: 6, blur: 14 },
    }),
  ],
});

export const normalizeDesignBoardLayer = (layer: Partial<DesignBoardTextLayer>): DesignBoardTextLayer => {
  const normalized = createDesignBoardTextLayer(layer);
  return {
    ...normalized,
    id: String(normalized.id || createDesignBoardLayerId()),
    name: String(normalized.name || '文字图层'),
    text: String(normalized.text || ''),
    x: clamp(toNumber(normalized.x, 50), 0, 100),
    y: clamp(toNumber(normalized.y, 50), 0, 100),
    width: clamp(toNumber(normalized.width, 70), 16, 100),
    rotation: clamp(toNumber(normalized.rotation, 0), -180, 180),
    fontSize: clamp(toNumber(normalized.fontSize, 72), 10, 260),
    opacity: clamp(toNumber(normalized.opacity, 1), 0, 1),
    align: ['left', 'center', 'right'].includes(normalized.align) ? normalized.align : 'center',
    letterSpacing: clamp(toNumber(normalized.letterSpacing, 0), -12, 48),
    lineHeight: clamp(toNumber(normalized.lineHeight, 1.05), 0.8, 2.4),
    role: normalized.role || 'other',
    readingOrder: Number.isFinite(Number(normalized.readingOrder)) ? clamp(toNumber(normalized.readingOrder, 0), 0, 999) : undefined,
    zIndex: Number.isFinite(Number(normalized.zIndex)) ? clamp(toNumber(normalized.zIndex, 10), 0, 999) : undefined,
    stroke: {
      enabled: !!normalized.stroke?.enabled,
      color: normalized.stroke?.color || '#ffffff',
      width: clamp(toNumber(normalized.stroke?.width, 2), 0, 18),
    },
    shadow: {
      enabled: !!normalized.shadow?.enabled,
      color: normalized.shadow?.color || 'rgba(0,0,0,0.22)',
      x: clamp(toNumber(normalized.shadow?.x, 0), -60, 60),
      y: clamp(toNumber(normalized.shadow?.y, 8), -60, 60),
      blur: clamp(toNumber(normalized.shadow?.blur, 18), 0, 80),
    },
  };
};

export const normalizeDesignBoardConfig = (config?: Partial<DesignBoardConfig> | Record<string, any>): DesignBoardConfig => {
  const defaults = createDefaultDesignBoardConfig();
  const rawLayers = Array.isArray(config?.layers) ? config?.layers : defaults.layers;
  const layers = rawLayers.length > 0
    ? rawLayers.map((layer) => normalizeDesignBoardLayer(layer))
    : defaults.layers;
  const selectedLayerId = layers.some((layer) => layer.id === config?.selectedLayerId)
    ? String(config?.selectedLayerId)
    : layers[0]?.id;

  return {
    boardWidth: clamp(toNumber(config?.boardWidth, defaults.boardWidth), 320, 4096),
    boardHeight: clamp(toNumber(config?.boardHeight, defaults.boardHeight), 320, 4096),
    backgroundColor: String(config?.backgroundColor || defaults.backgroundColor),
    backgroundImage: typeof config?.backgroundImage === 'string' ? config.backgroundImage : undefined,
    selectedLayerId,
    layers,
  };
};

export const buildDesignBoardOutput = (
  config?: Partial<DesignBoardConfig> | Record<string, any>,
  inputs?: Record<string, any>,
  renderedImage?: string | null,
  renderError?: string
): DesignBoardOutput => {
  const board = normalizeDesignBoardConfig(config);
  const configuredBackground = normalizeImageSrc(board.backgroundImage);
  const upstreamBackground = normalizeImageSrc(
    inputs?.cleanImage
    ?? inputs?.backgroundImage
    ?? inputs?.image
    ?? inputs?.sourceImage
    ?? inputs?.default
  );
  const image = renderedImage || undefined;
  return {
    kind: 'design-board',
    version: 1,
    boardWidth: board.boardWidth,
    boardHeight: board.boardHeight,
    backgroundColor: board.backgroundColor,
    backgroundImage: upstreamBackground || configuredBackground || undefined,
    image,
    primaryUrl: image,
    url: image,
    urls: image ? [image] : undefined,
    previewDataUrl: image,
    renderError,
    layers: board.layers,
    updatedAt: Date.now(),
  };
};
