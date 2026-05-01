import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { X, Globe, Trash2, Edit2, Plus, Check, ChevronLeft } from 'lucide-react';
import { useStore } from '../store';
import { AIService } from '../services/aiService';
import type { APIProvider, ChatProtocol, ImageProtocol, ModelModality, ReasoningProtocol } from '../types';

interface ApiSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type TestKind = 'chat' | 'image';
const PROVIDER_MODALITY_OPTIONS: Array<{ value: ModelModality; label: string; hint: string }> = [
    { value: 'chat', label: '推理/对话', hint: '智能体沟通、表格智能解析、产品图匹配' },
    { value: 'image', label: '绘图', hint: 'AI 图片生成、批量出图' },
    { value: 'audio', label: '语音', hint: '语音合成节点' },
    { value: 'video', label: '视频', hint: '视频生成节点' },
];

const DEFAULT_PROVIDER_FORMAT = '多协议自动路由';
const DEFAULT_CHAT_PROTOCOL: ChatProtocol = 'auto';
const DEFAULT_REASONING_PROTOCOL: ReasoningProtocol = 'auto';
const DEFAULT_IMAGE_PROTOCOL: ImageProtocol = 'auto';

const DEFAULT_NEW_PROVIDER_PRESET: Partial<APIProvider> = {
    name: '测试',
    format: 'bltcy / gpt-best',
    baseUrl: 'https://api.bltcy.ai/v1',
    apiKey: '',
    chatProtocol: 'openai-chat',
    reasoningProtocol: 'openai-responses',
    imageProtocol: 'openai-images',
    textModels: 'gemini-3-flash-preview, gemini-3.1-pro-preview-thinking-low, gemini-3.1-flash-lite-preview',
    imageModels: 'gpt-image-2, nano-banana-2, doubao-seedream-4-5-251128, gemini-3.1-flash-image-preview, doubao-seedream-5-0-260128',
    audioModels: 'tts-1, gpt-4o-mini-tts',
    videoModels: 'veo3.1-pro-4k, veo3.1-pro, veo3.1-fast, sora-2-pro, sora-2',
};

const PROVIDER_FORMAT_OPTIONS = [
    '多协议自动路由',
    'bltcy / gpt-best',
    '云雾 / yunwu',
    '自定义',
];

const CHAT_PROTOCOL_OPTIONS: Array<{ value: ChatProtocol; label: string }> = [
    { value: 'auto', label: '自动' },
    { value: 'openai-chat', label: 'OpenAI Chat' },
    { value: 'openai-responses', label: 'OpenAI Responses' },
    { value: 'gemini-native', label: 'Gemini 原生' },
];

const REASONING_PROTOCOL_OPTIONS: Array<{ value: ReasoningProtocol; label: string }> = [
    { value: 'auto', label: '自动' },
    { value: 'inherit-chat', label: '继承对话' },
    { value: 'openai-responses', label: 'OpenAI Responses' },
    { value: 'gemini-native', label: 'Gemini 原生' },
];

const IMAGE_PROTOCOL_OPTIONS: Array<{ value: ImageProtocol; label: string }> = [
    { value: 'auto', label: '自动' },
    { value: 'openai-images', label: 'OpenAI Images' },
    { value: 'gemini-native', label: 'Gemini 原生' },
];

const createEditableProvider = (provider?: Partial<APIProvider> | null): Partial<APIProvider> => ({
    id: provider?.id,
    name: provider?.name || '',
    format: provider?.format || DEFAULT_PROVIDER_FORMAT,
    baseUrl: provider?.baseUrl || '',
    apiKey: provider?.apiKey || '',
    chatProtocol: provider?.chatProtocol || DEFAULT_CHAT_PROTOCOL,
    reasoningProtocol: provider?.reasoningProtocol || DEFAULT_REASONING_PROTOCOL,
    imageProtocol: provider?.imageProtocol || DEFAULT_IMAGE_PROTOCOL,
    textModels: provider?.textModels || '',
    imageModels: provider?.imageModels || '',
    audioModels: provider?.audioModels || '',
    videoModels: provider?.videoModels || '',
    isDefault: provider?.isDefault || false,
});

