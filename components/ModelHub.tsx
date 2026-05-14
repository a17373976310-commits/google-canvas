import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Check, Cpu, RefreshCcw, Search } from 'lucide-react';
import { useStore } from '../store';
import { ModelApplyScope, ModelModality, NodeCapability } from '../types';
import { checkClientModelHealth, ClientModelHealthRoute, ClientModelHealthSummary } from '../services/licenseClientApi';
import { isAdminEdition } from '../config/appEdition';
import {
  flattenModelHealthRoutes,
  getModelModalityLabel,
  MODEL_FIELD_BY_MODALITY,
  routeMatchesModality,
  selectActiveProviderForModality,
  splitProviderModels,
} from '../services/routeRecommendation';

interface ModelInfo {
  id: string;
  name: string;
  modality: ModelModality;
  provider: string;
  isGlobal: boolean;
  source: 'provider' | 'global' | 'route';
  providerId?: string;
}

const MODALITIES: Array<{ id: ModelModality; label: string; capability: NodeCapability }> = [
  { id: 'chat', label: '对话', capability: NodeCapability.TEXT_REASONING },
  { id: 'image', label: '图像', capability: NodeCapability.IMAGE_GENERATION },
  { id: 'audio', label: '音频', capability: NodeCapability.AUDIO_SYNTHESIS },
  { id: 'video', label: '视频', capability: NodeCapability.VIDEO_MOTION },
];

const APPLY_SCOPE_OPTIONS: Array<{ id: ModelApplyScope; label: string }> = [
  { id: 'selected', label: '选中节点' },
  { id: 'modality', label: '当前类型' },
  { id: 'allCompatible', label: '全部兼容' },
];

const formatRate = (rate: number | null) => {
  if (rate === null || Number.isNaN(rate)) return '--';
  return `${Math.round(rate * 100)}%`;
};

const routeTone = (route: ClientModelHealthRoute) => {
  if (route.route_status !== 'enabled' || route.provider_status === 'disabled') return '不可用';
  if (!route.total_calls || route.success_rate === null) return '待观察';
  if (route.success_rate >= 0.92) return '稳定';
  if (route.success_rate >= 0.7) return '一般';
  return '异常';
};

const sanitizeHealthForClient = (summary: ClientModelHealthSummary): ClientModelHealthSummary => ({
  ...summary,
  groups: summary.groups.map((group) => ({
    ...group,
    routes: group.routes.map((route) => ({
      ...route,
      provider_name: '',
      provider_base_url: '',
    })),
  })),
});

