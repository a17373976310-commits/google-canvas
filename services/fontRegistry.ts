export type CanvasFontCategory = 'title' | 'serif' | 'handwriting' | 'rounded' | 'display';

export interface CanvasFont {
  id: string;
  label: string;
  family: string;
  category: CanvasFontCategory;
  fallback: string;
  url: string;
  promptHint: string;
}

export const CANVAS_FONTS: CanvasFont[] = [
  {
    id: 'youshe-title',
    label: '优设标题黑',
    family: 'AWEI YouShe Title Hei',
    category: 'title',
    fallback: 'ui-sans-serif, system-ui, sans-serif',
    url: new URL('../Typeface/YouSheBiaoTiHei-2.ttf', import.meta.url).href,
    promptHint: '粗黑标题字、紧凑有力量感，适合商业海报主标题和促销标题。',
  },
  {
    id: 'maoken-rounded',
    label: '猫啃忘形圆',
    family: 'AWEI MaoKen WangXingYuan',
    category: 'rounded',
    fallback: 'ui-rounded, "Microsoft YaHei", sans-serif',
    url: new URL('../Typeface/MaoKenWangXingYuan-2.ttf', import.meta.url).href,
    promptHint: '圆润亲和、柔和可爱，适合轻松、年轻、生活方式类文案。',
  },
  {
    id: 'dinglie-song',
    label: '鼎猎宋刻体',
    family: 'AWEI DingLie SongKe',
    category: 'serif',
    fallback: 'serif',
    url: new URL('../Typeface/dingliesongtypeface20241217-2.ttf', import.meta.url).href,
    promptHint: '宋刻风格、书卷感和传统质感强，适合中式、文化、礼品类标题。',
  },
  {
    id: 'dinglie-xida',
    label: '鼎猎西大体',
    family: 'AWEI DingLie XiDa',
    category: 'display',
    fallback: 'ui-serif, serif',
    url: new URL('../Typeface/dingliexidafont-20250329V2)-2.ttf', import.meta.url).href,
    promptHint: '装饰感较强的展示字体，适合醒目的活动字和品牌化标题。',
  },
  {
    id: 'dinglie-zhuhai',
    label: '鼎猎珠海体',
    family: 'AWEI DingLie ZhuHai',
    category: 'display',
    fallback: 'ui-serif, serif',
    url: new URL('../Typeface/dingliezhuhaifont-20240831GengXinBan)-2.ttf', import.meta.url).href,
    promptHint: '带地域感和手作气质的展示字，适合有温度的品牌标题。',
  },
  {
    id: 'huangkaihua-lawyer',
    label: '黄凯桦律师手写体',
    family: 'AWEI Huangkaihua Lawyer',
    category: 'handwriting',
    fallback: 'cursive',
    url: new URL('../Typeface/huangkaihuaLawyerfont-2.ttf', import.meta.url).href,
    promptHint: '自然手写感，笔画有个人书写痕迹，适合签名、说明和情绪化文案。',
  },
  {
    id: 'ziku-feiyang',
    label: '字库星球飞扬体',
    family: 'AWEI ZiKuXingQiu FeiYang',
    category: 'display',
    fallback: 'ui-sans-serif, system-ui, sans-serif',
    url: new URL('../Typeface/ZiKuXingQiuFeiYangTi-2.ttf', import.meta.url).href,
    promptHint: '飞扬动感、活泼张力强，适合潮流、活动和视觉冲击型文字。',
  },
];

export const DEFAULT_CANVAS_FONT_ID = 'youshe-title';

export const getCanvasFontById = (fontId?: string) => (
  CANVAS_FONTS.find((font) => font.id === fontId) || CANVAS_FONTS[0]
);

export const getCanvasFontStack = (fontId?: string) => {
  const font = getCanvasFontById(fontId);
  return `"${font.family}", ${font.fallback}`;
};

export const buildCanvasFontPrompt = (
  fontId?: string,
  visibleText?: string,
  enabled = true
) => {
  if (!enabled || !fontId) return '';
  const font = getCanvasFontById(fontId);
  if (!font) return '';
  const text = String(visibleText || '').trim();
  const textRule = text
    ? `画面中需要出现的主要文字是「${text}」。`
    : '如果画面中出现中文标题或卖点文字，请把主要文字作为独立清晰的视觉文字处理。';
  return [
    `字体库约束：主要中文文字请使用「${font.label}」的字形风格。`,
    `字体风格说明：${font.promptHint}`,
    textRule,
    '保持文字边缘清晰、排版稳定，不要把文字做成无法辨认的纹理；后续软件会按同一字体库字体重建为可编辑文字层。',
  ].join('\n');
};

let fontLoadPromise: Promise<void> | null = null;

const buildFontFaceCss = () => CANVAS_FONTS.map((font) => `
@font-face {
  font-family: "${font.family}";
  src: url("${font.url}") format("truetype");
  font-display: swap;
}
`).join('\n');

export const ensureCanvasFontsLoaded = () => {
  if (typeof document === 'undefined') return Promise.resolve();

  if (!document.getElementById('awei-canvas-fonts')) {
    const style = document.createElement('style');
    style.id = 'awei-canvas-fonts';
    style.textContent = buildFontFaceCss();
    document.head.appendChild(style);
  }

  if (!fontLoadPromise) {
    fontLoadPromise = Promise.all(
      CANVAS_FONTS.map((font) => document.fonts?.load(`16px "${font.family}"`).catch(() => undefined))
    ).then(() => undefined);
  }

  return fontLoadPromise;
};