export const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({ isOpen, onClose }) => {
    const {
        apiProviders,
        activeProviderId,
        activeProviderIds,
        addProvider,
        updateProvider,
        deleteProvider,
        setActiveProvider,
        setActiveProviderForModality,
        pushNotice,
    } = useStore();
    const [view, setView] = useState<'list' | 'form'>('list');
    const [editingProvider, setEditingProvider] = useState<Partial<APIProvider> | null>(null);
    const [isTesting, setIsTesting] = useState<TestKind | null>(null);
    const [formAutoFillSeed] = useState(() => `provider-form-${Math.random().toString(36).slice(2, 8)}`);
    const [testResult, setTestResult] = useState<{
        kind: TestKind;
        ok: boolean;
        message: string;
        code?: string;
        latencyMs?: number;
        model?: string;
        detail?: string;
    } | null>(null);
    const aiService = React.useMemo(() => new AIService(), []);

    if (!isOpen) return null;

    const handleSave = () => {
        if (!editingProvider?.name || !editingProvider?.baseUrl || !editingProvider?.apiKey) {
            pushNotice('warn', '请填写必填项：名称、Base URL、API Key');
            return;
        }

        const providerData: APIProvider = {
            id: editingProvider.id || uuidv4(),
            name: editingProvider.name,
            format: editingProvider.format || DEFAULT_PROVIDER_FORMAT,
            baseUrl: editingProvider.baseUrl,
            apiKey: editingProvider.apiKey,
            chatProtocol: editingProvider.chatProtocol || DEFAULT_CHAT_PROTOCOL,
            reasoningProtocol: editingProvider.reasoningProtocol || DEFAULT_REASONING_PROTOCOL,
            imageProtocol: editingProvider.imageProtocol || DEFAULT_IMAGE_PROTOCOL,
            textModels: editingProvider.textModels || '',
            imageModels: editingProvider.imageModels || '',
            audioModels: editingProvider.audioModels || '',
            videoModels: editingProvider.videoModels || '',
            isDefault: editingProvider.isDefault || false,
        };

        if (editingProvider.id) {
            updateProvider(editingProvider.id, providerData);
        } else {
            addProvider(providerData);
        }

        if (providerData.isDefault || !activeProviderId) {
            setActiveProvider(providerData.id);
        }

        pushNotice('success', editingProvider.id ? '提供商已更新' : '提供商已添加');
        setEditingProvider(null);
        setTestResult(null);
        setView('list');
    };

    const startEdit = (provider: APIProvider) => {
        setEditingProvider(createEditableProvider(provider));
        setTestResult(null);
        setView('form');
    };

    const startAdd = () => {
        setEditingProvider(createEditableProvider({
            ...DEFAULT_NEW_PROVIDER_PRESET,
            isDefault: apiProviders.length === 0,
        }));
        setTestResult(null);
        setView('form');
    };

    const handleTestConnection = async (kind: TestKind) => {
        if (!editingProvider?.baseUrl || !editingProvider?.apiKey) {
            pushNotice('warn', '请先填写 Base URL 和 API Key');
            return;
        }

        const firstTextModel = (editingProvider.textModels || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)[0] || 'gpt-4o';

        const firstImageModel = (editingProvider.imageModels || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)[0] || 'flux-pro';

        setIsTesting(kind);
        setTestResult(null);

        try {
            const result = kind === 'chat'
                ? await aiService.testProviderConnection({
                    apiKey: editingProvider.apiKey,
                    baseUrl: editingProvider.baseUrl,
                    model: firstTextModel,
                    chatProtocol: editingProvider.chatProtocol || DEFAULT_CHAT_PROTOCOL,
                    reasoningProtocol: editingProvider.reasoningProtocol || DEFAULT_REASONING_PROTOCOL,
                })
                : await aiService.testImageProviderConnection({
                    apiKey: editingProvider.apiKey,
                    baseUrl: editingProvider.baseUrl,
                    model: firstImageModel,
                    imageProtocol: editingProvider.imageProtocol || DEFAULT_IMAGE_PROTOCOL,
                });

            setTestResult({ ...result, kind });
            if (result.ok) {
                pushNotice('success', `${kind === 'chat' ? '对话' : '图片'}测试成功${result.latencyMs ? ` (${result.latencyMs}ms)` : ''}`);
            } else {
                pushNotice('error', result.message || '连接失败');
            }
        } catch (error: any) {
            const message = error?.message || '连接测试失败';
            setTestResult({ kind, ok: false, message });
            pushNotice('error', message);
        } finally {
            setIsTesting(null);
        }
    };

    const renderProtocolSelect = <T extends string>(
        value: T | undefined,
        onChange: (value: T) => void,
        options: Array<{ value: T; label: string }>
    ) => (
        <select
            className="w-full bg-[#0b0b0f] border border-[#1e1e2d] rounded-xl px-4 py-3 text-sm text-gray-200 focus:border-indigo-500 outline-none transition-all appearance-none"
            value={value || options[0].value}
            onChange={(event) => onChange(event.target.value as T)}
        >
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    );

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="w-[560px] max-h-[90vh] overflow-hidden rounded-[32px] border border-[#1e1e2d] bg-[#14141c] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#1e1e2d] px-6 py-5">
                    <div className="flex items-center gap-3">
                        {view === 'form' && (
                            <button
                                onClick={() => {
                                    setView('list');
                                    setEditingProvider(null);
                                    setTestResult(null);
                                }}
                                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
                            >
                                <ChevronLeft size={18} />
                            </button>
                        )}
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400">
                            <Globe size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-black tracking-wide text-white">API 提供商</h2>
                            <p className="text-[10px] uppercase tracking-[0.3em] text-gray-500">
                                {view === 'list' ? 'Provider Registry' : 'Provider Config'}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="max-h-[calc(90vh-88px)] overflow-y-auto px-6 py-6">
                    {view === 'list' ? (
                        <div className="space-y-4">
                            <div className="rounded-3xl border border-indigo-500/20 bg-indigo-500/5 p-4">
                                <div className="mb-3 flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-black text-indigo-100">模型类型供货商路由</p>
                                        <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                                            可以让推理模型和绘图模型走不同供货商；未单独设置时会使用默认供货商。
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => activeProviderId && setActiveProvider(activeProviderId)}
                                        disabled={!activeProviderId}
                                        className="shrink-0 rounded-xl border border-indigo-400/20 bg-black/20 px-3 py-2 text-[10px] font-black text-indigo-200 transition hover:bg-indigo-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        当前默认应用到全部
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {PROVIDER_MODALITY_OPTIONS.map((option) => {
                                        const provider = apiProviders.find((item) => item.id === activeProviderIds?.[option.value])
                                            || apiProviders.find((item) => item.id === activeProviderId);
                                        return (
                                            <div key={option.value} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-[10px] font-black text-gray-200">{option.label}</span>
                                                    <span className="max-w-[120px] truncate rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-bold text-indigo-200" title={provider?.name || '未选择'}>
                                                        {provider?.name || '未选择'}
                                                    </span>
                                                </div>
                                                <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-gray-600">{option.hint}</p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            {apiProviders.length > 0 ? apiProviders.map((provider) => (
                                <div
                                    key={provider.id}
                                    className={`group rounded-3xl border p-4 transition-all ${provider.id === activeProviderId || Object.values(activeProviderIds || {}).includes(provider.id) ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-[#1e1e2d] bg-[#0f0f16]'}`}
                                >
                                    <div className="flex items-start gap-4">
                                        <button
                                            onClick={() => setActiveProvider(provider.id)}
                                            className={`mt-1 h-5 w-5 rounded-full border transition-all ${provider.id === activeProviderId ? 'border-indigo-400 bg-indigo-500' : 'border-[#2a2a3a] hover:border-indigo-400'}`}
                                            aria-label={`激活 ${provider.name}`}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate font-bold text-gray-100">{provider.name}</span>
                                                {provider.id === activeProviderId && (
                                                    <span className="rounded-md bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                                                        默认
                                                    </span>
                                                )}
                                                {PROVIDER_MODALITY_OPTIONS.filter((option) => activeProviderIds?.[option.value] === provider.id).map((option) => (
                                                    <span key={option.value} className="rounded-md bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                                                        {option.label}
                                                    </span>
                                                ))}
                                                {provider.isDefault && (
                                                    <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                                                        默认
                                                    </span>
                                                )}
                                            </div>
                                            <p className="mt-1 truncate font-mono text-[11px] text-gray-500">{provider.baseUrl}</p>
                                            <p className="mt-2 text-[10px] text-gray-500">
                                                对话：{provider.chatProtocol || DEFAULT_CHAT_PROTOCOL} · 推理：{provider.reasoningProtocol || DEFAULT_REASONING_PROTOCOL} · 图片：{provider.imageProtocol || DEFAULT_IMAGE_PROTOCOL}
                                            </p>
                                            <div className="mt-3 grid grid-cols-4 gap-1.5">
                                                {PROVIDER_MODALITY_OPTIONS.map((option) => {
                                                    const selected = activeProviderIds?.[option.value] === provider.id;
                                                    return (
                                                        <button
                                                            key={option.value}
                                                            type="button"
                                                            onClick={() => setActiveProviderForModality(option.value, provider.id)}
                                                            className={`rounded-lg border px-2 py-1.5 text-[9px] font-black transition ${selected ? 'border-cyan-300/40 bg-cyan-400/15 text-cyan-100' : 'border-white/10 bg-white/[0.03] text-gray-500 hover:border-cyan-300/30 hover:text-cyan-100'}`}
                                                            title={`设为${option.label}供货商：${option.hint}`}
                                                        >
                                                            {option.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                            <button
                                                onClick={() => startEdit(provider)}
                                                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-indigo-400"
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    deleteProvider(provider.id);
                                                    pushNotice('info', '提供商已删除');
                                                }}
                                                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-rose-400"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-[#1e1e2d] py-12 opacity-50">
                                    <Globe size={40} className="text-gray-600" />
                                    <p className="text-xs text-gray-500">还没有配置 API 提供商</p>
                                </div>
                            )}

                            <button
                                onClick={startAdd}
                                className="flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#1e1e2d] p-5 text-sm font-bold text-gray-500 transition-all hover:border-indigo-500/50 hover:bg-indigo-500/5 hover:text-indigo-400"
                            >
                                <Plus size={20} />
                                添加新提供商
                            </button>
                        </div>
                    ) : (
                        <form
                            className="space-y-6"
                            autoComplete="off"
                            data-form-type="other"
                            onSubmit={(event) => event.preventDefault()}
                        >
                            <input
                                type="text"
                                name={`${formAutoFillSeed}-guard-user`}
                                autoComplete="username"
                                tabIndex={-1}
                                aria-hidden="true"
                                className="hidden"
                            />
                            <input
                                type="password"
                                name={`${formAutoFillSeed}-guard-password`}
                                autoComplete="new-password"
                                tabIndex={-1}
                                aria-hidden="true"
                                className="hidden"
                            />
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">提供商名称</label>
                                    <input
                                        type="text"
                                        name={`${formAutoFillSeed}-provider-name`}
                                        autoComplete="off"
                                        placeholder="例如：云雾 Gemini"
                                        className="w-full rounded-xl border border-[#1e1e2d] bg-[#0b0b0f] px-4 py-3 text-sm text-gray-200 outline-none transition-all focus:border-indigo-500"
                                        value={editingProvider?.name || ''}
                                        onChange={(event) => setEditingProvider((prev) => ({ ...prev, name: event.target.value }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">提供商模板</label>
                                    <select
                                        className="w-full appearance-none rounded-xl border border-[#1e1e2d] bg-[#0b0b0f] px-4 py-3 text-sm text-gray-200 outline-none transition-all focus:border-indigo-500"
                                        value={editingProvider?.format || DEFAULT_PROVIDER_FORMAT}
                                        onChange={(event) => setEditingProvider((prev) => ({ ...prev, format: event.target.value }))}
                                    >
                                        {PROVIDER_FORMAT_OPTIONS.map((option) => (
                                            <option key={option} value={option}>
                                                {option}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Base URL</label>
                                <input
                                    type="text"
                                    name={`${formAutoFillSeed}-base-url`}
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder="https://api.example.com / https://yunwu.ai / https://gpt-best.example"
                                    className="w-full rounded-xl border border-[#1e1e2d] bg-[#0b0b0f] px-4 py-3 text-sm text-gray-200 outline-none transition-all focus:border-indigo-500"
                                    value={editingProvider?.baseUrl || ''}
                                    onChange={(event) => setEditingProvider((prev) => ({ ...prev, baseUrl: event.target.value }))}
                                />
                                <p className="text-[10px] text-gray-600">支持直接填写根地址，后端会按协议自动补足 OpenAI 或 Gemini 路径。</p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">API Key</label>
                                <input
                                    type="password"
                                    name={`${formAutoFillSeed}-api-key`}
                                    autoComplete="new-password"
                                    data-lpignore="true"
                                    data-1p-ignore="true"
                                    data-bwignore="true"
                                    spellCheck={false}
                                    placeholder="sk-..."
                                    className="w-full rounded-xl border border-[#1e1e2d] bg-[#0b0b0f] px-4 py-3 text-sm text-gray-200 outline-none transition-all focus:border-indigo-500"
                                    value={editingProvider?.apiKey || ''}
                                    onChange={(event) => setEditingProvider((prev) => ({ ...prev, apiKey: event.target.value }))}
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">对话协议</label>
                                    {renderProtocolSelect(
                                        editingProvider?.chatProtocol || DEFAULT_CHAT_PROTOCOL,
                                        (value) => setEditingProvider((prev) => ({ ...prev, chatProtocol: value })),
                                        CHAT_PROTOCOL_OPTIONS
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">推理协议</label>
                                    {renderProtocolSelect(
                                        editingProvider?.reasoningProtocol || DEFAULT_REASONING_PROTOCOL,
                                        (value) => setEditingProvider((prev) => ({ ...prev, reasoningProtocol: value })),
                                        REASONING_PROTOCOL_OPTIONS
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">图片协议</label>
                                    {renderProtocolSelect(
                                        editingProvider?.imageProtocol || DEFAULT_IMAGE_PROTOCOL,
                                        (value) => setEditingProvider((prev) => ({ ...prev, imageProtocol: value })),
                                        IMAGE_PROTOCOL_OPTIONS
                                    )}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-[#1e1e2d] bg-black/20 p-4 text-[11px] leading-5 text-gray-500">
                                自动模式会按模型名路由：Gemini 图片优先走 Gemini 原生接口，推理模型优先走 Responses 或 Gemini 原生，其余默认走 OpenAI 兼容接口。
                            </div>

                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                                    对话模型（逗号分隔）
                                    <span className="rounded bg-indigo-500/10 px-1 text-[8px] text-indigo-400">Chat / Text</span>
                                </label>
                                <textarea
                                    placeholder="gpt-4o, deepseek-v3.1, gemini-3-flash-preview"
                                    className="h-20 w-full resize-none rounded-xl border border-[#1e1e2d] bg-[#0b0b0f] px-4 py-3 text-xs text-gray-200 outline-none transition-all focus:border-indigo-500"
                                    value={editingProvider?.textModels || ''}
                                    onChange={(event) => setEditingProvider((prev) => ({ ...prev, textModels: event.target.value }))}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                                    图片模型（逗号分隔）
                                    <span className="rounded bg-orange-500/10 px-1 text-[8px] text-orange-400">Image</span>
                                </label>
                                <textarea
                                    placeholder="gpt-image-1, flux-kontext-pro, gemini-3-pro-image-preview"
                                    className="h-20 w-full resize-none rounded-xl border border-[#1e1e2d] bg-[#0b0b0f] px-4 py-3 text-xs text-gray-200 outline-none transition-all focus:border-indigo-500"
                                    value={editingProvider?.imageModels || ''}
                                    onChange={(event) => setEditingProvider((prev) => ({ ...prev, imageModels: event.target.value }))}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                                    音频模型（逗号分隔）
                                    <span className="rounded bg-cyan-500/10 px-1 text-[8px] text-cyan-400">Audio</span>
                                </label>
                                <textarea
                                    placeholder="tts-1, gpt-4o-mini-tts"
                                    className="h-20 w-full resize-none rounded-xl border border-[#1e1e2d] bg-[#0b0b0f] px-4 py-3 text-xs text-gray-200 outline-none transition-all focus:border-indigo-500"
                                    value={editingProvider?.audioModels || ''}
                                    onChange={(event) => setEditingProvider((prev) => ({ ...prev, audioModels: event.target.value }))}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                                    视频模型（逗号分隔）
                                    <span className="rounded bg-violet-500/10 px-1 text-[8px] text-violet-400">Video</span>
                                </label>
                                <textarea
                                    placeholder="veo, sora-2, luma-video"
                                    className="h-20 w-full resize-none rounded-xl border border-[#1e1e2d] bg-[#0b0b0f] px-4 py-3 text-xs text-gray-200 outline-none transition-all focus:border-indigo-500"
                                    value={editingProvider?.videoModels || ''}
                                    onChange={(event) => setEditingProvider((prev) => ({ ...prev, videoModels: event.target.value }))}
                                />
                            </div>

                            <label className="group flex cursor-pointer items-center gap-3">
                                <div className={`flex h-5 w-5 items-center justify-center rounded-md border transition-all ${editingProvider?.isDefault ? 'border-indigo-600 bg-indigo-600' : 'border-[#2a2a3a] group-hover:border-gray-500'}`}>
                                    {editingProvider?.isDefault && <Check size={14} className="text-white" />}
                                </div>
                                <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={editingProvider?.isDefault || false}
                                    onChange={(event) => setEditingProvider((prev) => ({ ...prev, isDefault: event.target.checked }))}
                                />
                                <span className="text-sm font-semibold text-gray-400">设为默认提供商</span>
                            </label>

                            <div className="space-y-3 pt-2">
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => handleTestConnection('chat')}
                                        disabled={isTesting !== null}
                                        className="rounded-xl border border-emerald-500/30 bg-emerald-600/20 py-3 font-bold text-emerald-300 transition-all hover:bg-emerald-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isTesting === 'chat' ? '正在测试对话…' : '测试对话模型'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleTestConnection('image')}
                                        disabled={isTesting !== null}
                                        className="rounded-xl border border-orange-500/30 bg-orange-600/20 py-3 font-bold text-orange-300 transition-all hover:bg-orange-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isTesting === 'image' ? '正在测试图片…' : '测试图片模型'}
                                    </button>
                                </div>

                                {testResult && (
                                    <div className={`rounded-xl border px-3 py-3 text-xs ${testResult.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>
                                        <p className="font-bold">{testResult.message}</p>
                                        <p className="mt-1 text-[11px] opacity-80">
                                            {testResult.kind === 'chat' ? '对话' : '图片'}模型：{testResult.model || '-'}
                                            {testResult.latencyMs ? ` · ${testResult.latencyMs}ms` : ''}
                                            {!testResult.ok && ` · ${testResult.code || 'UNKNOWN_ERROR'}`}
                                        </p>
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={handleSave}
                                    className="w-full rounded-xl bg-indigo-600 py-3 font-black text-white transition-all hover:bg-indigo-500"
                                >
                                    {editingProvider?.id ? '保存修改' : '添加提供商'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};
