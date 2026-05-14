import { APIProvider, ModelModality, NodeType } from '../types';
import {
  checkClientModelHealth,
  ClientModelHealthRoute,
  ClientModelHealthSummary,
} from './licenseClientApi';

export type EnrichedClientModelHealthRoute = ClientModelHealthRoute & {
  model_group?: string;
};

export type RouteSuggestionMode = 'startup' | 'failure';

export interface RouteSuggestionRequest {
  summary: ClientModelHealthSummary;
  modality: ModelModality;
  modelId?: string;
  providerName?: string;
  providerBaseUrl?: string;
  apiProviders?: APIProvider[];
  mode?: RouteSuggestionMode;
}

export interface RouteSuggestion {
  route: EnrichedClientModelHealthRoute;
  currentRoute: EnrichedClientModelHealthRoute | null;
  localProvider: APIProvider | null;
  modality: ModelModality;
  reason: string;
}

export const MODEL_FIELD_BY_MODALITY: Record<ModelModality, keyof APIProvider> = {
  chat: 'textModels',
  image: 'imageModels',
  audio: 'audioModels',
  video: 'videoModels',
};

export const MODEL_MODALITY_OPTIONS: Array<{ id: ModelModality; label: string; description: string }> = [
  { id: 'chat', label: '对话', description: '文本、推理、聊天、多模态理解' },
  { id: 'image', label: '图像', description: '生图、修图、图片理解输出' },
  { id: 'audio', label: '音频', description: '语音、TTS、音频处理' },
  { id: 'video', label: '视频', description: '视频生成、动态画面' },
];

const MODEL_MODALITY_LABELS = MODEL_MODALITY_OPTIONS.reduce<Record<ModelModality, string>>((acc, item) => {
  acc[item.id] = item.label;
  return acc;
}, {
  chat: '对话',
  image: '图像',
  audio: '音频',
  video: '视频',
});

const MODEL_GROUP_ALIASES: Record<string, ModelModality> = {
  chat: 'chat',
  text: 'chat',
  reasoning: 'chat',
  reason: 'chat',
  conversation: 'chat',
  llm: 'chat',
  对话: 'chat',
  文本: 'chat',
  推理: 'chat',
  image: 'image',
  img: 'image',
  imagen: 'image',
  picture: 'image',
  图片: 'image',
  图像: 'image',
  生图: 'image',
  audio: 'audio',
  voice: 'audio',
  speech: 'audio',
  tts: 'audio',
  音频: 'audio',
  语音: 'audio',
  video: 'video',
  veo: 'video',
  motion: 'video',
  视频: 'video',
  动效: 'video',
};

export const normalizeRouteUrl = (value?: string) => String(value || '').trim().replace(/\/+$/, '').toLowerCase();

const normalizeText = (value?: string) => String(value || '').trim().toLowerCase();

export const splitProviderModels = (value?: string) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

export const getModalityForNodeType = (type?: NodeType | string | null): ModelModality => {
  if (type === NodeType.AI_IMAGE) return 'image';
  if (type === NodeType.AI_AUDIO) return 'audio';
  if (type === NodeType.AI_VIDEO) return 'video';
  return 'chat';
};

export const getModelModalityLabel = (modality?: ModelModality | string) => (
  MODEL_MODALITY_LABELS[(modality as ModelModality) || 'chat'] || MODEL_MODALITY_LABELS.chat
);

export const normalizeModelGroupToModality = (value?: string, fallbackText?: string): ModelModality => {
  const normalized = normalizeText(value);
  if (normalized && MODEL_GROUP_ALIASES[normalized]) {
    return MODEL_GROUP_ALIASES[normalized];
  }

  const text = [normalized, normalizeText(fallbackText)].filter(Boolean).join(' ');
  if (/image|img|imagen|seedream|picture|图像|图片|生图/.test(text)) return 'image';
  if (/audio|tts|voice|speech|音频|语音/.test(text)) return 'audio';
  if (/video|veo|motion|sora|视频|动效/.test(text)) return 'video';
  return 'chat';
};

