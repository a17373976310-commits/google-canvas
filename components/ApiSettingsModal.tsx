import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
    X,
    Globe,
    Trash2,
    Edit2,
    Plus,
    Check,
    ChevronLeft,
    MessageSquare,
    Image as ImageIcon,
    Volume2,
    Video,
    Server,
    KeyRound,
    SlidersHorizontal,
    Zap,
} from 'lucide-react';
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

const MODALITY_UI: Record<ModelModality, { short: string; icon: React.ElementType; tone: string }> = {
    chat: { short: '对话', icon: MessageSquare, tone: 'is-chat' },
    image: { short: '绘图', icon: ImageIcon, tone: 'is-image' },
    audio: { short: '语音', icon: Volume2, tone: 'is-audio' },
    video: { short: '视频', icon: Video, tone: 'is-video' },
};

type ModelListField = 'textModels' | 'imageModels' | 'audioModels' | 'videoModels';
const MODEL_LIST_FIELDS: Array<{
    key: ModelListField;
    label: string;
    badge: string;
    placeholder: string;
    icon: React.ElementType;
    tone: string;
}> = [
    {
        key: 'textModels',
        label: '对话模型',
        badge: 'Chat / Text',
        placeholder: 'gpt-4o, deepseek-v3.1, gemini-3-flash-preview',
        icon: MessageSquare,
        tone: 'is-chat',
    },
    {
        key: 'imageModels',
        label: '图片模型',
        badge: 'Image',
        placeholder: 'gpt-image-1, flux-kontext-pro, gemini-3-pro-image-preview',
        icon: ImageIcon,
        tone: 'is-image',
    },
    {
        key: 'audioModels',
        label: '音频模型',
        badge: 'Audio',
        placeholder: 'tts-1, gpt-4o-mini-tts',
        icon: Volume2,
        tone: 'is-audio',
    },
    {
        key: 'videoModels',
        label: '视频模型',
        badge: 'Video',
        placeholder: 'veo, sora-2, luma-video',
        icon: Video,
        tone: 'is-video',
    },
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

const getProviderModelCount = (provider: APIProvider) => (
    [provider.textModels, provider.imageModels, provider.audioModels, provider.videoModels]
        .flatMap((models) => (models || '').split(',').map((item) => item.trim()).filter(Boolean))
        .length
);

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

        pushNotice('success', editingProvider.id ? '供应商已更新' : '供应商已添加');
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
            className="api-provider-input api-provider-select"
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
        <div className="api-provider-overlay fixed inset-0 z-[100] flex items-center justify-center animate-in fade-in duration-300">
            <div className="api-provider-modal max-h-[90vh] overflow-hidden border theme-border-subtle">
                <div className="api-provider-modal-header">
                    <div className="flex items-center gap-3">
                        {view === 'form' && (
                            <button
                                onClick={() => {
                                    setView('list');
                                    setEditingProvider(null);
                                    setTestResult(null);
                                }}
                                className="api-provider-nav-button"
                            >
                                <ChevronLeft size={18} />
                            </button>
                        )}
                        <div className="api-provider-modal-icon">
                            <Globe size={20} />
                        </div>
                        <div>
                            <h2 className="text-base font-black theme-text-primary">API 供应商</h2>
                            <p className="text-[11px] theme-text-muted">
                                {view === 'list' ? '管理默认供应商和各类型模型路由' : '配置供应商连接与模型清单'}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="api-provider-nav-button"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="api-provider-content custom-scrollbar">
                    {view === 'list' ? (
                        <div className="api-provider-registry">
                            <section className="api-provider-route-panel">
                                <div className="api-provider-section-head">
                                    <div>
                                        <p>模型路由</p>
                                        <span>不同节点类型可以使用不同供货商</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => activeProviderId && setActiveProvider(activeProviderId)}
                                        disabled={!activeProviderId}
                                        className="api-provider-link-button"
                                    >
                                        同步默认
                                    </button>
                                </div>
                                <div className="api-route-grid">
                                    {PROVIDER_MODALITY_OPTIONS.map((option) => {
                                        const provider = apiProviders.find((item) => item.id === activeProviderIds?.[option.value])
                                            || apiProviders.find((item) => item.id === activeProviderId);
                                        const RouteIcon = MODALITY_UI[option.value].icon;
                                        return (
                                            <div key={option.value} className={`api-route-card ${MODALITY_UI[option.value].tone}`}>
                                                <span className="api-route-card-label">
                                                    <RouteIcon size={13} />
                                                    {option.label}
                                                </span>
                                                <strong title={provider?.name || '未选择'}>{provider?.name || '未选择'}</strong>
                                                <em>{option.hint}</em>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>

                            <div className="api-provider-list-head">
                                <div>
                                    <p>供应商</p>
                                    <span>{apiProviders.length} 个配置</span>
                                </div>
                                <button type="button" onClick={startAdd} className="api-provider-add-compact">
                                    <Plus size={15} />
                                    新增
                                </button>
                            </div>

                            {apiProviders.length > 0 ? apiProviders.map((provider) => (
                                <div
                                    key={provider.id}
                                    className={`api-provider-card ${provider.id === activeProviderId || Object.values(activeProviderIds || {}).includes(provider.id) ? 'is-active' : ''}`}
                                >
                                    <div className="api-provider-main-row">
                                        <button
                                            onClick={() => setActiveProvider(provider.id)}
                                            className={`api-provider-radio ${provider.id === activeProviderId ? 'is-selected' : ''}`}
                                            aria-label={`激活 ${provider.name}`}
                                        >
                                            {provider.id === activeProviderId && <Check size={11} />}
                                        </button>
                                        <div className="api-provider-card-body">
                                            <div className="api-provider-title-row">
                                                <span className="api-provider-name">{provider.name}</span>
                                                {provider.id === activeProviderId && (
                                                    <span className="api-provider-badge is-default">
                                                        默认
                                                    </span>
                                                )}
                                                {PROVIDER_MODALITY_OPTIONS.filter((option) => activeProviderIds?.[option.value] === provider.id).map((option) => (
                                                    <span key={option.value} className={`api-provider-badge is-route ${MODALITY_UI[option.value].tone}`}>
                                                        {MODALITY_UI[option.value].short}
                                                    </span>
                                                ))}
                                            </div>
                                            <div className="api-provider-meta-row">
                                                <span className="api-provider-url" title={provider.baseUrl}>{provider.baseUrl}</span>
                                                <span>{getProviderModelCount(provider)} 个模型</span>
                                                <span>{provider.format || DEFAULT_PROVIDER_FORMAT}</span>
                                            </div>
                                            <div className="api-provider-protocols">
                                                <span>对话 {provider.chatProtocol || DEFAULT_CHAT_PROTOCOL}</span>
                                                <span>推理 {provider.reasoningProtocol || DEFAULT_REASONING_PROTOCOL}</span>
                                                <span>图片 {provider.imageProtocol || DEFAULT_IMAGE_PROTOCOL}</span>
                                            </div>
                                            <div className="api-provider-route-buttons">
                                                {PROVIDER_MODALITY_OPTIONS.map((option) => {
                                                    const selected = activeProviderIds?.[option.value] === provider.id;
                                                    return (
                                                        <button
                                                            key={option.value}
                                                            type="button"
                                                            onClick={() => setActiveProviderForModality(option.value, provider.id)}
                                                            className={`api-route-pill ${selected ? 'is-selected' : ''}`}
                                                            title={`设为${option.label}供应商：${option.hint}`}
                                                        >
                                                            {MODALITY_UI[option.value].short}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="api-provider-card-actions">
                                            <button
                                                onClick={() => startEdit(provider)}
                                                className="api-icon-button"
                                                title="编辑"
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    deleteProvider(provider.id);
                                                    pushNotice('info', '供应商已删除');
                                                }}
                                                className="api-icon-button is-danger"
                                                title="删除"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed theme-border-subtle py-12 opacity-50">
                                    <Globe size={40} className="theme-text-muted" />
                                    <p className="text-xs theme-text-muted">还没有配置 API 供应商</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <form
                            className="api-provider-form"
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

                            <div className="api-provider-form-grid">
                                <section className="api-provider-form-panel">
                                    <div className="api-provider-panel-title">
                                        <Server size={16} />
                                        <div>
                                            <p>连接设置</p>
                                            <span>供应商名称、访问地址和协议</span>
                                        </div>
                                    </div>

                                    <div className="api-provider-two-col">
                                        <label className="api-provider-field">
                                            <span className="api-provider-field-label">供应商名称</span>
                                            <input
                                                type="text"
                                                name={`${formAutoFillSeed}-provider-name`}
                                                autoComplete="off"
                                                placeholder="例如：云雾 Gemini"
                                                className="api-provider-input"
                                                value={editingProvider?.name || ''}
                                                onChange={(event) => setEditingProvider((prev) => ({ ...prev, name: event.target.value }))}
                                            />
                                        </label>
                                        <label className="api-provider-field">
                                            <span className="api-provider-field-label">供应商模板</span>
                                            <select
                                                className="api-provider-input api-provider-select"
                                                value={editingProvider?.format || DEFAULT_PROVIDER_FORMAT}
                                                onChange={(event) => setEditingProvider((prev) => ({ ...prev, format: event.target.value }))}
                                            >
                                                {PROVIDER_FORMAT_OPTIONS.map((option) => (
                                                    <option key={option} value={option}>
                                                        {option}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>

                                    <label className="api-provider-field">
                                        <span className="api-provider-field-label">Base URL</span>
                                        <input
                                            type="text"
                                            name={`${formAutoFillSeed}-base-url`}
                                            autoComplete="off"
                                            spellCheck={false}
                                            placeholder="https://api.example.com/v1"
                                            className="api-provider-input"
                                            value={editingProvider?.baseUrl || ''}
                                            onChange={(event) => setEditingProvider((prev) => ({ ...prev, baseUrl: event.target.value }))}
                                        />
                                        <em>支持根地址，后端会按协议自动补足 OpenAI 或 Gemini 路径。</em>
                                    </label>

                                    <label className="api-provider-field">
                                        <span className="api-provider-field-label api-provider-label-with-icon">
                                            <KeyRound size={12} />
                                            API Key
                                        </span>
                                        <input
                                            type="password"
                                            name={`${formAutoFillSeed}-api-key`}
                                            autoComplete="new-password"
                                            data-lpignore="true"
                                            data-1p-ignore="true"
                                            data-bwignore="true"
                                            spellCheck={false}
                                            placeholder="sk-..."
                                            className="api-provider-input"
                                            value={editingProvider?.apiKey || ''}
                                            onChange={(event) => setEditingProvider((prev) => ({ ...prev, apiKey: event.target.value }))}
                                        />
                                    </label>

                                    <div className="api-provider-protocol-grid">
                                        <label className="api-provider-field">
                                            <span className="api-provider-field-label">对话协议</span>
                                            {renderProtocolSelect(
                                                editingProvider?.chatProtocol || DEFAULT_CHAT_PROTOCOL,
                                                (value) => setEditingProvider((prev) => ({ ...prev, chatProtocol: value })),
                                                CHAT_PROTOCOL_OPTIONS
                                            )}
                                        </label>
                                        <label className="api-provider-field">
                                            <span className="api-provider-field-label">推理协议</span>
                                            {renderProtocolSelect(
                                                editingProvider?.reasoningProtocol || DEFAULT_REASONING_PROTOCOL,
                                                (value) => setEditingProvider((prev) => ({ ...prev, reasoningProtocol: value })),
                                                REASONING_PROTOCOL_OPTIONS
                                            )}
                                        </label>
                                        <label className="api-provider-field">
                                            <span className="api-provider-field-label">图片协议</span>
                                            {renderProtocolSelect(
                                                editingProvider?.imageProtocol || DEFAULT_IMAGE_PROTOCOL,
                                                (value) => setEditingProvider((prev) => ({ ...prev, imageProtocol: value })),
                                                IMAGE_PROTOCOL_OPTIONS
                                            )}
                                        </label>
                                    </div>

                                    <div className="api-provider-note">
                                        自动模式会按模型名路由：Gemini 图片优先走原生接口，推理模型优先走 Responses 或 Gemini 原生，其余走 OpenAI 兼容接口。
                                    </div>

                                    <label className="api-provider-default-toggle">
                                        <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={editingProvider?.isDefault || false}
                                            onChange={(event) => setEditingProvider((prev) => ({ ...prev, isDefault: event.target.checked }))}
                                        />
                                        <span className={editingProvider?.isDefault ? 'is-checked' : ''}>
                                            {editingProvider?.isDefault && <Check size={13} />}
                                        </span>
                                        设为默认供应商
                                    </label>
                                </section>

                                <section className="api-provider-form-panel">
                                    <div className="api-provider-panel-title">
                                        <SlidersHorizontal size={16} />
                                        <div>
                                            <p>模型清单</p>
                                            <span>多个模型用英文逗号分隔</span>
                                        </div>
                                    </div>

                                    <div className="api-provider-model-list">
                                        {MODEL_LIST_FIELDS.map((field) => {
                                            const FieldIcon = field.icon;
                                            return (
                                                <label key={field.key} className={`api-model-field ${field.tone}`}>
                                                    <span className="api-model-field-head">
                                                        <span>
                                                            <FieldIcon size={13} />
                                                            {field.label}
                                                        </span>
                                                        <em>{field.badge}</em>
                                                    </span>
                                                    <textarea
                                                        placeholder={field.placeholder}
                                                        className="api-provider-textarea"
                                                        value={(editingProvider?.[field.key] as string) || ''}
                                                        onChange={(event) => setEditingProvider((prev) => ({ ...prev, [field.key]: event.target.value }))}
                                                    />
                                                </label>
                                            );
                                        })}
                                    </div>
                                </section>
                            </div>

                            {testResult && (
                                <div className={`api-provider-test-result ${testResult.ok ? 'is-ok' : 'is-error'}`}>
                                    <strong>{testResult.message}</strong>
                                    <span>
                                        {testResult.kind === 'chat' ? '对话' : '图片'}模型：{testResult.model || '-'}
                                        {testResult.latencyMs ? ` · ${testResult.latencyMs}ms` : ''}
                                        {!testResult.ok && ` · ${testResult.code || 'UNKNOWN_ERROR'}`}
                                    </span>
                                </div>
                            )}

                            <div className="api-provider-form-footer">
                                <div className="api-provider-test-actions">
                                    <button
                                        type="button"
                                        onClick={() => handleTestConnection('chat')}
                                        disabled={isTesting !== null}
                                        className="api-provider-test-button is-chat"
                                    >
                                        <Zap size={13} />
                                        {isTesting === 'chat' ? '测试中…' : '测试对话'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleTestConnection('image')}
                                        disabled={isTesting !== null}
                                        className="api-provider-test-button is-image"
                                    >
                                        <Zap size={13} />
                                        {isTesting === 'image' ? '测试中…' : '测试图片'}
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleSave}
                                    className="api-provider-save-button"
                                >
                                    {editingProvider?.id ? '保存修改' : '添加供应商'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};
