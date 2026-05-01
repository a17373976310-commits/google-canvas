
import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { NodeCapability, ModelApplyScope, APIProvider } from '../types';
import {
    Plus,
    RefreshCcw,
    Sparkles,
    Zap,
    Search,
    PlusCircle,
    Cpu,
    X
} from 'lucide-react';

type Modality = 'chat' | 'image' | 'audio' | 'video';

type ThemeClasses = {
    iconWrap: string;
    icon: string;
    activeTab: string;
    activeCard: string;
    activeTitle: string;
    activeZapWrap: string;
    activeZap: string;
    activeBar: string;
};

const THEME_CLASSES: Record<Modality, ThemeClasses> = {
    chat: {
        iconWrap: 'bg-blue-500/10 border-blue-500/20',
        icon: 'text-blue-400',
        activeTab: 'bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-lg',
        activeCard: 'bg-blue-500/10 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.15)]',
        activeTitle: 'text-blue-400',
        activeZapWrap: 'bg-blue-500/20',
        activeZap: 'text-blue-400 fill-blue-400',
        activeBar: 'bg-blue-500'
    },
    image: {
        iconWrap: 'bg-orange-500/10 border-orange-500/20',
        icon: 'text-orange-400',
        activeTab: 'bg-orange-500/10 text-orange-400 border border-orange-500/20 shadow-lg',
        activeCard: 'bg-orange-500/10 border-orange-500/50 shadow-[0_0_15px_rgba(249,115,22,0.15)]',
        activeTitle: 'text-orange-400',
        activeZapWrap: 'bg-orange-500/20',
        activeZap: 'text-orange-400 fill-orange-400',
        activeBar: 'bg-orange-500'
    },
    audio: {
        iconWrap: 'bg-cyan-500/10 border-cyan-500/20',
        icon: 'text-cyan-400',
        activeTab: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-lg',
        activeCard: 'bg-cyan-500/10 border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.15)]',
        activeTitle: 'text-cyan-400',
        activeZapWrap: 'bg-cyan-500/20',
        activeZap: 'text-cyan-400 fill-cyan-400',
        activeBar: 'bg-cyan-500'
    },
    video: {
        iconWrap: 'bg-violet-500/10 border-violet-500/20',
        icon: 'text-violet-400',
        activeTab: 'bg-violet-500/10 text-violet-400 border border-violet-500/20 shadow-lg',
        activeCard: 'bg-violet-500/10 border-violet-500/50 shadow-[0_0_15px_rgba(139,92,246,0.15)]',
        activeTitle: 'text-violet-400',
        activeZapWrap: 'bg-violet-500/20',
        activeZap: 'text-violet-400 fill-violet-400',
        activeBar: 'bg-violet-500'
    }
};