export const ModelHub = () => {
  const canManageProviders = isAdminEdition;
  const {
    setDraggedModel,
    globalActiveModels,
    apiProviders,
    activeProviderId,
    activeProviderIds,
    registeredModels,
    applyModelToNodesByModality,
    setActiveProviderForModality,
    pushNotice,
  } = useStore();

  const [activeTab, setActiveTab] = useState<ModelModality>('chat');
  const [searchQuery, setSearchQuery] = useState('');
  const [applyScope, setApplyScope] = useState<ModelApplyScope>('modality');
  const [routeHealth, setRouteHealth] = useState<ClientModelHealthSummary | null>(null);

  const activeCapability = MODALITIES.find((item) => item.id === activeTab)?.capability || NodeCapability.TEXT_REASONING;

  useEffect(() => {
    let cancelled = false;
    checkClientModelHealth()
      .then((summary) => {
        if (cancelled) return;
        setRouteHealth(canManageProviders ? summary : sanitizeHealthForClient(summary));
      })
      .catch(() => {
        if (!cancelled) setRouteHealth(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canManageProviders]);

  const routeHealthStats = useMemo(() => {
    const routes = flattenModelHealthRoutes(routeHealth);
    const enabled = routes.filter((route) => route.route_status === 'enabled' && route.provider_status !== 'disabled').length;
    const observed = routes.filter((route) => route.total_calls > 0 && route.success_rate !== null);
    const average = observed.length
      ? Math.round((observed.reduce((sum, route) => sum + (route.success_rate || 0), 0) / observed.length) * 100)
      : null;
    return {
      total: routes.length,
      enabled,
      average,
      hasData: observed.length > 0,
    };
  }, [routeHealth]);

  const routeRecommendations = useMemo(() => {
    const routes = flattenModelHealthRoutes(routeHealth);
    return routes
      .filter((route) => routeMatchesModality(route, activeTab))
      .slice()
      .sort((a, b) => {
        const aUsable = a.route_status === 'enabled' && a.provider_status !== 'disabled' ? 1 : 0;
        const bUsable = b.route_status === 'enabled' && b.provider_status !== 'disabled' ? 1 : 0;
        if (aUsable !== bUsable) return bUsable - aUsable;
        const aRate = a.success_rate ?? -1;
        const bRate = b.success_rate ?? -1;
        if (aRate !== bRate) return bRate - aRate;
        return (a.avg_latency_ms ?? Number.MAX_SAFE_INTEGER) - (b.avg_latency_ms ?? Number.MAX_SAFE_INTEGER);
      });
  }, [activeTab, routeHealth]);

  const liveModels = useMemo(() => {
    const results: ModelInfo[] = [];
    const seenIds = new Set<string>();

    if (canManageProviders) {
      const field = MODEL_FIELD_BY_MODALITY[activeTab];
      const activeProvider = selectActiveProviderForModality(apiProviders, activeProviderIds, activeProviderId, activeTab);
      const sortedProviders = [
        ...(activeProvider ? [activeProvider] : []),
        ...apiProviders.filter((provider) => provider.id !== activeProvider?.id),
      ];

      sortedProviders.forEach((provider) => {
        splitProviderModels(String(provider[field] || '')).forEach((modelId) => {
          if (seenIds.has(modelId)) return;
          seenIds.add(modelId);
          results.push({
            id: modelId,
            name: modelId,
            modality: activeTab,
            provider: `${provider.id === activeProvider?.id ? '当前本机供货商' : '本机供货商'} · ${provider.name || '未命名供货商'}`,
            isGlobal: false,
            source: 'provider',
            providerId: provider.id,
          });
        });
      });
    }

    registeredModels
      .filter((model) => model.modality === activeTab)
      .forEach((model) => {
        if (seenIds.has(model.id)) return;
        seenIds.add(model.id);
        results.push({
          id: model.id,
          name: model.id,
          modality: activeTab,
          provider: '本机自定义模型',
          isGlobal: true,
          source: 'global',
        });
      });

    routeRecommendations
      .filter((route) => route.route_status === 'enabled' && route.provider_status !== 'disabled')
      .forEach((route) => {
        if (seenIds.has(route.model_id)) return;
        seenIds.add(route.model_id);
        const routeName = canManageProviders
          ? (route.provider_name || route.route_name || '平台线路')
          : (route.route_name || '平台线路');
        const routeMeta = [
          routeName,
          formatRate(route.success_rate),
          route.avg_latency_ms ? `${route.avg_latency_ms}ms` : null,
          route.token_cost !== undefined ? `${route.token_cost} 代币` : null,
        ].filter(Boolean).join(' · ');
        results.push({
          id: route.model_id,
          name: route.display_name || route.model_id,
          modality: activeTab,
          provider: routeMeta,
          isGlobal: false,
          source: 'route',
        });
      });

    return results;
  }, [activeProviderId, activeProviderIds, activeTab, apiProviders, canManageProviders, registeredModels, routeRecommendations]);

  const filteredModels = liveModels.filter((model) => (
    model.modality === activeTab
    && model.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  ));

  const bestRoute = routeRecommendations[0] || null;

  const applyModel = (model: ModelInfo) => {
    if (model.source === 'provider' && model.providerId) {
      setActiveProviderForModality(activeTab, model.providerId);
    }
    const affected = applyModelToNodesByModality(activeTab, model.id, applyScope);
    if (affected > 0) {
      pushNotice('success', `已选择平台发布模型，并同步 ${affected} 个节点到 ${model.id}`);
      return;
    }
    pushNotice('info', applyScope === 'selected' ? '未命中兼容的选中节点，已更新默认模型' : '已更新当前类型默认模型');
  };

  const useRecommendedRoute = (route: ClientModelHealthRoute) => {
    const affected = applyModelToNodesByModality(activeTab, route.model_id, applyScope);
    pushNotice(
      'success',
      affected > 0
        ? `已使用平台线路，并同步 ${affected} 个节点到 ${route.model_id}`
        : `已使用平台线路：${route.model_id}`,
    );
  };

  return (
    <div className="canvas-model-hub flex h-full w-full flex-col overflow-hidden theme-bg-elevated font-sans">
      <div className="space-y-3 border-b theme-border-subtle p-4">
        <div className="flex items-center gap-2 rounded-lg border theme-border-subtle theme-bg-secondary p-1">
          {MODALITIES.map((modality) => (
            <button
              key={modality.id}
              type="button"
              onClick={() => setActiveTab(modality.id)}
              className={`flex-1 rounded-md px-3 py-2 text-[11px] font-semibold transition-all ${activeTab === modality.id
                ? 'bg-indigo-500 text-white shadow-sm'
                : 'theme-text-muted hover:theme-bg-tertiary hover:theme-text-primary'
                }`}
            >
              {modality.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 theme-text-muted" />
          <input
            type="text"
            placeholder="搜索模型..."
            className="w-full rounded-lg border theme-border-subtle theme-bg-input py-2 pl-9 pr-3 text-xs theme-text-primary outline-none transition-all theme-placeholder-muted focus:border-indigo-500/50"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <div className="rounded-lg border theme-border-subtle theme-bg-secondary p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold theme-text-muted">
              <Activity size={12} />
              线路状态
            </span>
            <span className={`text-[10px] font-bold ${routeHealthStats.hasData ? 'text-emerald-400' : 'theme-text-muted'}`}>
              {routeHealthStats.hasData ? `${routeHealthStats.average}% 平均成功率` : '暂无真实调用'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border theme-border-subtle theme-bg-input px-2 py-2">
              <div className="text-[9px] font-semibold theme-text-muted">可用线路</div>
              <div className="mt-1 text-[13px] font-black theme-text-primary">
                {routeHealthStats.enabled}/{routeHealthStats.total}
              </div>
            </div>
            <div className="rounded-md border theme-border-subtle theme-bg-input px-2 py-2">
              <div className="text-[9px] font-semibold theme-text-muted">最佳建议</div>
              <div className="mt-1 truncate text-[13px] font-black theme-text-primary">
                {bestRoute ? routeTone(bestRoute) : '--'}
              </div>
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            {routeRecommendations.length > 0 ? routeRecommendations.slice(0, 4).map((route) => {
              const usable = route.route_status === 'enabled' && route.provider_status !== 'disabled';
              const routeMeta = canManageProviders
                ? (route.provider_name || route.route_name || '未命名线路')
                : (route.route_name || '平台线路');
              return (
                <div key={`${route.id || route.model_id}-${route.route_name || route.display_name}`} className="rounded-md border theme-border-subtle theme-bg-input px-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-black theme-text-primary">
                        {route.display_name || route.model_id}
                      </div>
                      <div className="mt-0.5 truncate text-[9px] theme-text-muted">
                        {routeMeta} · {formatRate(route.success_rate)} · {route.avg_latency_ms ? `${route.avg_latency_ms}ms` : '暂无延迟'}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!usable}
                      onClick={() => useRecommendedRoute(route)}
                      className={`rounded-md px-2 py-1.5 text-[10px] font-bold transition-all ${usable
                        ? 'bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25'
                        : 'theme-bg-tertiary theme-text-muted opacity-60'
                      }`}
                      title={canManageProviders
                        ? '使用这条模型线路'
                        : '使用这条平台线路'
                      }
                    >
                      {usable ? '使用' : '停用'}
                    </button>
                  </div>
                </div>
              );
            }) : (
              <div className="rounded-md border theme-border-subtle theme-bg-input px-2 py-3 text-center text-[10px] theme-text-muted">
                {routeHealth
                  ? `母版还没有发布${getModelModalityLabel(activeTab)}线路。`
                  : '暂未获取到线路数据，或授权服务暂不可用。'}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-lg border theme-border-subtle theme-bg-secondary p-1">
          {APPLY_SCOPE_OPTIONS.map((scope) => (
            <button
              key={scope.id}
              type="button"
              onClick={() => setApplyScope(scope.id)}
              className={`rounded-md px-2 py-2 text-[10px] font-semibold transition-all ${applyScope === scope.id
                ? 'bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-500/25'
                : 'theme-text-muted hover:theme-bg-tertiary hover:theme-text-primary'
                }`}
            >
              {scope.label}
            </button>
          ))}
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {filteredModels.length > 0 ? (
          filteredModels.map((model) => {
            const isActive = globalActiveModels[activeTab] === model.id;
            return (
              <button
                key={`${model.source}-${model.id}`}
                type="button"
                draggable
                onDragStart={() => setDraggedModel({ id: model.id, capability: activeCapability })}
                onDragEnd={() => setDraggedModel(null)}
                onClick={() => applyModel(model)}
                className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-all ${isActive
                  ? 'border-indigo-500/45 bg-indigo-500/10'
                  : 'theme-border-subtle theme-bg-secondary hover:theme-border-medium hover:theme-bg-tertiary'
                  }`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${isActive ? 'border-indigo-500/30 bg-indigo-500/15 text-indigo-400' : 'theme-border-subtle theme-bg-tertiary theme-text-muted'}`}>
                  {isActive ? <Check size={15} /> : <Cpu size={15} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-[12px] font-semibold ${isActive ? 'text-indigo-300' : 'theme-text-primary'}`}>
                    {model.name}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] theme-text-muted">
                    {model.provider}
                  </div>
                </div>
              </button>
            );
          })
        ) : (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 text-center theme-text-muted">
            <Cpu size={28} />
            <span className="text-[11px] font-semibold">当前分类暂无模型</span>
          </div>
        )}
      </div>

      {canManageProviders ? (
        <div className="space-y-2 border-t theme-border-subtle theme-bg-secondary p-4">
          <div className="rounded-lg border theme-border-subtle theme-bg-input px-3 py-2.5">
            <div className="text-[11px] font-black theme-text-primary">模型来源：模型线路中心</div>
            <div className="mt-1 text-[10px] leading-relaxed theme-text-muted">
              这里展示的是母版已发布给子版的模型。新增模型、调价和换线路，请在左侧用户控制台的“模型”页处理。
            </div>
          </div>
          <button
            type="button"
            onClick={() => (window as any).openApiSettings?.()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border theme-border-subtle theme-bg-input px-4 py-2.5 text-[11px] font-semibold theme-text-secondary transition-all hover:theme-bg-tertiary hover:theme-text-primary"
            title="本机调试 API"
          >
            <RefreshCcw size={15} />
            本机调试 API
          </button>
        </div>
      ) : (
        <div className="border-t theme-border-subtle theme-bg-secondary p-4 text-[10px] font-semibold theme-text-muted">
          子版模型由平台线路提供，客户不需要配置 API Key。
        </div>
      )}
    </div>
  );
};