export const getRouteModality = (route: EnrichedClientModelHealthRoute): ModelModality => (
  normalizeModelGroupToModality(
    route.model_group,
    [route.model_id, route.display_name, route.route_name].join(' '),
  )
);

export const selectActiveProviderForModality = (
  providers: APIProvider[],
  activeProviderIds: Partial<Record<ModelModality, string>> | undefined,
  fallbackProviderId: string | null | undefined,
  modality: ModelModality,
) => (
  providers.find((provider) => provider.id === activeProviderIds?.[modality])
  || providers.find((provider) => provider.id === fallbackProviderId)
  || providers[0]
  || null
);

export const flattenModelHealthRoutes = (
  summary?: ClientModelHealthSummary | null,
): EnrichedClientModelHealthRoute[] => (
  summary?.groups.flatMap((group) => (
    group.routes.map((route) => ({
      ...route,
      model_group: route.model_group || group.model_group,
    }))
  )) || []
);

export const routeMatchesModality = (route: EnrichedClientModelHealthRoute, modality: ModelModality) => (
  getRouteModality(route) === modality
);

export const isRouteUsable = (route: EnrichedClientModelHealthRoute) => (
  route.route_status === 'enabled' && route.provider_status !== 'disabled'
);

export const findLocalProviderForRoute = (
  apiProviders: APIProvider[] = [],
  route?: EnrichedClientModelHealthRoute | null,
) => {
  if (!route) return null;

  const routeUrl = normalizeRouteUrl(route.provider_base_url);
  if (routeUrl) {
    const byUrl = apiProviders.find((provider) => normalizeRouteUrl(provider.baseUrl) === routeUrl);
    if (byUrl) return byUrl;
  }

  const providerName = normalizeText(route.provider_name);
  if (providerName) {
    return apiProviders.find((provider) => normalizeText(provider.name) === providerName) || null;
  }

  return null;
};

export const getRouteDisplayName = (route?: EnrichedClientModelHealthRoute | null) => (
  route?.route_name || route?.display_name || route?.model_id || '备用线路'
);

export const formatRouteSuccessRate = (route?: EnrichedClientModelHealthRoute | null) => {
  if (!route || route.success_rate === null || Number.isNaN(route.success_rate)) return '暂无样本';
  return `${Math.round(route.success_rate * 100)}% 成功率`;
};

export const getRouteTone = (route: EnrichedClientModelHealthRoute) => {
  if (!isRouteUsable(route)) return '不可用';
  if (!route.total_calls || route.success_rate === null) return '待观察';
  if (route.success_rate >= 0.92) return '稳定';
  if (route.success_rate >= 0.7) return '可用';
  return '异常';
};

const providerMatchesRoute = (
  route: EnrichedClientModelHealthRoute,
  providerName?: string,
  providerBaseUrl?: string,
) => {
  const routeUrl = normalizeRouteUrl(route.provider_base_url);
  const currentUrl = normalizeRouteUrl(providerBaseUrl);
  if (routeUrl && currentUrl && routeUrl === currentUrl) return true;

  const routeProviderName = normalizeText(route.provider_name);
  const currentProviderName = normalizeText(providerName);
  return Boolean(routeProviderName && currentProviderName && routeProviderName === currentProviderName);
};

const compareRoutes = (a: EnrichedClientModelHealthRoute, b: EnrichedClientModelHealthRoute) => {
  const aObserved = a.total_calls > 0 && a.success_rate !== null ? 1 : 0;
  const bObserved = b.total_calls > 0 && b.success_rate !== null ? 1 : 0;
  if (aObserved !== bObserved) return bObserved - aObserved;

  const aRate = a.success_rate ?? -1;
  const bRate = b.success_rate ?? -1;
  if (aRate !== bRate) return bRate - aRate;

  const aLatency = a.avg_latency_ms ?? Number.MAX_SAFE_INTEGER;
  const bLatency = b.avg_latency_ms ?? Number.MAX_SAFE_INTEGER;
  if (aLatency !== bLatency) return aLatency - bLatency;

  return getRouteDisplayName(a).localeCompare(getRouteDisplayName(b));
};