interface ModelInfo {
    id: string;
    name: string;
    modality: Modality;
    provider: string;
    isGlobal: boolean;
}

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
        pushNotice
    } = useStore();

    const [activeTab, setActiveTab] = useState<Modality>('chat');
    const [searchQuery, setSearchQuery] = useState('');
    const [newModelId, setNewModelId] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [addScope, setAddScope] = useState<'global' | 'provider'>('global');
    const [applyScope, setApplyScope] = useState<ModelApplyScope>('modality');

    const activeProvider = apiProviders.find(p => p.id === (activeProviderIds?.[activeTab] || activeProviderId));

    const liveModels = useMemo(() => {
        const results: ModelInfo[] = [];
        const seenIds = new Set<string>();

        // 1. Provider-specific models
        if (activeProvider) {
            const parse = (str: string, mod: Modality) =>
                str.split(',').map(m => m.trim()).filter(Boolean).forEach(m => {
                    if (!seenIds.has(m)) {
                        seenIds.add(m);
                        results.push({
                            id: m,
                            name: m.toUpperCase(),
                            modality: mod,
                            provider: activeProvider.name,
                            isGlobal: false
                        });
                    }
                });

            parse(activeProvider.textModels || '', 'chat');
            parse(activeProvider.imageModels || '', 'image');
            parse(activeProvider.audioModels || '', 'audio');
            parse(activeProvider.videoModels || '', 'video');
        }

        // 2. Global registered models
        registeredModels.forEach(rm => {
            if (!seenIds.has(rm.id)) {
                seenIds.add(rm.id);
                results.push({
                    id: rm.id,
                    name: rm.id.toUpperCase(),
                    modality: rm.modality as Modality,
                    provider: '🌐 全局',
                    isGlobal: true
                });
            }
        });

        return results;
    }, [activeProvider, registeredModels]);

    const filteredModels = liveModels.filter(m =>
        m.modality === activeTab &&
        m.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const modalityToCapability: Record<Modality, NodeCapability> = {
        chat: NodeCapability.TEXT_REASONING,
        image: NodeCapability.IMAGE_GENERATION,
        audio: NodeCapability.AUDIO_SYNTHESIS,
        video: NodeCapability.VIDEO_MOTION
    };

    const activeTheme = THEME_CLASSES[activeTab];

    const handleQuickAdd = () => {
        if (!newModelId.trim()) return;
        const modality = activeTab;

        if (addScope === 'global') {
            // Add to global registry (visible across all providers)
            registerModel(modality, newModelId.trim());
        } else if (activeProvider) {
            // Add to current provider only
            const fieldMap: Record<Modality, keyof APIProvider> = {
                chat: 'textModels',
                image: 'imageModels',
                audio: 'audioModels',
                video: 'videoModels'
            };
            const field = fieldMap[modality];
            const existing = (activeProvider as any)[field] || '';
            const models = existing.split(',').map((m: string) => m.trim()).filter(Boolean);
            if (!models.includes(newModelId.trim())) {
                models.push(newModelId.trim());
                updateProvider(activeProvider.id, { [field]: models.join(', ') });
            }
        }

        setNewModelId('');
        setIsAdding(false);
    };

    const handleRemoveModel = (model: ModelInfo) => {
        if (model.isGlobal) {
            // Global model: remove from registry
            unregisterModel(model.id);
        } else if (activeProvider) {
            // Provider model: remove from the provider's comma-separated string
            const removeFromField = (field: string) => {
                return field.split(',').map(m => m.trim()).filter(m => m && m !== model.id).join(', ');
            };
            updateProvider(activeProvider.id, {
                textModels: removeFromField(activeProvider.textModels || ''),
                imageModels: removeFromField(activeProvider.imageModels || ''),
                audioModels: removeFromField(activeProvider.audioModels || ''),
                videoModels: removeFromField(activeProvider.videoModels || ''),
            });
        }
    };

    return (
        <div className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-[24px] overflow-hidden shadow-2xl flex flex-col font-sans transition-all">
            {/* Header */}
            <div className="p-6 pb-4 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl border ${activeTheme.iconWrap}`}>
                            <Sparkles size={18} className={activeTheme.icon} />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-white tracking-widest uppercase italic">模型枢纽</h2>
                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest opacity-50">Neural Forge</p>
                        </div>
                    </div>
                    {activeProvider && (
                        <div className="text-[9px] text-gray-500 font-mono bg-white/5 px-2 py-1 rounded-lg truncate max-w-[120px]" title={activeProvider.name}>
                            {activeProvider.name}
                        </div>
                    )}
                </div>

                {/* Categories */}
                <div className="flex items-center gap-1.5 p-1 bg-black/40 border border-[#1e1e2d] rounded-2xl">
                    {(['chat', 'image', 'audio', 'video'] as Modality[]).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 flex items-center justify-center py-2.5 rounded-xl text-[10px] font-black uppercase tracking-tight transition-all ${activeTab === tab
                                ? THEME_CLASSES[tab].activeTab
                                : 'text-gray-600 hover:text-gray-400'
                                }`}
                        >
                            {{ 'chat': '对话', 'image': '绘图', 'audio': '语音', 'video': '视频' }[tab]}
                        </button>
                    ))}
                </div>

                {/* Search */}
                <div className="relative group">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 group-focus-within:text-indigo-400 transition-colors" />
                    <input
                        type="text"
                        placeholder="搜索模型库..."
                        className="w-full bg-black/40 border border-[#1e1e2d] rounded-xl py-2.5 pl-10 pr-4 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50 transition-all placeholder:text-gray-700"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <p className="text-[9px] text-gray-600 px-1">
                    点击模型将自动同步到当前分类的全部节点（可在节点内单独改写）
                </p>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">当前分类供货商</span>
                        <span className="max-w-[150px] truncate rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-bold text-gray-300" title={activeProvider?.name || '未选择'}>
                            {activeProvider?.name || '未选择'}
                        </span>
                    </div>
                    <select
                        value={activeProvider?.id || ''}
                        onChange={(event) => setActiveProviderForModality(activeTab, event.target.value)}
                        className="w-full rounded-xl border border-[#1e1e2d] bg-[#0b0b0f] px-3 py-2 text-[10px] font-bold text-gray-200 outline-none transition focus:border-indigo-500"
                    >
                        {apiProviders.map((provider) => (
                            <option key={provider.id} value={provider.id}>
                                {provider.name}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-1 p-1 bg-black/40 border border-[#1e1e2d] rounded-xl">
                    <button
                        onClick={() => setApplyScope('selected')}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${applyScope === 'selected'
                            ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                            : 'text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        仅选中节点
                    </button>
                    <button
                        onClick={() => setApplyScope('modality')}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${applyScope === 'modality'
                            ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                            : 'text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        当前类型全部
                    </button>
                    <button
                        onClick={() => setApplyScope('allCompatible')}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${applyScope === 'allCompatible'
                            ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                            : 'text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        全兼容节点
                    </button>
                </div>
            </div>

            {/* Grid - FIXED HEIGHT SCROLL */}
            <div className="px-6 py-2 h-[320px] overflow-y-auto custom-scrollbar overflow-x-hidden space-y-3">
                {filteredModels.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2.5">
                        {filteredModels.map((model) => {
                            const isActive = globalActiveModels[activeTab] === model.id;
                            return (
                                <button
                                    key={model.id}
                                    draggable
                                    onDragStart={() => setDraggedModel({ id: model.id, capability: modalityToCapability[model.modality] })}
                                    onDragEnd={() => setDraggedModel(null)}
                                    onClick={() => {
                                        const affected = applyModelToNodesByModality(activeTab, model.id, applyScope);
                                        if (affected > 0) {
                                            pushNotice('success', `已切换 ${affected} 个${{ chat: '对话', image: '绘图', audio: '语音', video: '视频' }[activeTab]}节点模型为 ${model.id}`);
                                        } else {
                                            pushNotice('info', applyScope === 'selected' ? `未命中可兼容选中节点，已将 ${model.id} 设为默认模型` : `已将 ${model.id} 设为 ${activeTab} 默认模型`);
                                        }
                                    }}
                                    className={`group relative p-4 rounded-2xl border transition-all hover:scale-[1.02] active:scale-95 cursor-grab active:cursor-grabbing flex items-center justify-between ${isActive
                                        ? activeTheme.activeCard
                                        : 'bg-[#161621] border-[#1e1e2d] hover:border-gray-600'
                                        }`}
                                >
                                    <div className="flex-1 overflow-hidden mr-4">
                                        <h4 className={`text-[12px] font-black uppercase truncate transition-colors ${isActive ? activeTheme.activeTitle : 'text-gray-200'}`}>
                                            {model.name}
                                        </h4>
                                        <p className="text-[9px] text-gray-600 font-bold uppercase tracking-widest mt-0.5">{model.provider}</p>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        {/* Delete button for ALL models */}
                                        <div
                                            role="button"
                                            className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-rose-500/20 transition-all cursor-pointer z-10"
                                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleRemoveModel(model); }}
                                            title={model.isGlobal ? '从全局注册表移除' : '从当前提供商移除'}
                                        >
                                            <X size={14} className="text-rose-400" />
                                        </div>

                                        {isActive ? (
                                            <div className={`p-1 rounded-md ${activeTheme.activeZapWrap}`}>
                                                <Zap size={12} className={activeTheme.activeZap} />
                                            </div>
                                        ) : (
                                            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Plus size={12} className="text-gray-500" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Visual Accent */}
                                    {isActive && (
                                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${activeTheme.activeBar}`} />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full opacity-20 gap-3 py-10">
                        <Cpu size={32} />
                        <span className="text-[11px] uppercase font-black tracking-[0.2em] text-center px-6">该分类下暂无可用引擎</span>
                    </div>
                )}
            </div>

            {/* Manual Add & Actions */}
            <div className="p-6 border-t border-[#1e1e2d] bg-black/20 space-y-4">
                {isAdding ? (
                    <div className="space-y-3 animate-in slide-in-from-bottom-2 duration-300">
                        {/* Scope Toggle */}
                        <div className="flex items-center gap-1 p-1 bg-black/40 border border-[#1e1e2d] rounded-xl">
                            <button
                                onClick={() => setAddScope('global')}
                                className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${addScope === 'global'
                                    ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                                    : 'text-gray-500 hover:text-gray-300'
                                    }`}
                            >
                                🌐 全局模型
                            </button>
                            <button
                                onClick={() => setAddScope('provider')}
                                className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${addScope === 'provider'
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'text-gray-500 hover:text-gray-300'
                                    }`}
                                disabled={!activeProvider}
                            >
                                📌 {activeProvider?.name || '无提供商'}
                            </button>
                        </div>
                        <p className="text-[9px] text-gray-600 px-1">
                            {addScope === 'global'
                                ? '全局模型在所有提供商下均可见'
                                : `仅当“${activeProvider?.name}”激活时可见`
                            }
                        </p>
                        <div className="flex gap-2">
                            <input
                                autoFocus
                                type="text"
                                placeholder="输入模型 ID..."
                                className="flex-1 bg-black border border-indigo-500/50 rounded-xl px-4 py-2 text-xs text-white focus:outline-none"
                                value={newModelId}
                                onChange={(e) => setNewModelId(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleQuickAdd()}
                            />
                            <button
                                onClick={handleQuickAdd}
                                className={`p-2 rounded-xl text-white transition-colors ${addScope === 'global' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-emerald-600 hover:bg-emerald-500'
                                    }`}
                            >
                                <Plus size={18} />
                            </button>
                            <button
                                onClick={() => setIsAdding(false)}
                                className="bg-white/5 p-2 rounded-xl text-gray-500 hover:text-white transition-colors"
                            >
                                <RefreshCcw size={16} className="rotate-45" />
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between">
                        <button
                            onClick={() => setIsAdding(true)}
                            className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all active:scale-95 group"
                        >
                            <PlusCircle size={16} className="group-hover:rotate-90 transition-transform duration-300" />
                            <span className="text-[10px] font-black uppercase tracking-widest">添加模型</span>
                        </button>
                        <button
                            onClick={() => (window as any).openApiSettings()}
                            className="p-3 text-gray-600 hover:text-indigo-400 transition-colors"
                            title="API设置"
                        >
                            <RefreshCcw size={16} />
                        </button>
                    </div>
                )}

                <div className="flex items-center gap-2 opacity-30">
                    <Shield size={10} className="text-gray-600" />
                    <span className="text-[8px] text-gray-700 font-bold uppercase tracking-widest">Global Neural Key Security Enabled</span>
                </div>
            </div>
        </div>
    );
};

const Shield = ({ size, className }: { size: number, className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
);
