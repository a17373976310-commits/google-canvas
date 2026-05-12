import React, { useMemo, useState } from 'react';
import { Check, Cpu, Plus, PlusCircle, RefreshCcw, Search, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { APIProvider, ModelApplyScope, NodeCapability } from '../types';

type Modality = 'chat' | 'image' | 'audio' | 'video';

interface ModelInfo {
  id: string;
  name: string;
  modality: Modality;
  provider: string;
  isGlobal: boolean;
}

const MODALITIES: Array<{ id: Modality; label: string; capability: NodeCapability }> = [
  { id: 'chat', label: '对话', capability: NodeCapability.TEXT_REASONING },
  { id: 'image', label: '图像', capability: NodeCapability.IMAGE_GENERATION },
  { id: 'audio', label: '音频', capability: NodeCapability.AUDIO_SYNTHESIS },
  { id: 'video', label: '视频', capability: NodeCapability.VIDEO_MOTION },
];

const MODEL_FIELD: Record<Modality, keyof APIProvider> = {
  chat: 'textModels',
  image: 'imageModels',
  audio: 'audioModels',
  video: 'videoModels',
};

const APPLY_SCOPE_OPTIONS: Array<{ id: ModelApplyScope; label: string }> = [
  { id: 'selected', label: '选中节点' },
  { id: 'modality', label: '当前类型' },
  { id: 'allCompatible', label: '全兼容' },
];

const splitModels = (value?: string) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

export const ModelHub = () => {
  const {
    apiProviders,
    activeProviderId,
    activeProviderIds,
    setActiveProviderForModality,
    setDraggedModel,
    globalActiveModels,
    applyModelToNodesByModality,
    registeredModels,
    registerModel,
    unregisterModel,
    updateProvider,
    pushNotice,
  } = useStore();

  const [activeTab, setActiveTab] = useState<Modality>('chat');
  const [searchQuery, setSearchQuery] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addScope, setAddScope] = useState<'global' | 'provider'>('global');
  const [applyScope, setApplyScope] = useState<ModelApplyScope>('modality');

  const activeProvider = apiProviders.find((provider) => provider.id === (activeProviderIds?.[activeTab] || activeProviderId));
  const activeCapability = MODALITIES.find((item) => item.id === activeTab)?.capability || NodeCapability.TEXT_REASONING;

  const liveModels = useMemo(() => {
    const results: ModelInfo[] = [];
    const seenIds = new Set<string>();

    if (activeProvider) {
      MODALITIES.forEach((modality) => {
        splitModels(String(activeProvider[MODEL_FIELD[modality.id]] || '')).forEach((modelId) => {
          if (seenIds.has(modelId)) return;
          seenIds.add(modelId);
          results.push({
            id: modelId,
            name: modelId,
            modality: modality.id,
            provider: activeProvider.name,
            isGlobal: false,
          });
        });
      });
    }

    registeredModels.forEach((model) => {
      if (seenIds.has(model.id)) return;
      seenIds.add(model.id);
      results.push({
        id: model.id,
        name: model.id,
        modality: model.modality as Modality,
        provider: '全局模型',
        isGlobal: true,
      });
    });

    return results;
  }, [activeProvider, registeredModels]);

  const filteredModels = liveModels.filter((model) => (
    model.modality === activeTab
    && model.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  ));

  const handleQuickAdd = () => {
    const modelId = newModelId.trim();
    if (!modelId) return;

    if (addScope === 'global') {
      registerModel(activeTab, modelId);
    } else if (activeProvider) {
      const field = MODEL_FIELD[activeTab];
      const models = splitModels(String(activeProvider[field] || ''));
      if (!models.includes(modelId)) {
        updateProvider(activeProvider.id, { [field]: [...models, modelId].join(', ') });
      }
    }

    setNewModelId('');
    setIsAdding(false);
  };

  const handleRemoveModel = (model: ModelInfo) => {
    if (model.isGlobal) {
      unregisterModel(model.id);
      return;
    }

    if (!activeProvider) return;

    const removeFromField = (field: keyof APIProvider) => splitModels(String(activeProvider[field] || ''))
      .filter((item) => item !== model.id)
      .join(', ');

    updateProvider(activeProvider.id, {
      textModels: removeFromField('textModels'),
      imageModels: removeFromField('imageModels'),
      audioModels: removeFromField('audioModels'),
      videoModels: removeFromField('videoModels'),
    });
  };

  const applyModel = (model: ModelInfo) => {
    const affected = applyModelToNodesByModality(activeTab, model.id, applyScope);
    if (affected > 0) {
      pushNotice('success', `已同步 ${affected} 个节点到 ${model.id}`);
      return;
    }
    pushNotice('info', applyScope === 'selected' ? '未命中可兼容选中节点，已更新默认模型' : '已更新当前类型默认模型');
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
            <span className="text-[10px] font-semibold theme-text-muted">当前供货商</span>
            <span className="max-w-[170px] truncate text-[10px] font-semibold theme-text-secondary" title={activeProvider?.name || '未选择'}>
              {activeProvider?.name || '未选择'}
            </span>
          </div>
          <select
            value={activeProvider?.id || ''}
            onChange={(event) => setActiveProviderForModality(activeTab, event.target.value)}
            className="w-full rounded-md border theme-border-subtle theme-bg-input px-3 py-2 text-[11px] font-semibold theme-text-primary outline-none focus:border-indigo-500"
          >
            {apiProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
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
                key={model.id}
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
                <div
                  role="button"
                  tabIndex={0}
                  className="rounded-md p-1.5 opacity-0 transition-all hover:bg-rose-500/10 group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    handleRemoveModel(model);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.stopPropagation();
                    handleRemoveModel(model);
                  }}
                  title={model.isGlobal ? '从全局模型中移除' : '从当前供货商中移除'}
                >
                  <Trash2 size={13} className="text-rose-400" />
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

      <div className="space-y-3 border-t theme-border-subtle theme-bg-secondary p-4">
        {isAdding ? (
          <>
            <div className="grid grid-cols-2 gap-1 rounded-lg border theme-border-subtle theme-bg-input p-1">
              <button
                type="button"
                onClick={() => setAddScope('global')}
                className={`rounded-md px-2 py-2 text-[10px] font-semibold ${addScope === 'global' ? 'bg-indigo-500/15 text-indigo-400' : 'theme-text-muted'}`}
              >
                全局模型
              </button>
              <button
                type="button"
                onClick={() => setAddScope('provider')}
                disabled={!activeProvider}
                className={`rounded-md px-2 py-2 text-[10px] font-semibold ${addScope === 'provider' ? 'bg-emerald-500/15 text-emerald-400' : 'theme-text-muted'}`}
              >
                当前供货商
              </button>
            </div>
            <div className="flex gap-2">
              <input
                autoFocus
                type="text"
                placeholder="输入模型 ID..."
                className="min-w-0 flex-1 rounded-lg border theme-border-subtle theme-bg-input px-3 py-2 text-xs theme-text-primary outline-none focus:border-indigo-500"
                value={newModelId}
                onChange={(event) => setNewModelId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleQuickAdd();
                }}
              />
              <button
                type="button"
                onClick={handleQuickAdd}
                className="rounded-lg bg-indigo-600 p-2 text-white transition-colors hover:bg-indigo-500"
                title="添加模型"
              >
                <Plus size={18} />
              </button>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="rounded-lg border theme-border-subtle theme-bg-input p-2 theme-text-muted transition-colors hover:theme-text-primary"
                title="取消"
              >
                <RefreshCcw size={16} />
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="inline-flex items-center gap-2 rounded-lg border theme-border-subtle theme-bg-input px-4 py-2.5 text-[11px] font-semibold theme-text-secondary transition-all hover:theme-bg-tertiary hover:theme-text-primary"
            >
              <PlusCircle size={15} />
              添加模型
            </button>
            <button
              type="button"
              onClick={() => (window as any).openApiSettings?.()}
              className="rounded-lg border theme-border-subtle theme-bg-input p-2 theme-text-muted transition-colors hover:theme-text-primary"
              title="API 设置"
            >
              <RefreshCcw size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