const isSameRoute = (
  a?: EnrichedClientModelHealthRoute | null,
  b?: EnrichedClientModelHealthRoute | null,
) => {
  if (!a || !b) return false;
  return a.model_id === b.model_id
    && normalizeRouteUrl(a.provider_base_url) === normalizeRouteUrl(b.provider_base_url)
    && normalizeText(a.provider_name) === normalizeText(b.provider_name)
    && getRouteDisplayName(a) === getRouteDisplayName(b);
};

const shouldShowStartupSuggestion = (
  best: EnrichedClientModelHealthRoute,
  current: EnrichedClientModelHealthRoute | null,
) => {
  if (!best.total_calls || best.success_rate === null) return false;

  if (!current || current.success_rate === null || !current.total_calls) {
    return best.success_rate >= 0.9;
  }

  const rateDelta = best.success_rate - current.success_rate;
  const latencyDelta = (current.avg_latency_ms ?? Number.MAX_SAFE_INTEGER) - (best.avg_latency_ms ?? Number.MAX_SAFE_INTEGER);

  return rateDelta >= 0.08
    || (best.success_rate >= 0.95 && current.success_rate < 0.9)
    || (rateDelta >= 0 && latencyDelta >= 800);
};

const shouldShowFailureSuggestion = (best: EnrichedClientModelHealthRoute) => {
  if (!best.total_calls || best.success_rate === null) return true;
  return best.success_rate >= 0.6;
};

export const findBestRouteSuggestion = ({
  summary,
  modality,
  modelId,
  providerName,
  providerBaseUrl,
  apiProviders = [],
  mode = 'startup',
}: RouteSuggestionRequest): RouteSuggestion | null => {
  const routes = flattenModelHealthRoutes(summary).filter(isRouteUsable);
  if (!routes.length) return null;

  const normalizedModelId = normalizeText(modelId);
  const modalityRoutes = routes.filter((route) => routeMatchesModality(route, modality));
  const exactModelRoutes = normalizedModelId
    ? routes.filter((route) => normalizeText(route.model_id) === normalizedModelId)
    : [];
  const exactModalityRoutes = exactModelRoutes.filter((route) => routeMatchesModality(route, modality));
  const candidates = exactModalityRoutes.length ? exactModalityRoutes : modalityRoutes;

  if (!candidates.length) return null;

  const currentRoute = candidates.find((route) => providerMatchesRoute(route, providerName, providerBaseUrl)) || null;
  const alternatives = candidates
    .filter((route) => !isSameRoute(route, currentRoute))
    .filter((route) => !providerMatchesRoute(route, providerName, providerBaseUrl));

  if (!alternatives.length) return null;

  const best = alternatives.slice().sort(compareRoutes)[0];
  if (!best) return null;

  if (mode === 'startup' && !shouldShowStartupSuggestion(best, currentRoute)) return null;
  if (mode === 'failure' && !shouldShowFailureSuggestion(best)) return null;

  const localProvider = findLocalProviderForRoute(apiProviders, best);
  const currentRate = currentRoute?.success_rate;
  const reason = currentRate === null || currentRate === undefined
    ? `${formatRouteSuccessRate(best)}，可作为当前线路的备用选择`
    : `${formatRouteSuccessRate(best)}，比当前线路高 ${Math.max(0, Math.round(((best.success_rate || 0) - currentRate) * 100))}%`;

  return {
    route: best,
    currentRoute,
    localProvider,
    modality,
    reason,
  };
};

export const fetchBestRouteSuggestion = async (
  request: Omit<RouteSuggestionRequest, 'summary'>,
) => {
  const summary = await checkClientModelHealth();
  return findBestRouteSuggestion({ ...request, summary });
};
