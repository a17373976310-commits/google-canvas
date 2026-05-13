
import { create } from 'zustand';
import {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges
} from 'reactflow';
import * as XLSX from 'xlsx';
import { APIProvider, CanvasState, NodeType, NodeData, NODE_MODALITIES, NodeCapability, LogEntry, LogLevel, SavedWorkflow, RegisteredModel, Notice, ModelModality, ModelApplyScope, ImageHistoryItem, SpreadsheetParseOutput, SpreadsheetParseTask, StandardFilePayload, TaskSelectionOutput, TaskSelectionTask, BatchExecutionOutput, BatchExecutionItem, BatchImageResult, TaskVisualSpec, ProductImageMatchOutput, ProductImageCandidateAnalysis, StyleGuideOutput, CanonicalImageResult } from './types';
import { v4 as uuidv4 } from 'uuid';
import { AIService } from './services/aiService';
import { getModelCapabilities } from './config/modelCapabilities';
import { inferConnectionHandles } from './config/nodeSpecs';
import { normalizeImageSrc } from './utils/normalizeImageSrc';
import { DEFAULT_CHAT_PROMPT_TEMPLATE } from './config/promptTemplates';
import { ensureClientLicenseFresh } from './services/licenseClientApi';

let stopExecutionRequested = false;
const activeNodeAbortControllers = new Map<string, AbortController>();

const nodeProgressTimers = new Map<string, ReturnType<typeof setInterval>>();
const MAX_WORKFLOW_CONCURRENCY = 10;
const PRODUCT_IMAGE_ANALYSIS_CACHE_VERSION = 'v2';
const productImageAnalysisCache = new Map<string, ProductImageCandidateAnalysis[]>();
const DEFAULT_PROVIDER_FORMAT = '多协议自动路由';
const DEFAULT_CHAT_PROTOCOL: APIProvider['chatProtocol'] = 'auto';
const DEFAULT_REASONING_PROTOCOL: APIProvider['reasoningProtocol'] = 'auto';
const DEFAULT_IMAGE_PROTOCOL: APIProvider['imageProtocol'] = 'auto';
const DEFAULT_PROVIDER_PRESETS: Partial<APIProvider>[] = [
  {
    id: 'default-bltcy-provider',
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
    isDefault: true,
  },
];

const normalizeApiProvider = (provider: Partial<APIProvider> | null | undefined): APIProvider => ({
  id: provider?.id || uuidv4(),
  name: provider?.name || '未命名提供商',
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
  isDefault: Boolean(provider?.isDefault),
});

const loadApiProviders = (): APIProvider[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem('api_providers') || '[]');
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed.map((item) => normalizeApiProvider(item));

    const mergedDefaults = DEFAULT_PROVIDER_PRESETS.map((preset) => {
      const stored = normalized.find((item) => item.id === preset.id);
      return normalizeApiProvider({ ...preset, ...stored });
    });

    const extraProviders = normalized.filter((item) => (
      !DEFAULT_PROVIDER_PRESETS.some((preset) => preset.id === item.id)
    ));

    const merged = [...mergedDefaults, ...extraProviders];
    localStorage.setItem('api_providers', JSON.stringify(merged));
    return merged;
  } catch {
    const fallback = DEFAULT_PROVIDER_PRESETS.map((preset) => normalizeApiProvider(preset));
    localStorage.setItem('api_providers', JSON.stringify(fallback));
    return fallback;
  }
};

const buildApiSettings = (provider?: Partial<APIProvider> | null) => {
  if (!provider) return undefined;
  return {
    providerName: provider.name || '',
    apiKey: provider.apiKey || '',
    baseUrl: provider.baseUrl || '',
    chatProtocol: provider.chatProtocol || DEFAULT_CHAT_PROTOCOL,
    reasoningProtocol: provider.reasoningProtocol || DEFAULT_REASONING_PROTOCOL,
    imageProtocol: provider.imageProtocol || DEFAULT_IMAGE_PROTOCOL,
  };
};

const initialApiProviders = loadApiProviders();
const storedActiveProviderId = localStorage.getItem('active_provider_id');
const initialActiveProviderId = initialApiProviders.find((provider) => provider.id === storedActiveProviderId)?.id
  || initialApiProviders.find((provider) => provider.isDefault)?.id
  || initialApiProviders[0]?.id
  || null;
const PROVIDER_MODALITIES: ModelModality[] = ['chat', 'image', 'audio', 'video'];
const ACTIVE_PROVIDER_IDS_STORAGE_KEY = 'active_provider_ids';
const loadActiveProviderIds = (
  providers: APIProvider[],
  fallbackProviderId: string | null
): Partial<Record<ModelModality, string>> => {
  let raw: Partial<Record<ModelModality, string>> = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_PROVIDER_IDS_STORAGE_KEY) || '{}');
    raw = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    raw = {};
  }
  const providerIds = new Set(providers.map((provider) => provider.id));
  const resolved = PROVIDER_MODALITIES.reduce<Partial<Record<ModelModality, string>>>((acc, modality) => {
    const storedId = raw[modality];
    acc[modality] = storedId && providerIds.has(storedId)
      ? storedId
      : (fallbackProviderId && providerIds.has(fallbackProviderId) ? fallbackProviderId : providers[0]?.id);
    return acc;
  }, {});
  localStorage.setItem(ACTIVE_PROVIDER_IDS_STORAGE_KEY, JSON.stringify(resolved));
  return resolved;
};
const initialActiveProviderIds = loadActiveProviderIds(initialApiProviders, initialActiveProviderId);
const DEFAULT_REGISTERED_MODELS: RegisteredModel[] = [
  { id: 'gemini-3-flash-preview', modality: 'chat', addedAt: 0 },
  { id: 'gpt-image-2', modality: 'image', addedAt: 0 },
  { id: 'nano-banana-2', modality: 'image', addedAt: 0 },
];
const DEFAULT_GLOBAL_ACTIVE_MODELS: Partial<Record<ModelModality, string>> = {
  chat: 'gemini-3-flash-preview',
  image: 'gpt-image-2',
};

const loadRegisteredModels = (): RegisteredModel[] => {
  const raw = parseJsonStorage<RegisteredModel[]>('registered_models', []);
  const merged = [...DEFAULT_REGISTERED_MODELS];

  raw.forEach((model) => {
    if (!merged.some((existing) => existing.id === model.id && existing.modality === model.modality)) {
      merged.push(model);
    }
  });

  localStorage.setItem('registered_models', JSON.stringify(merged));
  return merged;
};

const loadGlobalActiveModels = (): Partial<Record<ModelModality, string>> => {
  const raw = parseJsonStorage<Partial<Record<ModelModality, string>>>('global_active_models', {});
  const merged = {
    ...DEFAULT_GLOBAL_ACTIVE_MODELS,
    ...raw,
  };

  localStorage.setItem('global_active_models', JSON.stringify(merged));
  return merged;
};

const stopNodeProgress = (nodeId: string) => {
  const timer = nodeProgressTimers.get(nodeId);
  if (timer) {
    clearInterval(timer);
    nodeProgressTimers.delete(nodeId);
  }
};

const stopAllNodeProgress = () => {
  nodeProgressTimers.forEach((timer) => clearInterval(timer));
  nodeProgressTimers.clear();
};

const startImageNodeProgress = (
  nodeId: string,
  updateNodeData: (id: string, data: Partial<NodeData>) => void
) => {
  stopNodeProgress(nodeId);

  let progress = 6;
  updateNodeData(nodeId, { progress });

  const timer = setInterval(() => {
    if (progress >= 93) return;
    const delta = progress < 55
      ? 8 + Math.floor(Math.random() * 7)
      : progress < 80
        ? 3 + Math.floor(Math.random() * 4)
        : 1 + Math.floor(Math.random() * 3);
    progress = Math.min(93, progress + delta);
    updateNodeData(nodeId, { progress });
  }, 1300);

  nodeProgressTimers.set(nodeId, timer);
};

const WORKFLOW_DB_NAME = 'ai_canvas_workflows_db';
const WORKFLOW_STORE_NAME = 'workflow_payloads';
const WORKFLOW_INDEX_KEY = 'saved_workflows';
const WORKFLOW_LOCAL_PAYLOADS_KEY = 'saved_workflow_local_payloads';
const IMAGE_HISTORY_STORAGE_KEY = 'image_history_items';
const MAX_LOCAL_IMAGE_HISTORY_ITEMS = 2;

type WorkflowPayload = { nodes: Node<NodeData>[]; edges: Edge[] };
type LocalWorkflowPayloadMap = Record<string, WorkflowPayload>;

const LEGACY_TEXT_FIXUPS: Record<string, string> = {
  '杈撳叆鏂囨湰': '输入文本',
  '杈撳叆鍐呭': '输入文本',
  '鏂囦欢涓婁紶': '文件上传',
  '琛ㄦ牸瑙ｆ瀽': '表格解析',
  '鍥剧墖涓婁紶': '图片上传',
  '澶氬浘涓婁紶': '多图上传',
  '鏅鸿兘瀵硅瘽': '智能对话',
  '鍥惧儚鐢熸垚': '图像生成',
  '璇煶鍚堟垚': '语音合成',
  '瑙嗛鐢熸垚': '视频生成',
  '缁撴灉瀵煎嚭': '结果输出',
  '瑙嗚鍒嗙粍': '视觉分组',
  '浠诲姟閫夋嫨': '任务选择',
  '鎵归噺鎵ц': '批量执行',
  '鍐欎竴娈靛叧浜庨瓟娉曟．鏋楃殑鏂囧瓧': '写一段关于魔法森林的文字',
  '鍓湰': '副本',
  '鏈懡鍚嶅伐浣滄祦': '未命名工作流'
};

const normalizeLegacyText = (value: string) => {
  let normalized = value;
  for (const [legacyText, fixedText] of Object.entries(LEGACY_TEXT_FIXUPS)) {
    if (normalized.includes(legacyText)) {
      normalized = normalized.split(legacyText).join(fixedText);
    }
  }
  return normalized;
};

const normalizeNodeDataText = (data: NodeData): NodeData => {
  const nextConfig = data.config ? { ...data.config } : {};

  if (typeof nextConfig.prompt === 'string') {
    nextConfig.prompt = normalizeLegacyText(nextConfig.prompt);
  }

  if (typeof nextConfig.systemInstruction === 'string') {
    nextConfig.systemInstruction = normalizeLegacyText(nextConfig.systemInstruction);
  }

  return {
    ...data,
    label: normalizeLegacyText(data.label || ''),
    config: nextConfig
  };
};

const LEGACY_REFERENCE_IMAGE_NODE_TYPE = 'REFERENCE_IMAGE';
const REMOVED_WORKFLOW_NODE_TYPES = new Set<string>([
  LEGACY_REFERENCE_IMAGE_NODE_TYPE,
  NodeType.STYLE_GUIDE,
]);

const normalizeWorkflowPayload = (payload: WorkflowPayload): WorkflowPayload => {
  const legacyReferenceNodes = payload.nodes.filter((node) => node.type === LEGACY_REFERENCE_IMAGE_NODE_TYPE);
  const legacyReferenceNodeIds = new Set(legacyReferenceNodes.map((node) => node.id));
  const removedNodeIds = new Set(
    payload.nodes
      .filter((node) => REMOVED_WORKFLOW_NODE_TYPES.has(String(node.type || '')))
      .map((node) => node.id)
  );

  const migratedEdges = [...payload.edges];

  legacyReferenceNodes.forEach((legacyNode) => {
    const incomingImageEdges = payload.edges.filter((edge) => (
      edge.target === legacyNode.id
      && (!edge.targetHandle || edge.targetHandle === 'image' || edge.targetHandle === 'default')
    ));
    const outgoingImageEdges = payload.edges.filter((edge) => (
      edge.source === legacyNode.id
      && edge.targetHandle === 'image'
    ));

    incomingImageEdges.forEach((incomingEdge) => {
      outgoingImageEdges.forEach((outgoingEdge) => {
        migratedEdges.push({
          ...outgoingEdge,
          id: `migrated-${incomingEdge.source}-${outgoingEdge.target}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          source: incomingEdge.source,
          sourceHandle: incomingEdge.sourceHandle,
          target: outgoingEdge.target,
          targetHandle: outgoingEdge.targetHandle
        });
      });
    });
  });

  return {
    nodes: payload.nodes
      .filter((node) => !removedNodeIds.has(node.id))
      .map((node) => ({
        ...node,
        data: normalizeNodeDataText(node.data)
      })),
    edges: migratedEdges
      .filter((edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target))
      .map((edge) => ({ ...edge }))
  };
};

const parseJsonStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
};

const loadLocalWorkflowPayloadMap = (): LocalWorkflowPayloadMap => {
  return parseJsonStorage<LocalWorkflowPayloadMap>(WORKFLOW_LOCAL_PAYLOADS_KEY, {});
};

const persistLocalWorkflowPayloadMap = (payloadMap: LocalWorkflowPayloadMap) => {
  if (Object.keys(payloadMap).length === 0) {
    localStorage.removeItem(WORKFLOW_LOCAL_PAYLOADS_KEY);
    return;
  }
  localStorage.setItem(WORKFLOW_LOCAL_PAYLOADS_KEY, JSON.stringify(payloadMap));
};

const saveLocalWorkflowPayload = (id: string, payload: WorkflowPayload) => {
  const payloadMap = loadLocalWorkflowPayloadMap();
  payloadMap[id] = clonePayload(payload);
  persistLocalWorkflowPayloadMap(payloadMap);
};

const loadLocalWorkflowPayload = (id: string): WorkflowPayload | null => {
  const payloadMap = loadLocalWorkflowPayloadMap();
  return payloadMap[id] ? clonePayload(payloadMap[id]) : null;
};

const deleteLocalWorkflowPayload = (id: string) => {
  const payloadMap = loadLocalWorkflowPayloadMap();
  if (!(id in payloadMap)) return;
  delete payloadMap[id];
  persistLocalWorkflowPayloadMap(payloadMap);
};

const syncLocalWorkflowPayloads = (workflows: SavedWorkflow[]) => {
  const payloadMap = loadLocalWorkflowPayloadMap();
  let changed = false;
  const validLocalIds = new Set(
    workflows
      .filter((wf) => wf.storage === 'local')
      .map((wf) => wf.id)
  );

  Object.keys(payloadMap).forEach((id) => {
    if (!validLocalIds.has(id)) {
      delete payloadMap[id];
      changed = true;
    }
  });

  workflows.forEach((wf) => {
    if (wf.storage === 'local' && wf.nodes && wf.edges && !payloadMap[wf.id]) {
      payloadMap[wf.id] = clonePayload({ nodes: wf.nodes, edges: wf.edges });
      changed = true;
    }
  });

  if (changed) persistLocalWorkflowPayloadMap(payloadMap);
};

const openWorkflowDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKFLOW_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKFLOW_STORE_NAME)) {
        db.createObjectStore(WORKFLOW_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveWorkflowPayload = async (id: string, payload: WorkflowPayload) => {
  const db = await openWorkflowDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WORKFLOW_STORE_NAME, 'readwrite');
    const store = tx.objectStore(WORKFLOW_STORE_NAME);
    store.put(clonePayload(payload), id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

const loadWorkflowPayload = async (id: string): Promise<WorkflowPayload | null> => {
  const db = await openWorkflowDB();
  const payload = await new Promise<WorkflowPayload | null>((resolve, reject) => {
    const tx = db.transaction(WORKFLOW_STORE_NAME, 'readonly');
    const store = tx.objectStore(WORKFLOW_STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ? clonePayload(req.result as WorkflowPayload) : null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return payload;
};

const deleteWorkflowPayload = async (id: string) => {
  const db = await openWorkflowDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WORKFLOW_STORE_NAME, 'readwrite');
    const store = tx.objectStore(WORKFLOW_STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

const getAllImageHistory = async (): Promise<ImageHistoryItem[]> => {
  return parseJsonStorage<ImageHistoryItem[]>(IMAGE_HISTORY_STORAGE_KEY, [])
    .map((item) => {
      const hasUsableResultUrl = typeof item?.resultImageUrl === 'string' && item.resultImageUrl.trim().length > 0;
      return {
        ...item,
        resultImageDataUrl: hasUsableResultUrl && typeof item?.resultImageDataUrl === 'string' && item.resultImageDataUrl.startsWith('data:image/')
          ? undefined
          : item?.resultImageDataUrl,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_LOCAL_IMAGE_HISTORY_ITEMS);
};

const saveImageHistoryItem = async (item: ImageHistoryItem) => {
  const hasUsableResultUrl = typeof item.resultImageUrl === 'string' && item.resultImageUrl.trim().length > 0;
  const cachedItem: ImageHistoryItem = {
    ...item,
    resultImageDataUrl: hasUsableResultUrl && typeof item.resultImageDataUrl === 'string' && item.resultImageDataUrl.startsWith('data:image/')
      ? undefined
      : item.resultImageDataUrl,
  };
  const nextItems = [
    cachedItem,
    ...parseJsonStorage<ImageHistoryItem[]>(IMAGE_HISTORY_STORAGE_KEY, []).filter((existing) => existing.id !== item.id)
  ]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_LOCAL_IMAGE_HISTORY_ITEMS);

  localStorage.setItem(IMAGE_HISTORY_STORAGE_KEY, JSON.stringify(nextItems));
  return cachedItem;
};

const deleteImageHistoryItemById = async (id: string) => {
  const remaining = parseJsonStorage<ImageHistoryItem[]>(IMAGE_HISTORY_STORAGE_KEY, [])
    .filter((item) => item.id !== id);

  if (remaining.length === 0) {
    localStorage.removeItem(IMAGE_HISTORY_STORAGE_KEY);
    return;
  }

  localStorage.setItem(IMAGE_HISTORY_STORAGE_KEY, JSON.stringify(remaining));
};

const clearImageHistoryStore = async () => {
  localStorage.removeItem(IMAGE_HISTORY_STORAGE_KEY);
};

const toDataUrl = async (src?: string): Promise<string | undefined> => {
  if (!src) return undefined;
  const value = src.trim();
  if (!value) return undefined;

  if (value.startsWith('data:')) return value;
  if (!value.startsWith('http')) {
    return `data:image/png;base64,${value}`;
  }

  try {
    const response = await fetch(value, { mode: 'cors' });
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
};

const revokeNodeResources = (node: Node<NodeData>) => {
  const output = node.data.output;
  if (!output || typeof output !== 'object') return;

  const visited = new Set<any>();
  const revokeDeep = (value: any) => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);

    if ('url' in value && typeof value.url === 'string' && value.url.startsWith('blob:')) {
      URL.revokeObjectURL(value.url);
    }

    if (Array.isArray(value)) {
      value.forEach(revokeDeep);
      return;
    }

    Object.values(value).forEach(revokeDeep);
  };

  revokeDeep(output);
};

const resolvePayloadBeforeApi = async (payload: any): Promise<any> => {
  if (!payload || typeof payload !== 'object') return payload;

  const resolved = Array.isArray(payload) ? [...payload] : { ...payload };

  if (!Array.isArray(resolved) && 'id' in resolved && 'type' in resolved && 'source' in resolved) {
    const stdPayload = resolved as StandardFilePayload;
    if ((stdPayload.type === 'image' || stdPayload.type === 'video') && stdPayload.url?.startsWith('blob:')) {
      try {
        const dataUrl = await toDataUrl(stdPayload.url);
        stdPayload.url = dataUrl;
      } catch (e) {
        console.error("Failed to resolve blob url for API: ", e);
      }
    }
    return stdPayload;
  }

  if (Array.isArray(resolved)) {
    for (let i = 0; i < resolved.length; i++) {
      resolved[i] = await resolvePayloadBeforeApi(resolved[i]);
    }
  } else {
    for (const key of Object.keys(resolved)) {
      if (typeof (resolved as any)[key] === 'object' && (resolved as any)[key] !== null) {
        (resolved as any)[key] = await resolvePayloadBeforeApi((resolved as any)[key]);
      }
    }
  }

  return resolved;
};

const persistWorkflowIndex = (workflows: SavedWorkflow[]) => {
  const indexOnly = workflows.map((wf) => ({
    id: wf.id,
    name: wf.name,
    timestamp: wf.timestamp,
    storage: wf.storage || (wf.nodes && wf.edges ? 'local' : 'idb')
  }));
  localStorage.setItem(WORKFLOW_INDEX_KEY, JSON.stringify(indexOnly));
  syncLocalWorkflowPayloads(workflows);
};

const clonePayload = (payload: WorkflowPayload) => {
  return normalizeWorkflowPayload(JSON.parse(JSON.stringify(payload)) as WorkflowPayload);
};

const loadSavedWorkflows = (): SavedWorkflow[] => {
  const stored = parseJsonStorage<any[]>(WORKFLOW_INDEX_KEY, []);
  const payloadMap = loadLocalWorkflowPayloadMap();
  let needsMigration = false;

  const workflows = stored.map((wf) => {
    const storage = wf?.storage || (wf?.nodes && wf?.edges ? 'local' : 'idb');
    if (wf?.nodes && wf?.edges) {
      const legacyPayload = clonePayload({ nodes: wf.nodes, edges: wf.edges });
      payloadMap[wf.id] = legacyPayload;
      needsMigration = true;
      return {
        id: wf.id,
        name: wf.name,
        timestamp: wf.timestamp,
        storage: 'local' as const,
        nodes: legacyPayload.nodes,
        edges: legacyPayload.edges
      };
    }

    if (storage === 'local' && payloadMap[wf.id]) {
      const payload = clonePayload(payloadMap[wf.id]);
      return {
        id: wf.id,
        name: wf.name,
        timestamp: wf.timestamp,
        storage: 'local' as const,
        nodes: payload.nodes,
        edges: payload.edges
      };
    }

    return {
      id: wf.id,
      name: wf.name,
      timestamp: wf.timestamp,
      storage
    } as SavedWorkflow;
  });

  if (needsMigration) {
    persistLocalWorkflowPayloadMap(payloadMap);
    localStorage.setItem(WORKFLOW_INDEX_KEY, JSON.stringify(
      workflows.map((wf) => ({
        id: wf.id,
        name: wf.name,
        timestamp: wf.timestamp,
        storage: wf.storage
      }))
    ));
  }

  return workflows;
};

const buildCopyName = (baseName: string, allNames: Set<string>) => {
  const root = `${normalizeLegacyText(baseName)} - 副本`;
  if (!allNames.has(root)) return root;

  let i = 2;
  while (allNames.has(`${root} ${i}`)) i += 1;
  return `${root} ${i}`;
};

const isSourceContentNodeType = (type?: NodeType) => (
  type === NodeType.INPUT
  || type === NodeType.IMAGE_UPLOAD
  || type === NodeType.MULTI_IMAGE_UPLOAD
  || type === NodeType.FILE_UPLOAD
);

const sanitizeDuplicatedNodeData = (data: NodeData, keepUploadData: boolean): NodeData => {
  const isUploadNode = data.type === NodeType.IMAGE_UPLOAD || data.type === NodeType.MULTI_IMAGE_UPLOAD;
  return {
    ...data,
    isSkipped: false,
    status: 'idle',
    error: undefined,
    progress: undefined,
    inputs: undefined,
    output: keepUploadData && isUploadNode ? data.output : undefined
  };
};

const normalizePromptText = (value: unknown): string => {
  const text = String(value ?? '').trim();
  if (!text) return '';

  const compact = text.replace(/\n{3,}/g, '\n\n').trim();
  const parts = compact.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const deduped: string[] = [];
    parts.forEach((part) => {
      if (!deduped.includes(part)) deduped.push(part);
    });
    return deduped.join('\n\n');
  }

  return compact;
};

const isCanonicalImageResult = (value: unknown): value is CanonicalImageResult => {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as CanonicalImageResult).primaryUrl === 'string'
    && Array.isArray((value as CanonicalImageResult).urls)
  );
};

const getPrimaryImageUrl = (value: unknown): string | undefined => {
  if (isCanonicalImageResult(value)) {
    const direct = normalizeImageSrc(value.localCacheUrl || value.primaryUrl || value.urls[0] || '');
    return direct || undefined;
  }

  const normalized = normalizeImageSrc(value);
  return normalized || undefined;
};

const getAllImageUrls = (value: unknown): string[] => {
  if (isCanonicalImageResult(value)) {
    const cacheUrl = normalizeImageSrc(value.localCacheUrl || '');
    const normalized = [
      ...(cacheUrl ? [cacheUrl] : []),
      ...value.urls,
    ]
      .map((item) => normalizeImageSrc(item) || '')
      .filter((item, index, all) => Boolean(item) && all.indexOf(item) === index);
    if (normalized.length > 0) return normalized;
    const primary = getPrimaryImageUrl(value);
    return primary ? [primary] : [];
  }

  const primary = getPrimaryImageUrl(value);
  return primary ? [primary] : [];
};

const normalizeGenerationOutput = (rawOutput: unknown): unknown => {
  if (isCanonicalImageResult(rawOutput)) {
    const primaryUrl = getPrimaryImageUrl(rawOutput) || '';
    const urls = getAllImageUrls(rawOutput);
    return {
      ...rawOutput,
      primaryUrl,
      urls: urls.length > 0 ? urls : (primaryUrl ? [primaryUrl] : []),
      localCacheUrl: rawOutput.localCacheUrl || null,
      selectedIndex: typeof rawOutput.selectedIndex === 'number' ? rawOutput.selectedIndex : 0,
    } as CanonicalImageResult;
  }

  if (Array.isArray(rawOutput)) {
    return rawOutput.map((item) => normalizeImageSrc(item) ?? item);
  }

  return normalizeImageSrc(rawOutput) ?? rawOutput;
};

const normalizeUiErrorMessage = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Unknown error';

  const replacements: Array<[string, string]> = [
    ['璇峰厛涓婁紶鍥剧墖', '请先上传图片'],
    ['璇峰厛涓婁紶鏂囦欢', '请先上传文件'],
    ['璇峰厛涓婁紶鏁版嵁', '请先上传数据'],
    ['Please upload at least one image', '请至少上传一张图片'],
    ['缂哄皯涓婃父鏁版嵁', '缺少上游数据'],
    ['鏈煡鑺傜偣', '未知节点'],
    ['鎻掓Ы', '插槽'],
    ['璇峰厛杩炴帴骞朵笂浼?Excel 琛ㄦ牸', '请先连接并上传 Excel 表格'],
    ['璇诲彇琛ㄦ牸鏂囦欢澶辫触', '读取表格文件失败'],
    ['璇蜂笂浼?Excel / CSV 琛ㄦ牸鏂囦欢', '请上传 Excel / CSV 表格文件'],
    ['鏈煡鎵ц閿欒', '未知执行错误'],
    ['鎵归噺鍑哄浘澶辫触', '批量出图失败'],
  ];

  let normalized = raw;
  replacements.forEach(([from, to]) => {
    normalized = normalized.split(from).join(to);
  });
  return normalizeLegacyText(normalized);
};

const getDescendantNodeIds = (startId: string, edges: Edge[]): string[] => {
  const result = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    edges.forEach((edge) => {
      if (edge.source !== current || result.has(edge.target)) return;
      result.add(edge.target);
      queue.push(edge.target);
    });
  }

  return Array.from(result);
};

const DEFAULT_TABLE_PARSE_CONFIG = {
  sheetName: 'auto',
  headerRow: 2,
  dataStartRow: 3,
  idColumn: 'A',
  sizeColumn: 'B',
  referenceColumn: 'C',
  requirementColumn: 'D',
  textColumns: 'E,F,G',
  skipEmptyRows: true,
  extractEmbeddedImages: true,
  maxRows: 200,
  parseMode: 'auto',
  smartModelId: '',
  smartParseNotes: '',
  smartRowsPerSnapshot: 18,
  smartMaxColumns: 12,
  smartMaxSheets: 0
};

type TableParseMode = 'standard' | 'smart' | 'auto';

type EffectiveTableParseConfig = {
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  idColumn: string;
  sizeColumn: string;
  referenceColumn: string;
  requirementColumn: string;
  textColumns: string[];
  skipEmptyRows: boolean;
  extractEmbeddedImages: boolean;
  maxRows: number;
  parseMode: TableParseMode;
  smartModelId: string;
  smartParseNotes: string;
  smartRowsPerSnapshot: number;
  smartMaxColumns: number;
  smartMaxSheets: number;
};

const DEFAULT_TASK_SELECT_CONFIG = {
  taskIndex: 1
};

const DEFAULT_BATCH_EXECUTE_CONFIG = {
  startIndex: 1,
  endIndex: 0,
  intervalMs: 0,
  continueOnError: true
};

const DEFAULT_PRODUCT_IMAGE_MATCH_CONFIG = {
  maxSelections: 3,
  matchNotes: ''
};

const DEFAULT_STYLE_GUIDE_CONFIG = {
  styleName: '电商统一风格',
  tone: '高级、干净、可信赖',
  palette: '暖白、银灰、浅木色、少量品牌色',
  lighting: '柔和自然光，整体通透，局部高光清晰',
  background: '简洁家居或电商展示环境，避免杂乱',
  composition: '主体突出，留白充足，适合电商排版',
  camera: '中近景为主，平视或轻微俯拍，避免夸张广角',
  material: '真实还原产品材质，保留金属、玻璃、织物等细节',
  qualityKeywords: '商业摄影质感、高清细节、产品真实、适合电商详情页',
  consistencyRules: '统一配色、统一光线方向、统一景深、统一构图密度',
  negativeRules: '避免产品变形、避免背景杂乱、避免无关元素、避免风格漂移'
};

const normalizeCellText = (value: unknown) => String(value ?? '')
  .replace(/\r\n/g, '\n')
  .replace(/\r/g, '\n')
  .trim();

const normalizeZipPath = (value: string) => value.replace(/\\/g, '/').replace(/^\/+/, '');

const normalizeColumnRef = (value: unknown, fallback: string) => {
  const raw = String(value ?? fallback).trim().toUpperCase();
  return /^[A-Z]+$/.test(raw) ? raw : fallback;
};

const columnRefToIndex = (ref: string) => {
  let result = 0;
  for (const char of ref) {
    result = result * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, result - 1);
};

const parseColumnRefs = (value: unknown, fallback: string[]) => {
  const refs = String(value ?? '')
    .split(/[ ,\s，、]+/)
    .map((item) => item.trim().toUpperCase())
    .filter((item) => /^[A-Z]+$/.test(item));
  return refs.length > 0 ? refs : fallback;
};

const normalizeTableParseMode = (value: unknown): TableParseMode => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'standard' || normalized === 'smart' || normalized === 'auto') {
    return normalized;
  }
  return DEFAULT_TABLE_PARSE_CONFIG.parseMode as TableParseMode;
};

const getEffectiveTableParseConfig = (config?: NodeData['config']): EffectiveTableParseConfig => ({
  ...DEFAULT_TABLE_PARSE_CONFIG,
  ...config,
  sheetName: String(config?.sheetName || DEFAULT_TABLE_PARSE_CONFIG.sheetName),
  headerRow: Math.max(1, Number(config?.headerRow || DEFAULT_TABLE_PARSE_CONFIG.headerRow)),
  dataStartRow: Math.max(1, Number(config?.dataStartRow || DEFAULT_TABLE_PARSE_CONFIG.dataStartRow)),
  idColumn: normalizeColumnRef(config?.idColumn, DEFAULT_TABLE_PARSE_CONFIG.idColumn),
  sizeColumn: normalizeColumnRef(config?.sizeColumn, DEFAULT_TABLE_PARSE_CONFIG.sizeColumn),
  referenceColumn: normalizeColumnRef(config?.referenceColumn, DEFAULT_TABLE_PARSE_CONFIG.referenceColumn),
  requirementColumn: normalizeColumnRef(config?.requirementColumn, DEFAULT_TABLE_PARSE_CONFIG.requirementColumn),
  textColumns: parseColumnRefs(
    config?.textColumns,
    parseColumnRefs(DEFAULT_TABLE_PARSE_CONFIG.textColumns, ['E', 'F', 'G'])
  ),
  skipEmptyRows: config?.skipEmptyRows !== false,
  extractEmbeddedImages: config?.extractEmbeddedImages !== false,
  maxRows: Math.max(1, Number(config?.maxRows || DEFAULT_TABLE_PARSE_CONFIG.maxRows)),
  parseMode: normalizeTableParseMode(config?.parseMode),
  smartModelId: normalizeCellText(config?.smartModelId || config?.modelId || ''),
  smartParseNotes: normalizeCellText(config?.smartParseNotes),
  smartRowsPerSnapshot: Math.max(
    6,
    Number(config?.smartRowsPerSnapshot || DEFAULT_TABLE_PARSE_CONFIG.smartRowsPerSnapshot)
  ),
  smartMaxColumns: Math.max(
    4,
    Number(config?.smartMaxColumns || DEFAULT_TABLE_PARSE_CONFIG.smartMaxColumns)
  ),
  smartMaxSheets: Math.max(0, Number(config?.smartMaxSheets ?? DEFAULT_TABLE_PARSE_CONFIG.smartMaxSheets))
});

type TaskVisualSource = Pick<SpreadsheetParseTask, 'serialNo' | 'size' | 'requirementZh' | 'referenceText' | 'textLayers' | 'rawRow' | 'source' | 'sheetTaskIndex'> & {
  visualSpec?: TaskVisualSpec;
};

type TaskVisualRule =
  | {
    ruleName: string;
    taskType: string;
    keywords: string[];
    layoutMode: 'fixed';
    aspectRatio: string;
    imageSize?: string;
  }
  | {
    ruleName: string;
    taskType: string;
    keywords: string[];
    layoutMode: 'adaptive';
    adaptiveRatios: Record<'short' | 'medium' | 'long', string>;
    imageSize?: string;
  };

const SUPPORTED_TASK_ASPECT_RATIOS = [
  '21:9',
  '16:9',
  '9:16',
  '8:1',
  '5:4',
  '4:5',
  '4:3',
  '4:1',
  '3:4',
  '3:2',
  '2:3',
  '1:8',
  '1:4',
  '1:1'
] as const;

const AMAZON_TASK_VISUAL_RULES: TaskVisualRule[] = [
  { ruleName: '亚马逊主图', taskType: 'amazon_main', keywords: ['主图', '首图', '白底主图', '白底图'], layoutMode: 'fixed', aspectRatio: '1:1', imageSize: '2K' },
  { ruleName: '亚马逊大A+', taskType: 'amazon_a_plus_large', keywords: ['大a+', '大尺寸a+', 'a+横幅', 'a+顶部横幅', '品牌故事长图'], layoutMode: 'fixed', aspectRatio: '21:9', imageSize: '2K' },
  { ruleName: '亚马逊小A+', taskType: 'amazon_a_plus_small', keywords: ['小a+', '小尺寸a+', 'a+小图', '卖点模块'], layoutMode: 'fixed', aspectRatio: '3:2', imageSize: '2K' },
  { ruleName: '亚马逊品牌故事小图', taskType: 'amazon_brand_story_small', keywords: ['品牌故事小图', '品牌故事卡片', '故事小图'], layoutMode: 'fixed', aspectRatio: '3:4', imageSize: '2K' },
  { ruleName: '亚马逊品牌故事长图', taskType: 'amazon_brand_story_large', keywords: ['品牌故事长图', '故事长图', '品牌横幅'], layoutMode: 'fixed', aspectRatio: '21:9', imageSize: '2K' }
];

const TAOBAO_TASK_VISUAL_RULES: TaskVisualRule[] = [
  { ruleName: '淘宝主图', taskType: 'taobao_main', keywords: ['淘宝主图', '主图', '首图', '商品主图'], layoutMode: 'fixed', aspectRatio: '1:1', imageSize: '2K' },
  { ruleName: '淘宝横幅', taskType: 'taobao_banner', keywords: ['横幅', 'banner', '活动横图', '店铺横幅', '首页横幅'], layoutMode: 'fixed', aspectRatio: '21:9', imageSize: '2K' },
  { ruleName: '淘宝卖点海报', taskType: 'taobao_poster', keywords: ['卖点海报', '功能海报', '活动海报', '竖版海报'], layoutMode: 'fixed', aspectRatio: '4:5', imageSize: '2K' },
  {
    ruleName: '淘宝详情模块',
    taskType: 'taobao_detail_module',
    keywords: ['详情页', '详情图', '详情模块', '详情长图', '长图模块'],
    layoutMode: 'adaptive',
    adaptiveRatios: {
      short: '4:5',
      medium: '3:4',
      long: '9:16'
    },
    imageSize: '2K'
  }
];

const GENERIC_TASK_VISUAL_RULES: TaskVisualRule[] = [
  { ruleName: '通用主图', taskType: 'generic_main', keywords: ['主图', '首图', '白底主图'], layoutMode: 'fixed', aspectRatio: '1:1', imageSize: '2K' },
  { ruleName: '通用横幅', taskType: 'generic_banner', keywords: ['横幅', 'banner', '长图', '宽图'], layoutMode: 'fixed', aspectRatio: '21:9', imageSize: '2K' },
  { ruleName: '通用细节特写', taskType: 'detail_closeup', keywords: ['细节', '特写', '局部', '刷头', '喷嘴', '配件'], layoutMode: 'fixed', aspectRatio: '1:1', imageSize: '2K' },
  { ruleName: '通用场景图', taskType: 'lifestyle_scene', keywords: ['场景图', '使用场景', '生活场景', '氛围图'], layoutMode: 'fixed', aspectRatio: '3:2', imageSize: '2K' },
  { ruleName: '通用竖图', taskType: 'generic_vertical', keywords: ['竖图', '卡片图', '小图'], layoutMode: 'fixed', aspectRatio: '3:4', imageSize: '2K' }
];

const normalizeRatioToken = (value: string) => value
  .replace(/[：]/g, ':')
  .replace(/[xX×*]/g, ':')
  .replace(/[／]/g, '/')
  .replace(/\s+/g, '')
  .trim();

const hasMeaningfulTaskVisualSpec = (spec?: TaskVisualSpec) => !!spec && Object.values(spec).some((value) => {
  if (value === undefined || value === null) return false;
  return String(value).trim().length > 0;
});

const collectTaskVisualTexts = (task: TaskVisualSource) => {
  const sourceSheetName = normalizeCellText(task.source?.sheetName);
  const rawValues = Object.values(task.rawRow || {}).map((value) => normalizeCellText(value));
  return [
    sourceSheetName,
    normalizeCellText(task.size),
    normalizeCellText(task.requirementZh),
    normalizeCellText(task.referenceText),
    ...task.textLayers.map((value) => normalizeCellText(value)),
    ...rawValues
  ].filter(Boolean);
};

const detectDirectTaskAspectRatio = (texts: string[]) => {
  const normalizedTexts = texts.map((text) => normalizeRatioToken(text));
  for (const ratio of SUPPORTED_TASK_ASPECT_RATIOS) {
    if (normalizedTexts.some((text) => text.includes(ratio))) {
      return ratio;
    }
  }
  return '';
};

const detectTaskPlatform = (searchText: string, sourceSheetName = ''): TaskVisualSpec['platform'] => {
  if (/(淘宝|taobao|天猫|tmall)/i.test(sourceSheetName)) return 'taobao';
  if (/(亚马逊|amazon)/i.test(sourceSheetName)) return 'amazon';
  if (/(a\+|a＋|品牌故事)/i.test(sourceSheetName)) return 'amazon';
  if (/(详情页|详情图|详情模块)/i.test(sourceSheetName)) return 'taobao';
  if (/(淘宝|taobao|天猫|tmall)/i.test(searchText)) return 'taobao';
  if (/(亚马逊|amazon)/i.test(searchText)) return 'amazon';
  if (/(a\+|a＋|品牌故事)/i.test(searchText)) return 'amazon';
  if (/(详情页|详情图|详情模块)/i.test(searchText)) return 'taobao';
  return 'generic';
};

const matchesTaskVisualKeywords = (searchText: string, keywords: string[]) => keywords.some((keyword) => searchText.includes(keyword.toLowerCase()));

const countTaskVisualKeywordMatches = (searchText: string, keywords: string[]) => keywords.reduce((total, keyword) => (
  searchText.includes(keyword.toLowerCase()) ? total + 1 : total
), 0);

const AMAZON_A_PLUS_LARGE_HINTS = ['大a+', '大尺寸a+', 'a+横幅', '顶部横幅', '横图', '横幅', '长图', '宽图', '1460*600', '1460×600', '970*600', '970×600'];
const AMAZON_A_PLUS_SMALL_HINTS = ['小a+', '小尺寸a+', 'a+小图', '小图', '小模块', '小卡片', '卡片图', '300*300', '300×300'];

const normalizeTaskSheetName = (sheetName?: string) => normalizeCellText(sheetName).toLowerCase();
const isAmazonAPlusSheet = (sheetName?: string) => /(a\+|a＋)/i.test(sheetName || '');
const isAmazonBrandStorySheet = (sheetName?: string) => /品牌故事/i.test(sheetName || '');
const isMainImageSheet = (sheetName?: string) => /主图/.test(sheetName || '');

const hasExplicitAmazonAPlusVariantHint = (searchText: string) => (
  matchesTaskVisualKeywords(searchText, AMAZON_A_PLUS_LARGE_HINTS)
  || matchesTaskVisualKeywords(searchText, AMAZON_A_PLUS_SMALL_HINTS)
);

const resolveAmazonProjectTemplateSpec = (
  task: TaskVisualSource,
  searchText: string
): TaskVisualSpec | null => {
  const sheetName = normalizeTaskSheetName(task.source?.sheetName);

  if (isAmazonAPlusSheet(sheetName)) {
    const isSmallVariant = matchesTaskVisualKeywords(searchText, AMAZON_A_PLUS_SMALL_HINTS);
    const isLargeVariant = isSmallVariant
      ? false
      : matchesTaskVisualKeywords(searchText, AMAZON_A_PLUS_LARGE_HINTS);

    if (isSmallVariant) {
      return {
        platform: 'amazon',
        taskType: 'amazon_a_plus_small',
        layoutMode: 'fixed',
        layoutVariant: 'fixed',
        targetAspectRatio: '3:2',
        targetImageSize: '2K',
        matchedRule: 'amazon_project_a_plus_small'
      };
    }

    if (isLargeVariant || !hasExplicitAmazonAPlusVariantHint(searchText)) {
      return {
        platform: 'amazon',
        taskType: 'amazon_a_plus_large',
        layoutMode: 'fixed',
        layoutVariant: 'fixed',
        targetAspectRatio: '21:9',
        targetImageSize: '2K',
        matchedRule: 'amazon_project_a_plus_large'
      };
    }
  }

  if (isAmazonBrandStorySheet(sheetName)) {
    const isLargeVariant = matchesTaskVisualKeywords(searchText, ['品牌故事背景', '品牌故事长图', '长图', '横幅', '背景图', '1464*625', '1464×625', '315*145', '315×145']);
    const isSmallVariant = matchesTaskVisualKeywords(searchText, ['品牌故事小图', '小图', '卡片', '362*453', '362×453']);

    if (isLargeVariant || (!isSmallVariant && Number(task.sheetTaskIndex || 1) === 1)) {
      return {
        platform: 'amazon',
        taskType: 'amazon_brand_story_large',
        layoutMode: 'fixed',
        layoutVariant: 'fixed',
        targetAspectRatio: '21:9',
        targetImageSize: '2K',
        matchedRule: 'amazon_project_brand_story_large'
      };
    }

    return {
      platform: 'amazon',
      taskType: 'amazon_brand_story_small',
      layoutMode: 'fixed',
      layoutVariant: 'fixed',
      targetAspectRatio: '3:4',
      targetImageSize: '2K',
      matchedRule: 'amazon_project_brand_story_small'
    };
  }

  if (isMainImageSheet(sheetName)) {
    return {
      platform: 'amazon',
      taskType: 'amazon_main',
      layoutMode: 'fixed',
      layoutVariant: 'fixed',
      targetAspectRatio: '1:1',
      targetImageSize: '2K',
      matchedRule: 'amazon_project_main'
    };
  }

  return null;
};

const scoreTaskVisualRule = (
  rule: TaskVisualRule,
  searchText: string,
  sourceSheetName: string
) => {
  const normalizedSheetName = sourceSheetName.toLowerCase();
  const sheetKeywordScore = countTaskVisualKeywordMatches(normalizedSheetName, rule.keywords) * 100;
  const searchKeywordScore = countTaskVisualKeywordMatches(searchText, rule.keywords) * 10;
  let contextualBonus = 0;

  if (/主图/.test(normalizedSheetName) && /_main$/.test(rule.taskType)) {
    contextualBonus += 90;
  }

  if (/(a\+|a＋)/.test(normalizedSheetName)) {
    if (rule.taskType.includes('a_plus')) contextualBonus += 120;
    const hasLargeAPlusHints = matchesTaskVisualKeywords(searchText, AMAZON_A_PLUS_LARGE_HINTS);
    const hasSmallAPlusHints = matchesTaskVisualKeywords(searchText, AMAZON_A_PLUS_SMALL_HINTS);

    if (!hasSmallAPlusHints && rule.taskType.includes('a_plus_large')) {
      contextualBonus += 140;
    }

    if (hasLargeAPlusHints) {
      if (rule.taskType.includes('a_plus_large')) contextualBonus += 240;
      if (rule.taskType.includes('a_plus_small')) contextualBonus -= 120;
    }

    if (hasSmallAPlusHints) {
      if (rule.taskType.includes('a_plus_small')) contextualBonus += 240;
      if (rule.taskType.includes('a_plus_large')) contextualBonus -= 120;
    }

    if (
      rule.taskType.includes('a_plus_small')
      && matchesTaskVisualKeywords(searchText, ['小图', '小尺寸', '小模块', '小卡片', '卡片'])
    ) {
      contextualBonus += 80;
    }
    if (
      rule.taskType.includes('a_plus_large')
      && matchesTaskVisualKeywords(searchText, ['大图', '大尺寸', '横图', '横幅', '长图', '顶部', '宽图'])
    ) {
      contextualBonus += 80;
    }
  }

  if (/品牌故事/.test(normalizedSheetName)) {
    if (rule.taskType.includes('brand_story')) contextualBonus += 120;
    if (
      rule.taskType.includes('brand_story_small')
      && matchesTaskVisualKeywords(searchText, ['小图', '小卡', '卡片'])
    ) {
      contextualBonus += 80;
    }
    if (
      rule.taskType.includes('brand_story_large')
      && matchesTaskVisualKeywords(searchText, ['长图', '横图', '横幅', '顶部'])
    ) {
      contextualBonus += 80;
    }
  }

  if (/(详情页|详情图|详情模块)/.test(normalizedSheetName) && rule.taskType.includes('detail_module')) {
    contextualBonus += 120;
  }

  if (/(卖点海报|竖版海报)/.test(normalizedSheetName) && rule.taskType.includes('poster')) {
    contextualBonus += 70;
  }

  if (/(横幅|banner)/.test(normalizedSheetName) && (rule.taskType.includes('banner') || rule.taskType.includes('large'))) {
    contextualBonus += 70;
  }

  const score = sheetKeywordScore + searchKeywordScore + contextualBonus;
  return score > 0 ? score : -1;
};

const estimateAdaptiveLayoutVariant = (task: TaskVisualSource, searchText: string): 'short' | 'medium' | 'long' => {
  if (matchesTaskVisualKeywords(searchText, ['详情长图', '长图模块', '长模块', '品牌故事', '使用步骤', '步骤说明', '安装步骤'])) {
    return 'long';
  }
  if (matchesTaskVisualKeywords(searchText, ['详情短图', '短模块', '短图', '单卖点'])) {
    return 'short';
  }

  const textLength = normalizeCellText(task.requirementZh).length
    + Math.round(normalizeCellText(task.referenceText).length * 0.6)
    + task.textLayers.map((value) => normalizeCellText(value).length).reduce((total, current) => total + current, 0)
    + task.textLayers.length * 10;

  let score = textLength;
  if (matchesTaskVisualKeywords(searchText, ['步骤', '对比', '说明', '品牌故事', '教程', '使用方法', '安装'])) score += 35;
  if (matchesTaskVisualKeywords(searchText, ['参数', '规格', '多卖点', '模块'])) score += 20;
  if (matchesTaskVisualKeywords(searchText, ['主图', '海报', '横幅'])) score -= 10;

  if (score >= 110) return 'long';
  if (score >= 48) return 'medium';
  return 'short';
};

const selectTaskVisualRule = (
  searchText: string,
  platform: TaskVisualSpec['platform'],
  sourceSheetName = ''
) => {
  const scopedRules = [
    ...(platform === 'amazon' ? AMAZON_TASK_VISUAL_RULES : []),
    ...(platform === 'taobao' ? TAOBAO_TASK_VISUAL_RULES : []),
    ...GENERIC_TASK_VISUAL_RULES
  ];

  const rankedRules = scopedRules
    .map((rule) => ({
      rule,
      score: scoreTaskVisualRule(rule, searchText, sourceSheetName)
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score);

  return rankedRules[0]?.rule;
};

const resolveTaskVisualSpec = (task: TaskVisualSource): TaskVisualSpec => {
  if (hasMeaningfulTaskVisualSpec(task.visualSpec)) {
    return task.visualSpec!;
  }

  const texts = collectTaskVisualTexts(task);
  const searchText = texts.join('\n').toLowerCase();
  const projectTemplateSpec = resolveAmazonProjectTemplateSpec(task, searchText);
  if (projectTemplateSpec) {
    return projectTemplateSpec;
  }
  const sourceSheetName = normalizeCellText(task.source?.sheetName);
  const platform = detectTaskPlatform(searchText, sourceSheetName);
  const matchedRule = selectTaskVisualRule(searchText, platform, sourceSheetName);
  const directAspectRatio = detectDirectTaskAspectRatio(texts);

  if (directAspectRatio) {
    return {
      platform,
      taskType: matchedRule?.taskType,
      layoutMode: 'fixed',
      layoutVariant: 'fixed',
      targetAspectRatio: directAspectRatio,
      targetImageSize: matchedRule?.imageSize,
      matchedRule: matchedRule?.ruleName || 'direct_ratio'
    };
  }

  if (!matchedRule) {
    return { platform };
  }

  if (matchedRule.layoutMode === 'adaptive') {
    const layoutVariant = estimateAdaptiveLayoutVariant(task, searchText);
    return {
      platform,
      taskType: matchedRule.taskType,
      layoutMode: 'adaptive',
      layoutVariant,
      targetAspectRatio: matchedRule.adaptiveRatios[layoutVariant],
      targetImageSize: matchedRule.imageSize,
      matchedRule: matchedRule.ruleName
    };
  }

  return {
    platform,
    taskType: matchedRule.taskType,
    layoutMode: 'fixed',
    layoutVariant: 'fixed',
    targetAspectRatio: matchedRule.aspectRatio,
    targetImageSize: matchedRule.imageSize,
    matchedRule: matchedRule.ruleName
  };
};

const withResolvedTaskVisualSpec = <T extends TaskVisualSource>(task: T): T => {
  const visualSpec = resolveTaskVisualSpec(task);
  if (!hasMeaningfulTaskVisualSpec(visualSpec)) {
    return task;
  }
  return {
    ...task,
    visualSpec
  };
};

const applyTaskVisualSpecToImageConfig = (
  baseConfig: Record<string, any>,
  visualSpec?: TaskVisualSpec,
  provider?: Partial<APIProvider> | null
) => {
  if (!visualSpec || !hasMeaningfulTaskVisualSpec(visualSpec)) {
    return { ...baseConfig };
  }

  const nextConfig = { ...baseConfig };
  const capabilities = getModelCapabilities(nextConfig.modelId, 'image', provider);

  if (
    visualSpec.targetAspectRatio
    && (!capabilities.allowedAspectRatios || capabilities.allowedAspectRatios.includes(visualSpec.targetAspectRatio))
  ) {
    nextConfig.aspectRatio = visualSpec.targetAspectRatio;
  }

  if (
    visualSpec.targetImageSize
    && capabilities.supportsImageSize !== false
    && (!capabilities.allowedImageSizes?.length || capabilities.allowedImageSizes.includes(visualSpec.targetImageSize))
  ) {
    nextConfig.imageSize = visualSpec.targetImageSize;
  }

  return nextConfig;
};

const buildTaskSelectionPrompt = (task: SpreadsheetParseTask) => {
  const parts = [
    task.requirementZh,
    task.referenceText ? `\u53c2\u8003\u8bf4\u660e\uff1a${task.referenceText}` : '',
    task.textLayers.length > 0 ? `\u753b\u9762\u6587\u5b57\uff1a${task.textLayers.join(' / ')}` : ''
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join('\n');
  }

  const serialNo = normalizeCellText(task.serialNo);
  const size = normalizeCellText(task.size);
  const fallbackValues = Object.entries(task.rawRow || {})
    .sort((left, right) => columnRefToIndex(left[0]) - columnRefToIndex(right[0]))
    .map(([, value]) => normalizeCellText(value))
    .filter((value, index, list) => value
      && value !== serialNo
      && value !== size
      && list.indexOf(value) === index);

  return fallbackValues.join('\n');
};

const sanitizeTaskForSelection = (task: SpreadsheetParseTask): TaskSelectionTask => {
  const resolvedTask = withResolvedTaskVisualSpec(task);
  return {
    taskId: resolvedTask.taskId,
    rowNumber: resolvedTask.rowNumber,
    serialNo: resolvedTask.serialNo,
    sheetTaskIndex: resolvedTask.sheetTaskIndex,
    size: resolvedTask.size,
    requirementZh: resolvedTask.requirementZh,
    referenceText: resolvedTask.referenceText,
    textLayers: [...resolvedTask.textLayers],
    referenceImageCount: resolvedTask.referenceImages.length,
    embeddedImageCount: resolvedTask.embeddedImages.length,
    source: { ...resolvedTask.source },
    rawRow: { ...resolvedTask.rawRow },
    visualSpec: resolvedTask.visualSpec
  };
};

const getSpreadsheetTasksFromInput = (input: unknown): SpreadsheetParseTask[] => {
  if (Array.isArray(input)) {
    return input.filter((item): item is SpreadsheetParseTask => !!item && typeof item === 'object' && 'taskId' in item);
  }

  if (input && typeof input === 'object' && Array.isArray((input as SpreadsheetParseOutput).tasks)) {
    return (input as SpreadsheetParseOutput).tasks;
  }

  return [];
};

const buildTaskSelectionOutput = (input: unknown, config?: Record<string, any>) => {
  const tasks = getSpreadsheetTasksFromInput(input);
  if (tasks.length === 0) {
    throw new Error('请先连接并运行表格解析节点');
  }

  const requestedIndex = Math.max(1, Number(config?.taskIndex || DEFAULT_TASK_SELECT_CONFIG.taskIndex));
  const selectedIndex = Math.min(requestedIndex, tasks.length);
  const selectedTask = withResolvedTaskVisualSpec(tasks[selectedIndex - 1]);
  const prompt = buildTaskSelectionPrompt(selectedTask);

  if (!prompt.trim()) {
    throw new Error('当前任务没有可用于出图的提示词内容');
  }

  const output: TaskSelectionOutput = {
    prompt,
    selectedIndex,
    totalTasks: tasks.length,
    task: sanitizeTaskForSelection(selectedTask)
  };

  return {
    output,
    meta: {
      rawPrompt: prompt,
      optimizedPrompt: prompt,
      forwardedImages: selectedTask.referenceImages,
      selectedTaskId: selectedTask.taskId,
      selectedIndex,
      visualSpec: selectedTask.visualSpec,
      targetAspectRatio: selectedTask.visualSpec?.targetAspectRatio,
      targetImageSize: selectedTask.visualSpec?.targetImageSize
    }
  };
};

type MatchableImageInput = string | StandardFilePayload;

type ProductImageMatchSelection = {
  selectedIndexes: number[];
  shortlistedIndexes?: number[];
  reason: string;
  confidence?: number;
};

const PRODUCT_IMAGE_MATCH_SYSTEM_INSTRUCTION = [
  '你是电商工作流中的产品图筛选助手。',
  '你的唯一任务是根据当前出图需求，从随后提供的多张产品图中选出最适合本次生成的图片。',
  '必须优先保证主体一致、用途一致、场景一致、配件一致。',
  '如果任务是白底主图，优先完整主体、背景干净的图片；如果任务强调细节或配件，优先对应特写；如果任务强调场景，优先场景图。',
  '宁可少选，也不要为了凑数量误选。',
  '只返回严格 JSON，不要 markdown，不要额外解释。'
].join('\n');

const isStandardFilePayload = (value: unknown): value is StandardFilePayload => (
  !!value
  && typeof value === 'object'
  && 'id' in value
  && 'type' in value
  && 'source' in value
);

const normalizeProductImageCandidates = (value: unknown): MatchableImageInput[] => {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeProductImageCandidates);
  }

  if (!value) {
    return [];
  }

  if (typeof value === 'string') {
    return value.trim() ? [value] : [];
  }

  if (isStandardFilePayload(value)) {
    return value.type === 'image' ? [value] : [];
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.image)) return normalizeProductImageCandidates(record.image);
    if (Array.isArray(record.images)) return normalizeProductImageCandidates(record.images);
    if (Array.isArray(record.selectedImages)) return normalizeProductImageCandidates(record.selectedImages);
    if (Array.isArray(record.referenceImages)) return normalizeProductImageCandidates(record.referenceImages);
    if (Array.isArray(record.embeddedImages)) return normalizeProductImageCandidates(record.embeddedImages);
  }

  return [];
};

const extractTaskSelectionLike = (value: unknown): TaskSelectionTask | null => {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  if (record.task && typeof record.task === 'object') {
    return extractTaskSelectionLike(record.task);
  }

  if (!('requirementZh' in record)) {
    return null;
  }

  return {
    taskId: String(record.taskId || ''),
    rowNumber: Number(record.rowNumber || 0),
    serialNo: String(record.serialNo || ''),
    sheetTaskIndex: typeof record.sheetTaskIndex === 'number' ? record.sheetTaskIndex : undefined,
    size: String(record.size || ''),
    requirementZh: String(record.requirementZh || ''),
    referenceText: typeof record.referenceText === 'string' ? record.referenceText : undefined,
    textLayers: Array.isArray(record.textLayers)
      ? record.textLayers.map((item) => String(item || '')).filter(Boolean)
      : [],
    referenceImageCount: Array.isArray(record.referenceImages)
      ? record.referenceImages.length
      : Number(record.referenceImageCount || 0),
    embeddedImageCount: Array.isArray(record.embeddedImages)
      ? record.embeddedImages.length
      : Number(record.embeddedImageCount || 0),
    source: {
      sheetName: String((record.source as Record<string, unknown> | undefined)?.sheetName || ''),
      rowNumber: Number((record.source as Record<string, unknown> | undefined)?.rowNumber || 0)
    },
    rawRow: typeof record.rawRow === 'object' && record.rawRow
      ? { ...(record.rawRow as Record<string, string>) }
      : {},
    visualSpec: typeof record.visualSpec === 'object' && record.visualSpec
      ? (record.visualSpec as TaskVisualSpec)
      : undefined
  };
};

const buildProductImageMatchTaskSummary = (task: TaskSelectionTask | null) => {
  if (!task) return '';

  const lines = [
    task.serialNo ? `任务编号：${task.serialNo}` : '',
    task.source.sheetName ? `工作表：${task.source.sheetName}` : '',
    task.visualSpec?.targetAspectRatio || task.size ? `目标尺寸：${task.visualSpec?.targetAspectRatio || task.size}` : '',
    task.requirementZh ? `中文需求：${task.requirementZh}` : '',
    task.referenceText ? `补充说明：${task.referenceText}` : '',
    task.textLayers.length > 0 ? `图中文字：${task.textLayers.join(' / ')}` : ''
  ].filter(Boolean);

  return lines.join('\n');
};

const splitStyleGuideList = (value: unknown) => normalizeCellText(value)
  .split(/[\n,，;；、]/)
  .map((item) => item.trim())
  .filter(Boolean);

const buildStyleGuideTaskSummary = (task: TaskSelectionTask | null) => {
  if (!task) return '';

  return [
    task.serialNo ? `任务编号：${task.serialNo}` : '',
    task.source.sheetName ? `工作表：${task.source.sheetName}` : '',
    task.visualSpec?.targetAspectRatio || task.size ? `目标尺寸：${task.visualSpec?.targetAspectRatio || task.size}` : '',
    task.requirementZh ? `任务需求：${task.requirementZh}` : '',
    task.referenceText ? `补充说明：${task.referenceText}` : '',
    task.textLayers.length > 0 ? `图中文字：${task.textLayers.join(' / ')}` : ''
  ].filter(Boolean).join('\n');
};

const buildStyleGuideOutput = (params: {
  config?: Record<string, any>;
  inputs: Record<string, any>;
}) => {
  const task = extractTaskSelectionLike(
    params.inputs.task
    ?? params.config?.batchTask
    ?? params.config?.task
    ?? params.inputs.default
  );
  const referenceImages = normalizeProductImageCandidates(params.inputs.image);
  const styleName = normalizeCellText(params.config?.styleName || DEFAULT_STYLE_GUIDE_CONFIG.styleName);
  const tone = normalizeCellText(params.config?.tone || DEFAULT_STYLE_GUIDE_CONFIG.tone);
  const palette = splitStyleGuideList(params.config?.palette || DEFAULT_STYLE_GUIDE_CONFIG.palette);
  const lighting = normalizeCellText(params.config?.lighting || DEFAULT_STYLE_GUIDE_CONFIG.lighting);
  const background = normalizeCellText(params.config?.background || DEFAULT_STYLE_GUIDE_CONFIG.background);
  const composition = normalizeCellText(params.config?.composition || DEFAULT_STYLE_GUIDE_CONFIG.composition);
  const camera = normalizeCellText(params.config?.camera || DEFAULT_STYLE_GUIDE_CONFIG.camera);
  const material = normalizeCellText(params.config?.material || DEFAULT_STYLE_GUIDE_CONFIG.material);
  const qualityKeywords = splitStyleGuideList(params.config?.qualityKeywords || DEFAULT_STYLE_GUIDE_CONFIG.qualityKeywords);
  const consistencyRules = splitStyleGuideList(params.config?.consistencyRules || DEFAULT_STYLE_GUIDE_CONFIG.consistencyRules);
  const negativeRules = splitStyleGuideList(params.config?.negativeRules || DEFAULT_STYLE_GUIDE_CONFIG.negativeRules);
  const taskSummary = buildStyleGuideTaskSummary(task);

  const stylePrompt = [
    '【高优先级风格约束】',
    styleName ? `项目风格：${styleName}` : '',
    tone ? `整体调性：${tone}` : '',
    palette.length > 0 ? `配色方案：${palette.join('、')}` : '',
    lighting ? `光线要求：${lighting}` : '',
    background ? `背景环境：${background}` : '',
    composition ? `构图规则：${composition}` : '',
    camera ? `镜头语言：${camera}` : '',
    material ? `材质表现：${material}` : '',
    qualityKeywords.length > 0 ? `质量要求：${qualityKeywords.join('、')}` : '',
    consistencyRules.length > 0 ? `整套图连贯规则：${consistencyRules.join('；')}` : '',
    negativeRules.length > 0 ? `负面约束：${negativeRules.join('；')}` : '',
    taskSummary ? `当前任务适配信息：\n${taskSummary}` : '',
    referenceImages.length > 0 ? `已接入 ${referenceImages.length} 张风格参考图，仅用于统一色彩、光线、构图与整体氛围。` : '',
    '要求：在不改变产品主体真实性的前提下，保持整套图片在配色、光线、材质、构图和商业质感上的统一。'
  ].filter(Boolean).join('\n\n');

  const negativePrompt = negativeRules.length > 0
    ? negativeRules.join('；')
    : '避免产品变形；避免背景杂乱；避免无关元素；避免风格漂移';
  const summary = [
    styleName || '未命名风格',
    tone || '',
    palette.length > 0 ? `配色：${palette.join(' / ')}` : '',
    consistencyRules.length > 0 ? `连贯：${consistencyRules.slice(0, 2).join(' / ')}` : ''
  ].filter(Boolean).join('｜');

  const output: StyleGuideOutput = {
    prompt: stylePrompt,
    stylePrompt,
    negativePrompt,
    summary,
    styleName,
    taskSummary,
    referenceImageCount: referenceImages.length,
    styleSpec: {
      tone,
      palette,
      lighting,
      background,
      composition,
      camera,
      material,
      qualityKeywords,
      consistencyRules,
      negativeRules
    }
  };

  return {
    output,
    meta: {
      rawPrompt: stylePrompt,
      optimizedPrompt: stylePrompt,
      negativePrompt,
      task,
      batchTask: task,
      stylePrompt,
      forwardedImages: referenceImages,
      referenceImageCount: referenceImages.length
    }
  };
};

const extractStyleGuideLike = (value: unknown): StyleGuideOutput | null => {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  if (record.stylePrompt || record.summary || record.prompt) {
    return {
      prompt: String(record.prompt || record.stylePrompt || ''),
      stylePrompt: String(record.stylePrompt || record.prompt || ''),
      negativePrompt: String(record.negativePrompt || ''),
      summary: String(record.summary || ''),
      styleName: String(record.styleName || ''),
      taskSummary: typeof record.taskSummary === 'string' ? record.taskSummary : undefined,
      referenceImageCount: Number(record.referenceImageCount || 0),
      styleSpec: typeof record.styleSpec === 'object' && record.styleSpec
        ? record.styleSpec as StyleGuideOutput['styleSpec']
        : {
          tone: '',
          palette: [],
          lighting: '',
          background: '',
          composition: '',
          camera: '',
          material: '',
          qualityKeywords: [],
          consistencyRules: [],
          negativeRules: []
        }
    };
  }

  return null;
};

const buildProductImageMatchRequestPrompt = (params: {
  promptText: string;
  taskSummary: string;
  maxSelections: number;
  totalImages: number;
  matchNotes?: string;
}) => {
  const sections = [
    `当前共有 ${params.totalImages} 张候选产品图，图片顺序就是索引顺序（从 1 开始）。`,
    `请选出最适合本次出图任务的 1-${params.maxSelections} 张图，并按相关度从高到低返回。`,
    '判断优先级：主体一致 > 场景一致 > 构图/角度一致 > 配件/细节一致。',
    '如果任务强调主图/白底图，优先主体完整且背景干净；如果强调卖点细节或配件，优先特写；如果强调生活方式或氛围，优先场景图。',
    '如果不确定，宁可少选不要乱选。',
    params.taskSummary ? `任务信息：\n${params.taskSummary}` : '',
    params.promptText ? `补充提示词：\n${params.promptText}` : '',
    params.matchNotes ? `附加筛选要求：\n${params.matchNotes}` : '',
    '请严格输出以下 JSON：{"selectedIndexes":[1,2],"reason":"简短说明为什么选这些图","confidence":0.92}',
    '要求：selectedIndexes 必须是 1-based 序号；不要输出 markdown；不要输出额外说明。'
  ].filter(Boolean);

  return sections.join('\n\n');
};

const extractJsonCandidate = (rawText: string) => {
  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return rawText.slice(firstBrace, lastBrace + 1);
  }

  return rawText.trim();
};

const normalizeSelectionIndexes = (rawIndexes: unknown, totalImages: number, maxSelections: number) => {
  const indexes = Array.isArray(rawIndexes)
    ? rawIndexes
      .map((value) => {
        const numeric = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
        return Number.isFinite(numeric) ? Math.round(numeric) : NaN;
      })
      .filter((value) => Number.isFinite(value))
    : [];

  let normalized = indexes;
  if (
    normalized.length > 0
    && normalized.some((index) => index === 0)
    && normalized.every((index) => index >= 0 && index < totalImages)
  ) {
    normalized = normalized.map((index) => index + 1);
  }

  return Array.from(new Set(
    normalized.filter((index) => index >= 1 && index <= totalImages)
  )).slice(0, Math.max(1, maxSelections));
};

const parseProductImageMatchResponse = (rawText: string, totalImages: number, maxSelections: number): ProductImageMatchSelection => {
  const candidate = extractJsonCandidate(rawText);

  try {
    const parsed = JSON.parse(candidate);
    const selectedIndexes = normalizeSelectionIndexes(
      parsed?.selectedIndexes ?? parsed?.indexes ?? parsed?.selected ?? parsed?.bestIndexes,
      totalImages,
      maxSelections
    );

    if (selectedIndexes.length > 0) {
      return {
        selectedIndexes,
        reason: String(parsed?.reason || parsed?.note || parsed?.explanation || '').trim() || `已筛选 ${selectedIndexes.length} 张产品图`,
        confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed?.confidence) : undefined
      };
    }
  } catch {
    // fall through to regex fallback
  }

  const bracketMatch = rawText.match(/\[[\s\d,，、]+\]/);
  const fallbackIndexes = normalizeSelectionIndexes(
    bracketMatch ? bracketMatch[0].split(/[\[\],，、\s]+/).filter(Boolean) : [],
    totalImages,
    maxSelections
  );

  if (fallbackIndexes.length === 0) {
    throw new Error('产品图筛选结果无法解析，请重试或补充更明确的筛选说明');
  }

  return {
    selectedIndexes: fallbackIndexes,
    reason: '模型已返回近似结果，已按识别到的序号完成筛选'
  };
};

const executeProductImageMatch = async (params: {
  nodeId: string;
  config?: Record<string, any>;
  inputs: Record<string, any>;
  service: AIService;
  apiSettings?: ReturnType<typeof buildApiSettings>;
  fallbackModelId?: string;
  onProgress?: (progress: number) => void;
}) => {
  return executeProductImageMatchV2(params);
};

const PRODUCT_IMAGE_ANALYSIS_SYSTEM_INSTRUCTION_V2 = [
  '你是电商产品图理解引擎。',
  '你的职责是客观描述单张产品图片里到底有什么，不做主观想象，不输出营销文案。',
  '请提取主体、场景、背景、角度、构图、可见部件、适合的任务类型、明显文字、质量备注。',
  '必须使用中文返回严格 JSON，不要 markdown，不要额外解释。'
].join('\n');

const PRODUCT_IMAGE_MATCH_REASONING_SYSTEM_INSTRUCTION_V2 = [
  '你是电商工作流中的产品图匹配助手。',
  '你会收到任务描述，以及每张候选产品图的结构化分析结果。',
  '请基于主体一致、用途一致、场景一致、配件一致、构图一致来挑选最适合的图片。',
  '你只能根据给定分析结果决策，不要编造额外信息。',
  '必须返回严格 JSON，不要 markdown，不要额外解释。'
].join('\n');

const PRODUCT_IMAGE_MATCH_VERIFICATION_SYSTEM_INSTRUCTION_V2 = [
  '你是电商工作流中的产品图最终复核助手。',
  '你会收到任务描述、候选图索引说明和真实图片。',
  '请根据真实图片内容对入围候选再次复核，选出最终最合适的图片。',
  '必须返回严格 JSON，不要 markdown，不要额外解释。'
].join('\n');

const getMatchableImageSignatureV2 = (value: MatchableImageInput) => {
  if (typeof value === 'string') {
    return `str:${value.length}:${value.slice(0, 48)}:${value.slice(-48)}`;
  }

  return [
    'file',
    value.id,
    value.name,
    value.size,
    value.mime,
    value.createdAt,
    typeof value.url === 'string' ? value.url.slice(0, 120) : ''
  ].join(':');
};

const buildProductImageAnalysisCacheKeyV2 = (params: {
  modelId: string;
  baseUrl: string;
  images: MatchableImageInput[];
}) => [
  PRODUCT_IMAGE_ANALYSIS_CACHE_VERSION,
  params.baseUrl,
  params.modelId,
  ...params.images.map(getMatchableImageSignatureV2)
].join('|');

const buildProductImageCandidateAnalysisPromptV2 = (index: number, total: number) => [
  `这是候选产品图中的第 ${index} 张，共 ${total} 张。`,
  '请客观分析这张图，并返回严格 JSON：',
  '{"summaryZh":"","primaryCategory":"","subject":"","scene":"","background":"","angle":"","composition":"","visibleParts":[],"suitableTaskKinds":[],"tags":[],"textVisible":[],"qualityNotes":"","confidence":0.9}',
  '字段要求：',
  '- summaryZh：一句中文摘要',
  '- primaryCategory：如 白底主图 / 场景图 / 细节特写 / 配件图 / 品牌横幅 / 说明图',
  '- subject：主体商品或主体部件',
  '- scene：场景或使用环境，没有就写空字符串',
  '- background：背景类型，如 白底 / 厨房 / 浴室 / 纯色 / 户外',
  '- angle：角度，如 正视 / 俯视 / 侧视 / 特写',
  '- composition：构图，如 单主体居中 / 多配件平铺 / 人手持产品',
  '- visibleParts：可见配件、卖点部件',
  '- suitableTaskKinds：适合的任务类型，如 主图 / 副图 / 场景图 / 配件图 / 细节图 / 横幅背景 / 品牌故事',
  '- tags：简短关键词',
  '- textVisible：画面中清晰可见的文字，没有则 []',
  '- qualityNotes：如 遮挡 / 裁切 / 分辨率一般 / 主体不完整',
  '- confidence：0~1'
].join('\n');

const createFallbackCandidateAnalysisV2 = (index: number, rawText?: string): ProductImageCandidateAnalysis => ({
  index,
  summaryZh: rawText?.trim().slice(0, 120) || `候选图 ${index}`,
  primaryCategory: '',
  subject: '',
  scene: '',
  background: '',
  angle: '',
  composition: '',
  visibleParts: [],
  suitableTaskKinds: [],
  tags: [],
  textVisible: [],
  qualityNotes: '',
  confidence: undefined
});

const parseProductImageCandidateAnalysisResponseV2 = (rawText: string, index: number): ProductImageCandidateAnalysis => {
  const candidate = extractJsonCandidate(rawText);

  try {
    const parsed = JSON.parse(candidate);
    return {
      index,
      summaryZh: String(parsed?.summaryZh || parsed?.summary || '').trim() || `候选图 ${index}`,
      primaryCategory: String(parsed?.primaryCategory || parsed?.category || '').trim(),
      subject: String(parsed?.subject || '').trim(),
      scene: String(parsed?.scene || '').trim(),
      background: String(parsed?.background || '').trim(),
      angle: String(parsed?.angle || '').trim(),
      composition: String(parsed?.composition || '').trim(),
      visibleParts: Array.isArray(parsed?.visibleParts) ? parsed.visibleParts.map((item: unknown) => String(item || '').trim()).filter(Boolean) : [],
      suitableTaskKinds: Array.isArray(parsed?.suitableTaskKinds) ? parsed.suitableTaskKinds.map((item: unknown) => String(item || '').trim()).filter(Boolean) : [],
      tags: Array.isArray(parsed?.tags) ? parsed.tags.map((item: unknown) => String(item || '').trim()).filter(Boolean) : [],
      textVisible: Array.isArray(parsed?.textVisible) ? parsed.textVisible.map((item: unknown) => String(item || '').trim()).filter(Boolean) : [],
      qualityNotes: String(parsed?.qualityNotes || parsed?.notes || '').trim(),
      confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : undefined
    };
  } catch {
    return createFallbackCandidateAnalysisV2(index, rawText);
  }
};

const mapWithConcurrencyV2 = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) => {
  if (items.length === 0) return [] as R[];

  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));

  return results;
};

const analyzeSingleProductImageCandidateV2 = async (params: {
  nodeId: string;
  image: MatchableImageInput;
  imageIndex: number;
  totalImages: number;
  service: AIService;
  apiSettings: { apiKey: string; baseUrl: string };
  modelId: string;
}) => {
  const inputs = await resolvePayloadBeforeApi({
    prompt: buildProductImageCandidateAnalysisPromptV2(params.imageIndex, params.totalImages),
    image: [params.image]
  });
  const response = await params.service.executeNode(
    `${params.nodeId}:candidate:${params.imageIndex}`,
    NodeType.AI_CHAT,
    {
      modelId: params.modelId,
      systemInstruction: PRODUCT_IMAGE_ANALYSIS_SYSTEM_INSTRUCTION_V2
    },
    inputs,
    params.apiSettings
  );

  return parseProductImageCandidateAnalysisResponseV2(String(response?.output || ''), params.imageIndex);
};

const getProductImageCandidateAnalysesV2 = async (params: {
  nodeId: string;
  images: MatchableImageInput[];
  service: AIService;
  apiSettings: { apiKey: string; baseUrl: string };
  modelId: string;
  onProgress?: (progress: number) => void;
}) => {
  const cacheKey = buildProductImageAnalysisCacheKeyV2({
    modelId: params.modelId,
    baseUrl: params.apiSettings.baseUrl,
    images: params.images
  });
  const cached = productImageAnalysisCache.get(cacheKey);
  if (cached && cached.length === params.images.length) {
    params.onProgress?.(56);
    return {
      analyses: cached,
      cacheKey,
      fromCache: true
    };
  }

  let completed = 0;
  const analyses = await mapWithConcurrencyV2(params.images, 2, async (image, index) => {
    const analysis = await analyzeSingleProductImageCandidateV2({
      nodeId: params.nodeId,
      image,
      imageIndex: index + 1,
      totalImages: params.images.length,
      service: params.service,
      apiSettings: params.apiSettings,
      modelId: params.modelId
    });
    completed += 1;
    const progress = 10 + Math.round((completed / params.images.length) * 46);
    params.onProgress?.(Math.max(10, Math.min(56, progress)));
    return analysis;
  });

  productImageAnalysisCache.set(cacheKey, analyses);
  return {
    analyses,
    cacheKey,
    fromCache: false
  };
};

const buildProductImageSelectionPromptV2 = (params: {
  promptText: string;
  taskSummary: string;
  maxSelections: number;
  candidateAnalyses: ProductImageCandidateAnalysis[];
  matchNotes?: string;
}) => {
  const analysisLines = params.candidateAnalyses.map((analysis) => JSON.stringify({
    index: analysis.index,
    summaryZh: analysis.summaryZh,
    primaryCategory: analysis.primaryCategory,
    subject: analysis.subject,
    scene: analysis.scene,
    background: analysis.background,
    angle: analysis.angle,
    composition: analysis.composition,
    visibleParts: analysis.visibleParts,
    suitableTaskKinds: analysis.suitableTaskKinds,
    tags: analysis.tags,
    textVisible: analysis.textVisible,
    qualityNotes: analysis.qualityNotes,
    confidence: analysis.confidence
  }));

  const sections = [
    `共有 ${params.candidateAnalyses.length} 张候选产品图，下面提供的是每张图的结构化分析结果。`,
    `请挑选最适合本次出图任务的 1-${params.maxSelections} 张图，并按相关度从高到低排序。`,
    '判断优先级：主体一致 > 任务类型一致 > 配件/部件一致 > 场景一致 > 构图角度一致 > 背景一致。',
    '如果任务是主图/白底图，优先主体完整、背景干净、无杂乱元素的图片。',
    '如果任务强调卖点细节或配件，优先对应部件特写或配件图。',
    '如果任务强调生活方式、故事感、场景感，优先场景图或横幅图。',
    '如果不确定，宁可少选，不要凑数。',
    params.taskSummary ? `任务信息：\n${params.taskSummary}` : '',
    params.promptText ? `补充提示词：\n${params.promptText}` : '',
    params.matchNotes ? `附加筛选要求：\n${params.matchNotes}` : '',
    `候选图分析：\n${analysisLines.join('\n')}`,
    '请严格输出以下 JSON：{"selectedIndexes":[1,2],"shortlistedIndexes":[1,2,5],"reason":"简短说明为什么选这些图","confidence":0.92}',
    '要求：selectedIndexes 和 shortlistedIndexes 都必须使用原始候选图的 1-based 序号；不要输出 markdown；不要输出额外说明。'
  ].filter(Boolean);

  return sections.join('\n\n');
};

const normalizeSelectionIndexesByAllowedV2 = (rawIndexes: unknown, allowedIndexes: number[], maxSelections: number) => {
  const baseIndexes = Array.isArray(rawIndexes)
    ? rawIndexes
      .map((value) => {
        const numeric = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
        return Number.isFinite(numeric) ? Math.round(numeric) : NaN;
      })
      .filter((value) => Number.isFinite(value))
    : [];

  if (baseIndexes.length === 0) return [];

  const allowedSet = new Set(allowedIndexes);
  const direct = Array.from(new Set(baseIndexes.filter((index) => allowedSet.has(index))));
  if (direct.length > 0) {
    return direct.slice(0, Math.max(1, maxSelections));
  }

  let localIndexes = baseIndexes;
  if (
    localIndexes.some((index) => index === 0)
    && localIndexes.every((index) => index >= 0 && index < allowedIndexes.length)
  ) {
    localIndexes = localIndexes.map((index) => index + 1);
  }

  const mapped = Array.from(new Set(
    localIndexes
      .filter((index) => index >= 1 && index <= allowedIndexes.length)
      .map((index) => allowedIndexes[index - 1])
      .filter((index) => allowedSet.has(index))
  ));

  return mapped.slice(0, Math.max(1, maxSelections));
};

const parseProductImageMatchResponseV2 = (
  rawText: string,
  totalImages: number,
  maxSelections: number,
  allowedIndexes?: number[]
): ProductImageMatchSelection => {
  const candidate = extractJsonCandidate(rawText);
  const allowed = allowedIndexes && allowedIndexes.length > 0
    ? Array.from(new Set(allowedIndexes))
    : Array.from({ length: totalImages }, (_, index) => index + 1);

  try {
    const parsed = JSON.parse(candidate);
    const selectedIndexes = allowedIndexes
      ? normalizeSelectionIndexesByAllowedV2(
        parsed?.selectedIndexes ?? parsed?.indexes ?? parsed?.selected ?? parsed?.bestIndexes,
        allowed,
        maxSelections
      )
      : normalizeSelectionIndexes(
        parsed?.selectedIndexes ?? parsed?.indexes ?? parsed?.selected ?? parsed?.bestIndexes,
        totalImages,
        maxSelections
      );
    const shortlistedIndexes = allowedIndexes
      ? normalizeSelectionIndexesByAllowedV2(
        parsed?.shortlistedIndexes ?? parsed?.candidateIndexes ?? parsed?.topIndexes ?? selectedIndexes,
        allowed,
        Math.max(maxSelections + 2, maxSelections)
      )
      : normalizeSelectionIndexes(
        parsed?.shortlistedIndexes ?? parsed?.candidateIndexes ?? parsed?.topIndexes ?? selectedIndexes,
        totalImages,
        Math.max(maxSelections + 2, maxSelections)
      );

    if (selectedIndexes.length > 0) {
      return {
        selectedIndexes,
        shortlistedIndexes: shortlistedIndexes.length > 0 ? shortlistedIndexes : selectedIndexes,
        reason: String(parsed?.reason || parsed?.note || parsed?.explanation || '').trim() || `已筛选 ${selectedIndexes.length} 张产品图`,
        confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : undefined
      };
    }
  } catch {
    // fall through to regex fallback
  }

  const bracketMatch = rawText.match(/\[[\s\d,，、]+\]/);
  const bracketValues = bracketMatch ? bracketMatch[0].split(/[\[\],，、\s]+/).filter(Boolean) : [];
  const fallbackIndexes = allowedIndexes
    ? normalizeSelectionIndexesByAllowedV2(bracketValues, allowed, maxSelections)
    : normalizeSelectionIndexes(bracketValues, totalImages, maxSelections);

  if (fallbackIndexes.length === 0) {
    throw new Error('产品图筛选结果无法解析，请重试或补充更明确的筛选说明');
  }

  return {
    selectedIndexes: fallbackIndexes,
    shortlistedIndexes: fallbackIndexes,
    reason: '模型已返回近似结果，已按识别到的序号完成筛选'
  };
};

const buildProductImageVerificationPromptV2 = (params: {
  taskSummary: string;
  promptText: string;
  matchNotes?: string;
  candidateAnalyses: ProductImageCandidateAnalysis[];
  maxSelections: number;
}) => {
  const candidateText = params.candidateAnalyses.map((analysis, localIndex) => (
    `顺序 ${localIndex + 1} => 原始候选图 ${analysis.index}：${analysis.summaryZh}；类别=${analysis.primaryCategory || '未识别'}；主体=${analysis.subject || '未识别'}；场景=${analysis.scene || '无'}；标签=${analysis.tags.join('、') || '无'}`
  )).join('\n');

  return [
    `你将看到 ${params.candidateAnalyses.length} 张已经入围的候选图片，它们会按上面的“顺序 1、顺序 2...”依次发送。`,
    `请从中最终选出 1-${params.maxSelections} 张最适合本次任务的图片。`,
    '优先级仍然是：主体一致 > 任务类型一致 > 配件/部件一致 > 场景一致 > 构图角度一致。',
    params.taskSummary ? `任务信息：\n${params.taskSummary}` : '',
    params.promptText ? `补充提示词：\n${params.promptText}` : '',
    params.matchNotes ? `附加筛选要求：\n${params.matchNotes}` : '',
    `入围候选说明：\n${candidateText}`,
    '请严格输出 JSON：{"selectedIndexes":[3,5],"reason":"最终复核结论","confidence":0.95}',
    '注意：selectedIndexes 必须返回原始候选图序号，不要返回顺序号。'
  ].filter(Boolean).join('\n\n');
};

const executeProductImageMatchV2 = async (params: {
  nodeId: string;
  config?: Record<string, any>;
  inputs: Record<string, any>;
  service: AIService;
  apiSettings?: ReturnType<typeof buildApiSettings>;
  fallbackModelId?: string;
  onProgress?: (progress: number) => void;
}) => {
  const images = normalizeProductImageCandidates(params.inputs.image);
  if (images.length === 0) {
    throw new Error('请先连接多图上传节点或其他图片来源');
  }

  const maxSelections = Math.max(
    1,
    Math.min(6, Number(params.config?.maxSelections || DEFAULT_PRODUCT_IMAGE_MATCH_CONFIG.maxSelections))
  );
  const task = extractTaskSelectionLike(
    params.inputs.task
    ?? params.config?.batchTask
    ?? params.config?.task
    ?? params.inputs.default
  );
  const taskSummary = buildProductImageMatchTaskSummary(task);
  const promptText = normalizePromptText(params.inputs.prompt ?? params.config?.prompt ?? '');
  const matchNotes = normalizeCellText(params.config?.matchNotes || '');

  if (!taskSummary && !promptText) {
    throw new Error('请先连接任务选择或提示词工程节点，再进行产品图筛选');
  }

  if (images.length === 1) {
    const passthroughAnalysis = createFallbackCandidateAnalysisV2(1, '仅 1 张候选图，未进行筛选');
    const passthrough: ProductImageMatchOutput = {
      image: images,
      selectedImages: images,
      selectedIndexes: [1],
      selectedCount: 1,
      totalImages: 1,
      reason: '仅接入 1 张产品图，已直接透传',
      confidence: 1,
      taskSummary,
      candidateAnalyses: [passthroughAnalysis],
      selectedAnalyses: [passthroughAnalysis]
    };

    return {
      output: passthrough,
      meta: {
        forwardedImages: images,
        selectedIndexes: [1],
        shortlistedIndexes: [1],
        reason: passthrough.reason,
        confidence: 1,
        totalImages: 1,
        modelId: params.config?.modelId || params.fallbackModelId || '',
        candidateAnalyses: [passthroughAnalysis],
        selectedAnalyses: [passthroughAnalysis]
      }
    };
  }

  if (!params.apiSettings) {
    throw new Error('产品图筛选需要先配置对话模型的 API');
  }

  const modelId = params.config?.modelId || params.fallbackModelId || '';
  params.onProgress?.(8);

  const { analyses, cacheKey, fromCache } = await getProductImageCandidateAnalysesV2({
    nodeId: params.nodeId,
    images,
    service: params.service,
    apiSettings: params.apiSettings,
    modelId,
    onProgress: params.onProgress
  });

  const reasoningPrompt = buildProductImageSelectionPromptV2({
    promptText,
    taskSummary,
    maxSelections,
    candidateAnalyses: analyses,
    matchNotes
  });
  params.onProgress?.(64);
  const reasoningResponse = await params.service.executeNode(
    `${params.nodeId}:reasoning`,
    NodeType.AI_CHAT,
    {
      modelId,
      systemInstruction: PRODUCT_IMAGE_MATCH_REASONING_SYSTEM_INSTRUCTION_V2
    },
    { prompt: reasoningPrompt },
    params.apiSettings
  );
  const reasoningRawText = String(reasoningResponse?.output || '').trim();
  const reasoningSelection = parseProductImageMatchResponseV2(reasoningRawText, images.length, maxSelections);

  const shortlist = Array.from(new Set(
    (reasoningSelection.shortlistedIndexes && reasoningSelection.shortlistedIndexes.length > 0
      ? reasoningSelection.shortlistedIndexes
      : reasoningSelection.selectedIndexes
    ).filter((index) => index >= 1 && index <= images.length)
  )).slice(0, Math.max(maxSelections + 2, maxSelections));

  let finalSelection = reasoningSelection;
  let verificationRawText = '';
  if (shortlist.length > 1) {
    params.onProgress?.(76);
    const shortlistedAnalyses = shortlist
      .map((index) => analyses.find((analysis) => analysis.index === index))
      .filter((analysis): analysis is ProductImageCandidateAnalysis => Boolean(analysis));
    const shortlistedImages = shortlist
      .map((index) => images[index - 1])
      .filter((item): item is MatchableImageInput => item !== undefined);

    try {
      const verificationResponse = await params.service.executeNode(
        `${params.nodeId}:verify`,
        NodeType.AI_CHAT,
        {
          modelId,
          systemInstruction: PRODUCT_IMAGE_MATCH_VERIFICATION_SYSTEM_INSTRUCTION_V2
        },
        await resolvePayloadBeforeApi({
          prompt: buildProductImageVerificationPromptV2({
            taskSummary,
            promptText,
            matchNotes,
            candidateAnalyses: shortlistedAnalyses,
            maxSelections
          }),
          image: shortlistedImages
        }),
        params.apiSettings
      );
      verificationRawText = String(verificationResponse?.output || '').trim();
      const verifiedSelection = parseProductImageMatchResponseV2(
        verificationRawText,
        images.length,
        maxSelections,
        shortlist
      );

      if (verifiedSelection.selectedIndexes.length > 0) {
        finalSelection = {
          ...verifiedSelection,
          shortlistedIndexes: shortlist
        };
      }
    } catch {
      finalSelection = {
        ...reasoningSelection,
        shortlistedIndexes: shortlist
      };
    }
  }

  const selectedImages = finalSelection.selectedIndexes
    .map((index) => images[index - 1])
    .filter((item): item is MatchableImageInput => item !== undefined);

  if (selectedImages.length === 0) {
    throw new Error('产品图筛选未命中有效图片，请调整提示词或附加说明后重试');
  }

  const selectedAnalyses = finalSelection.selectedIndexes
    .map((index) => analyses.find((analysis) => analysis.index === index))
    .filter((analysis): analysis is ProductImageCandidateAnalysis => Boolean(analysis));

  const output: ProductImageMatchOutput = {
    image: selectedImages,
    selectedImages,
    selectedIndexes: finalSelection.selectedIndexes,
    selectedCount: selectedImages.length,
    totalImages: images.length,
    reason: finalSelection.reason,
    confidence: finalSelection.confidence,
    taskSummary,
    candidateAnalyses: analyses,
    selectedAnalyses
  };

  return {
    output,
    meta: {
      forwardedImages: selectedImages,
      selectedIndexes: finalSelection.selectedIndexes,
      shortlistedIndexes: finalSelection.shortlistedIndexes || finalSelection.selectedIndexes,
      reason: finalSelection.reason,
      confidence: finalSelection.confidence,
      totalImages: images.length,
      modelId,
      candidateAnalyses: analyses,
      selectedAnalyses,
      reasoningRawResponse: reasoningRawText,
      verificationRawResponse: verificationRawText,
      analysisCacheKey: cacheKey,
      analysisFromCache: fromCache
    }
  };
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getBatchItemsFromInput = (input: unknown): BatchExecutionItem[] => {
  if (input && typeof input === 'object' && Array.isArray((input as BatchExecutionOutput).items)) {
    return (input as BatchExecutionOutput).items;
  }
  return [];
};

const getMappedBatchItemFromEdge = (edge: Edge, sourceOutput: unknown) => {
  const edgeData = edge.data as Record<string, any> | undefined;
  if (!edgeData || (edgeData.kind !== 'batch-template' && edgeData.kind !== 'batch-mapping')) {
    return undefined;
  }

  const items = getBatchItemsFromInput(sourceOutput);
  if (items.length === 0) {
    return undefined;
  }

  if (typeof edgeData.batchId === 'string' && edgeData.batchId.trim()) {
    const matchedItem = items.find((item) => item.batchId === edgeData.batchId);
    if (matchedItem) {
      return matchedItem;
    }
  }

  if (typeof edgeData.selectedIndex === 'number') {
    const matchedItem = items.find((item) => item.selectedIndex === edgeData.selectedIndex);
    if (matchedItem) {
      return matchedItem;
    }
  }

  return undefined;
};

const resolveBatchEdgeMappedValue = (params: {
  sourceNode?: Node<NodeData>;
  edge: Edge;
  sourceOutput: unknown;
}) => {
  if (!params.sourceNode || params.sourceNode.type !== NodeType.BATCH_EXECUTE) {
    return params.sourceOutput;
  }

  const batchItem = getMappedBatchItemFromEdge(params.edge, params.sourceOutput);
  if (!batchItem) {
    return params.sourceOutput;
  }

  if (params.edge.targetHandle === 'task') {
    return batchItem.task;
  }
  if (params.edge.targetHandle === 'prompt') {
    return batchItem.prompt;
  }
  if (params.edge.targetHandle === 'image') {
    return batchItem.images;
  }
  if (params.edge.targetHandle === 'template') {
    return undefined;
  }

  return batchItem;
};

const AMAZON_A_PLUS_BATCH_VARIANTS: Array<{
  key: string;
  label: string;
  visualSpec: TaskVisualSpec;
}> = [
    {
      key: 'amazon_a_plus_large',
      label: 'A+大图',
      visualSpec: {
        platform: 'amazon',
        taskType: 'amazon_a_plus_large',
        layoutMode: 'fixed',
        layoutVariant: 'fixed',
        targetAspectRatio: '21:9',
        targetImageSize: '2K',
        matchedRule: 'amazon_batch_a_plus_large'
      }
    },
    {
      key: 'amazon_a_plus_small',
      label: 'A+小图',
      visualSpec: {
        platform: 'amazon',
        taskType: 'amazon_a_plus_small',
        layoutMode: 'fixed',
        layoutVariant: 'fixed',
        targetAspectRatio: '3:2',
        targetImageSize: '2K',
        matchedRule: 'amazon_batch_a_plus_small'
      }
    }
  ];

const shouldAutoExpandAmazonAPlusBatch = (task: SpreadsheetParseTask, allTasks: SpreadsheetParseTask[]) => {
  const sheetName = normalizeTaskSheetName(task.source?.sheetName);
  if (!isAmazonAPlusSheet(sheetName)) {
    return false;
  }

  const sameSheetTasks = allTasks.filter((item) => normalizeTaskSheetName(item.source?.sheetName) === sheetName);
  const explicitLargeCount = sameSheetTasks.filter((item) => {
    const searchText = collectTaskVisualTexts(item).join('\n').toLowerCase();
    return matchesTaskVisualKeywords(searchText, AMAZON_A_PLUS_LARGE_HINTS);
  }).length;
  const explicitSmallCount = sameSheetTasks.filter((item) => {
    const searchText = collectTaskVisualTexts(item).join('\n').toLowerCase();
    return matchesTaskVisualKeywords(searchText, AMAZON_A_PLUS_SMALL_HINTS);
  }).length;

  if (sameSheetTasks.length <= 6) {
    return true;
  }

  return explicitLargeCount === 0 || explicitSmallCount === 0;
};

const createBatchExecutionItemsForTask = (
  task: SpreadsheetParseTask,
  prompt: string,
  selectedIndex: number,
  allTasks: SpreadsheetParseTask[]
) => {
  const normalizedTask = withResolvedTaskVisualSpec(task);
  const sanitizedTask = sanitizeTaskForSelection(normalizedTask);
  const baseBatchId = `batch-${normalizedTask.taskId}-${selectedIndex}`;

  if (shouldAutoExpandAmazonAPlusBatch(normalizedTask, allTasks)) {
    return AMAZON_A_PLUS_BATCH_VARIANTS.map((variant) => ({
      batchId: `${baseBatchId}-${variant.key}`,
      selectedIndex,
      prompt,
      images: normalizedTask.referenceImages,
      task: {
        ...sanitizedTask,
        visualSpec: variant.visualSpec
      },
      visualSpec: variant.visualSpec,
      variantKey: variant.key,
      variantLabel: variant.label
    } satisfies BatchExecutionItem));
  }

  return [{
    batchId: baseBatchId,
    selectedIndex,
    prompt,
    images: normalizedTask.referenceImages,
    task: sanitizedTask,
    visualSpec: normalizedTask.visualSpec
  } satisfies BatchExecutionItem];
};

const buildBatchExecutionOutput = (input: unknown, config?: Record<string, any>) => {
  const tasks = getSpreadsheetTasksFromInput(input);
  if (tasks.length === 0) {
    throw new Error('请先连接并运行表格解析节点');
  }

  const startIndex = Math.max(1, Number(config?.startIndex || DEFAULT_BATCH_EXECUTE_CONFIG.startIndex));
  const requestedEndIndex = Math.max(0, Number(config?.endIndex || DEFAULT_BATCH_EXECUTE_CONFIG.endIndex));
  const endIndex = requestedEndIndex > 0 ? Math.min(requestedEndIndex, tasks.length) : tasks.length;
  const intervalMs = Math.max(0, Number(config?.intervalMs || DEFAULT_BATCH_EXECUTE_CONFIG.intervalMs));

  if (startIndex > endIndex) {
    throw new Error('开始序号不能大于结束序号');
  }

  const items: BatchExecutionItem[] = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    const task = tasks[index - 1] ? withResolvedTaskVisualSpec(tasks[index - 1]) : null;
    if (!task) continue;

    const prompt = buildTaskSelectionPrompt(task);
    items.push(...createBatchExecutionItemsForTask(task, prompt, index, tasks));
  }

  if (items.length === 0) {
    throw new Error('当前批量范围内没有可生成的任务');
  }

  const output: BatchExecutionOutput = {
    runId: `batch-${Date.now()}`,
    totalTasks: tasks.length,
    selectedCount: items.length,
    skippedCount: 0,
    startIndex,
    endIndex,
    intervalMs,
    items
  };

  return {
    output,
    meta: {
      batchMode: true,
      selectedCount: items.length,
      skippedCount: 0,
      intervalMs,
      startIndex,
      endIndex
    }
  };
};

const BATCH_EXPANDABLE_TEMPLATE_NODE_TYPES = new Set<NodeType>([
  NodeType.STYLE_GUIDE,
  NodeType.AI_CHAT,
  NodeType.PRODUCT_IMAGE_MATCH,
  NodeType.AI_IMAGE
]);

type BatchTemplateRoot = {
  edge: Edge;
  nodeId: string;
  targetHandle: string;
};

type BatchTemplateGraph = {
  nodes: Node<NodeData>[];
  roots: BatchTemplateRoot[];
  internalEdges: Edge[];
  externalInputEdges: Edge[];
  terminalNodeIds: string[];
};

const normalizeBatchTemplateTargetHandle = (
  node: Node<NodeData>,
  targetHandle?: string | null
) => {
  if (node.type === NodeType.AI_IMAGE) {
    return 'template';
  }
  if (node.type === NodeType.AI_CHAT) {
    return targetHandle || 'prompt';
  }
  if (node.type === NodeType.STYLE_GUIDE) {
    return targetHandle || 'task';
  }
  if (node.type === NodeType.PRODUCT_IMAGE_MATCH) {
    return targetHandle || 'task';
  }
  return targetHandle || 'default';
};

const getBatchTemplateGraph = (params: {
  batchNodeId: string;
  nodes: Node<NodeData>[];
  edges: Edge[];
}): BatchTemplateGraph => {
  const nodeMap = new Map(params.nodes.map((node) => [node.id, node]));
  const outgoingBySource = new Map<string, Edge[]>();

  params.edges.forEach((edge) => {
    if (!outgoingBySource.has(edge.source)) {
      outgoingBySource.set(edge.source, []);
    }
    outgoingBySource.get(edge.source)!.push(edge);
  });

  const roots = params.edges
    .filter((edge) => edge.source === params.batchNodeId && (edge.data as any)?.kind !== 'batch-mapping')
    .map((edge) => {
      const targetNode = nodeMap.get(edge.target);
      if (!targetNode || !BATCH_EXPANDABLE_TEMPLATE_NODE_TYPES.has(targetNode.type as NodeType)) {
        return null;
      }
      return {
        edge,
        nodeId: targetNode.id,
        targetHandle: normalizeBatchTemplateTargetHandle(targetNode, edge.targetHandle)
      } satisfies BatchTemplateRoot;
    })
    .filter((root): root is BatchTemplateRoot => Boolean(root));

  if (roots.length === 0) {
    return {
      nodes: [],
      roots: [],
      internalEdges: [],
      externalInputEdges: [],
      terminalNodeIds: []
    };
  }

  const visitedNodeIds = new Set<string>();
  const internalEdgeIds = new Set<string>();
  const internalEdges: Edge[] = [];
  const queue = roots.map((root) => root.nodeId);

  queue.forEach((nodeId) => visitedNodeIds.add(nodeId));

  while (queue.length > 0) {
    const currentNodeId = queue.shift()!;
    const outgoingEdges = outgoingBySource.get(currentNodeId) || [];

    outgoingEdges.forEach((edge) => {
      if ((edge.data as any)?.kind === 'batch-mapping') {
        return;
      }

      const targetNode = nodeMap.get(edge.target);
      if (!targetNode || !BATCH_EXPANDABLE_TEMPLATE_NODE_TYPES.has(targetNode.type as NodeType)) {
        return;
      }

      if (!internalEdgeIds.has(edge.id)) {
        internalEdgeIds.add(edge.id);
        internalEdges.push(edge);
      }

      if (!visitedNodeIds.has(targetNode.id)) {
        visitedNodeIds.add(targetNode.id);
        queue.push(targetNode.id);
      }
    });
  }

  const nodes = params.nodes.filter((node) => visitedNodeIds.has(node.id));
  const externalInputEdges = params.edges.filter((edge) => (
    edge.source !== params.batchNodeId
    && visitedNodeIds.has(edge.target)
    && !visitedNodeIds.has(edge.source)
  ));
  const terminalNodeIds = nodes
    .filter((node) => !internalEdges.some((edge) => edge.source === node.id && visitedNodeIds.has(edge.target)))
    .map((node) => node.id);

  return {
    nodes,
    roots,
    internalEdges,
    externalInputEdges,
    terminalNodeIds
  };
};

const getBatchTemplateNodes = (params: {
  batchNodeId: string;
  nodes: Node<NodeData>[];
  edges: Edge[];
}) => getBatchTemplateGraph(params).nodes;

const buildBatchExpansionSignature = (params: {
  batchOutput: BatchExecutionOutput;
  templateGraph: BatchTemplateGraph;
}) => JSON.stringify({
  templateNodes: params.templateGraph.nodes
    .map((node) => ({ id: node.id, type: node.type }))
    .sort((left, right) => left.id.localeCompare(right.id)),
  rootEdges: params.templateGraph.roots
    .map((root) => ({
      nodeId: root.nodeId,
      targetHandle: root.targetHandle
    }))
    .sort((left, right) => `${left.nodeId}:${left.targetHandle}`.localeCompare(`${right.nodeId}:${right.targetHandle}`)),
  internalEdges: params.templateGraph.internalEdges
    .map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle || '',
      target: edge.target,
      targetHandle: edge.targetHandle || ''
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  externalInputEdges: params.templateGraph.externalInputEdges
    .map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle || '',
      target: edge.target,
      targetHandle: edge.targetHandle || ''
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  items: params.batchOutput.items.map((item) => ({
    batchId: item.batchId,
    selectedIndex: item.selectedIndex,
    taskId: item.task.taskId,
    variantKey: item.variantKey || '',
    targetAspectRatio: item.visualSpec?.targetAspectRatio || item.task.visualSpec?.targetAspectRatio || '',
    targetImageSize: item.visualSpec?.targetImageSize || item.task.visualSpec?.targetImageSize || ''
  }))
});

const getExistingExpandedBatchNodes = (params: {
  batchNode: Node<NodeData>;
  nodes: Node<NodeData>[];
  edges: Edge[];
}) => {
  const expandedNodeIds = Array.isArray(params.batchNode.data.meta?.expandedNodeIds)
    ? params.batchNode.data.meta.expandedNodeIds.filter((nodeId: unknown): nodeId is string => typeof nodeId === 'string')
    : [];

  if (expandedNodeIds.length === 0) {
    return {
      nodes: [] as Node<NodeData>[],
      terminalNodes: [] as Node<NodeData>[]
    };
  }

  const nodeMap = new Map(params.nodes.map((node) => [node.id, node]));
  const expandedNodes = expandedNodeIds
    .map((nodeId) => nodeMap.get(nodeId))
    .filter((node): node is Node<NodeData> => (
      Boolean(node)
      && node.data?.meta?.batchExpansion?.sourceBatchNodeId === params.batchNode.id
    ));

  if (expandedNodes.length !== expandedNodeIds.length) {
    return {
      nodes: [] as Node<NodeData>[],
      terminalNodes: [] as Node<NodeData>[]
    };
  }

  const expandedNodeIdSet = new Set(expandedNodes.map((node) => node.id));
  const storedTerminalNodeIds = Array.isArray(params.batchNode.data.meta?.expandedTerminalNodeIds)
    ? params.batchNode.data.meta.expandedTerminalNodeIds.filter((nodeId: unknown): nodeId is string => typeof nodeId === 'string')
    : [];
  const fallbackTerminalNodeIds = expandedNodes
    .filter((node) => !params.edges.some((edge) => (
      expandedNodeIdSet.has(edge.source)
      && expandedNodeIdSet.has(edge.target)
      && edge.source === node.id
    )))
    .map((node) => node.id);
  const terminalNodeIds = storedTerminalNodeIds.length > 0 ? storedTerminalNodeIds : fallbackTerminalNodeIds;
  const terminalNodes = terminalNodeIds
    .map((nodeId) => nodeMap.get(nodeId))
    .filter((node): node is Node<NodeData> => Boolean(node) && expandedNodeIdSet.has(node.id));

  return {
    nodes: expandedNodes,
    terminalNodes: terminalNodes.length > 0 ? terminalNodes : expandedNodes
  };
};

const createBatchMappingEdge = (params: {
  batchNodeId: string;
  targetNodeId: string;
  sourceHandle?: string;
  targetHandle?: string;
  batchId?: string;
  selectedIndex?: number;
  kind?: 'batch-template' | 'batch-mapping';
  opacity?: number;
}) => ({
  id: params.batchId
    ? `edge-${params.batchNodeId}-${params.targetNodeId}-${params.batchId}`
    : `edge-${params.batchNodeId}-${params.targetNodeId}`,
  type: 'soft',
  source: params.batchNodeId,
  sourceHandle: params.sourceHandle || 'batch',
  target: params.targetNodeId,
  targetHandle: params.targetHandle || 'template',
  animated: false,
  style: {
    stroke: '#22d3ee',
    strokeWidth: 1.5,
    strokeDasharray: '6 4',
    opacity: params.opacity ?? 0.55
  },
  data: {
    kind: params.kind || 'batch-mapping',
    ...(params.batchId ? { batchId: params.batchId } : {}),
    ...(typeof params.selectedIndex === 'number' ? { selectedIndex: params.selectedIndex } : {})
  }
});

const createClonedBatchEdge = (params: {
  edge: Edge;
  source?: string;
  target?: string;
}) => ({
  ...params.edge,
  id: `edge-${params.source || params.edge.source}-${params.target || params.edge.target}-${uuidv4().slice(0, 8)}`,
  source: params.source || params.edge.source,
  target: params.target || params.edge.target,
  data: params.edge.data && typeof params.edge.data === 'object'
    ? { ...(params.edge.data as Record<string, any>) }
    : params.edge.data
}) satisfies Edge;

const compareBatchExpandedNodes = (left: Node<NodeData>, right: Node<NodeData>) => {
  const leftOrder = Number(left.data?.meta?.batchExpansion?.selectedIndex || 0);
  const rightOrder = Number(right.data?.meta?.batchExpansion?.selectedIndex || 0);
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (left.position.y !== right.position.y) {
    return left.position.y - right.position.y;
  }
  if (left.position.x !== right.position.x) {
    return left.position.x - right.position.x;
  }
  return left.id.localeCompare(right.id);
};

const buildExpandedBatchExecutionLayers = (params: {
  nodes: Node<NodeData>[];
  edges: Edge[];
}) => {
  const nodeMap = new Map(params.nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  params.nodes.forEach((node) => {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  });

  params.edges.forEach((edge) => {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      return;
    }
    outgoing.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  });

  const layers: string[][] = [];
  let ready = params.nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .sort(compareBatchExpandedNodes)
    .map((node) => node.id);

  while (ready.length > 0) {
    layers.push(ready);
    const nextReadySet = new Set<string>();

    ready.forEach((nodeId) => {
      (outgoing.get(nodeId) || []).forEach((targetId) => {
        const nextIndegree = (indegree.get(targetId) || 0) - 1;
        indegree.set(targetId, nextIndegree);
        if (nextIndegree === 0) {
          nextReadySet.add(targetId);
        }
      });
    });

    ready = Array.from(nextReadySet)
      .map((nodeId) => nodeMap.get(nodeId))
      .filter((node): node is Node<NodeData> => Boolean(node))
      .sort(compareBatchExpandedNodes)
      .map((node) => node.id);
  }

  const processedCount = layers.reduce((sum, layer) => sum + layer.length, 0);
  if (processedCount === params.nodes.length) {
    return layers;
  }

  return [params.nodes.slice().sort(compareBatchExpandedNodes).map((node) => node.id)];
};

const executeExpandedBatchSubgraph = async (params: {
  expandedNodes: Node<NodeData>[];
  terminalNodes: Node<NodeData>[];
  edges: Edge[];
  executeNode: (nodeId: string) => Promise<void>;
  getCurrentNodes: () => Node<NodeData>[];
}) => {
  const expandedNodeIdSet = new Set(params.expandedNodes.map((node) => node.id));
  const internalEdges = params.edges.filter((edge) => expandedNodeIdSet.has(edge.source) && expandedNodeIdSet.has(edge.target));
  const layers = buildExpandedBatchExecutionLayers({
    nodes: params.expandedNodes,
    edges: internalEdges
  });

  for (const layer of layers) {
    await Promise.all(layer.map((nodeId) => params.executeNode(nodeId)));
  }

  const targetNodeIdSet = new Set(
    (params.terminalNodes.length > 0 ? params.terminalNodes : params.expandedNodes).map((node) => node.id)
  );
  const latestNodes = params.getCurrentNodes().filter((node) => targetNodeIdSet.has(node.id));

  return {
    successCount: latestNodes.filter((node) => node.data.status === 'success').length,
    failedCount: latestNodes.filter((node) => node.data.status === 'error').length
  };
};

const createAutoBatchImageTemplateNode = (params: {
  batchNode: Node<NodeData>;
  preferredImageModelId?: string;
}) => {
  const dimensions = DEFAULT_NODE_DIMENSIONS[NodeType.AI_IMAGE] || { width: 360, height: 360 };
  const batchWidth = Number((params.batchNode.style as any)?.width || DEFAULT_NODE_DIMENSIONS[NodeType.BATCH_EXECUTE]?.width || 460);
  const baseLabel = DEFAULT_NODE_LABELS[NodeType.AI_IMAGE] || '图像生成';

  return {
    id: `${NodeType.AI_IMAGE}-${uuidv4().slice(0, 8)}`,
    type: NodeType.AI_IMAGE,
    position: {
      x: params.batchNode.position.x + batchWidth + 160,
      y: params.batchNode.position.y - 20
    },
    style: { ...dimensions },
    selected: false,
    data: {
      label: baseLabel,
      type: NodeType.AI_IMAGE,
      status: 'idle' as const,
      isSkipped: false,
      config: {
        prompt: '',
        modelId: params.preferredImageModelId || '',
        aspectRatio: '1:1',
        imageSize: '1K',
        promptTemplate: 'free_mode',
        enablePromptTemplate: false
      },
      meta: {
        batchTemplate: true,
        templateOnly: true,
        autoCreatedTemplate: true,
        batchBaseLabel: baseLabel
      }
    }
  } satisfies Node<NodeData>;
};

const expandBatchToImageNodes = (params: {
  batchNode: Node<NodeData>;
  batchOutput: BatchExecutionOutput;
  nodes: Node<NodeData>[];
  edges: Edge[];
  preferredImageModelId?: string;
  provider?: Partial<APIProvider> | null;
}) => {
  let templateGraph = getBatchTemplateGraph({
    batchNodeId: params.batchNode.id,
    nodes: params.nodes,
    edges: params.edges
  });
  const autoCreatedTemplateNodes: Node<NodeData>[] = [];
  if (templateGraph.nodes.length === 0) {
    const autoCreatedTemplateNode = createAutoBatchImageTemplateNode({
      batchNode: params.batchNode,
      preferredImageModelId: params.preferredImageModelId
    });
    autoCreatedTemplateNodes.push(autoCreatedTemplateNode);
    templateGraph = {
      nodes: [autoCreatedTemplateNode],
      roots: [{
        edge: createBatchMappingEdge({
          batchNodeId: params.batchNode.id,
          targetNodeId: autoCreatedTemplateNode.id,
          targetHandle: 'template',
          kind: 'batch-template',
          opacity: 0.72
        }),
        nodeId: autoCreatedTemplateNode.id,
        targetHandle: 'template'
      }],
      internalEdges: [],
      externalInputEdges: [],
      terminalNodeIds: [autoCreatedTemplateNode.id]
    };
  }

  const templateNodes = templateGraph.nodes;
  const templateIdSet = new Set(templateNodes.map((node) => node.id));
  const templateRootMap = new Map(templateGraph.roots.map((root) => [root.nodeId, root]));
  const firstBatchItem = params.batchOutput.items[0];
  const removedNodes = params.nodes.filter((node) => (
    node.data?.meta?.batchExpansion?.sourceBatchNodeId === params.batchNode.id
    && (
      !templateIdSet.has(node.data.meta.batchExpansion.templateNodeId)
      || node.id !== node.data.meta.batchExpansion.templateNodeId
    )
  ));
  const removedNodeIdSet = new Set(removedNodes.map((node) => node.id));

  const preservedNodes = params.nodes.filter((node) => !removedNodeIdSet.has(node.id) && !templateIdSet.has(node.id));
  const preservedEdges = params.edges
    .filter((edge) => !removedNodeIdSet.has(edge.source) && !removedNodeIdSet.has(edge.target))
    .map((edge) => {
      const root = templateRootMap.get(edge.target);
      if (
        !firstBatchItem
        || edge.source !== params.batchNode.id
        || !root
        || (edge.data as any)?.kind === 'batch-mapping'
      ) {
        return edge;
      }

      return createBatchMappingEdge({
        batchNodeId: params.batchNode.id,
        targetNodeId: edge.target,
        sourceHandle: 'batch',
        targetHandle: root.targetHandle,
        batchId: firstBatchItem.batchId,
        selectedIndex: firstBatchItem.selectedIndex,
        kind: 'batch-template',
        opacity: 0.72
      });
    });
  const createdNodes: Node<NodeData>[] = [];
  const createdEdges: Edge[] = [];
  const templateBounds = templateNodes.reduce((acc, templateNode) => {
    const width = Math.max(320, Number((templateNode.style as any)?.width || 320));
    const height = Math.max(220, Number((templateNode.style as any)?.height || 220));
    return {
      minX: Math.min(acc.minX, templateNode.position.x),
      minY: Math.min(acc.minY, templateNode.position.y),
      maxX: Math.max(acc.maxX, templateNode.position.x + width),
      maxY: Math.max(acc.maxY, templateNode.position.y + height)
    };
  }, {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  });
  const groupWidth = Math.max(420, templateBounds.maxX - templateBounds.minX + 140);
  const groupHeight = Math.max(320, templateBounds.maxY - templateBounds.minY + 100);
  const cloneCount = Math.max(0, params.batchOutput.items.length - 1);
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(cloneCount || 1))));
  const createdTerminalNodeIds: string[] = [];
  const firstRootNodeIdSet = new Set(
    preservedEdges
      .filter((edge) => edge.source === params.batchNode.id && (edge.data as any)?.kind === 'batch-template')
      .map((edge) => edge.target)
  );

  params.batchOutput.items.forEach((item, itemIndex) => {
    const cloneNodeIdMap = new Map<string, string>();
    const itemVisualSpec = item.visualSpec || item.task.visualSpec;
    const batchNodeLabelSuffix = item.variantLabel ? ` ${item.variantLabel}` : '';
    const cloneIndex = Math.max(0, itemIndex - 1);
    const column = cloneCount > 0 ? cloneIndex % columns : 0;
    const row = cloneCount > 0 ? Math.floor(cloneIndex / columns) : 0;
    const offsetX = itemIndex === 0 ? 0 : groupWidth + 160 + column * groupWidth;
    const offsetY = itemIndex === 0 ? 0 : row * groupHeight;

    templateNodes.forEach((templateNode) => {
      const rawTemplateMeta = templateNode.data.meta && typeof templateNode.data.meta === 'object'
        ? templateNode.data.meta
        : {};
      const {
        batchTemplate: _batchTemplate,
        templateOnly: _templateOnly,
        autoCreatedTemplate: _autoCreatedTemplate,
        batchExpansion: _existingBatchExpansion,
        ...templateMeta
      } = rawTemplateMeta;
      const baseLabel = typeof templateMeta?.batchBaseLabel === 'string' && templateMeta.batchBaseLabel.trim()
        ? templateMeta.batchBaseLabel
        : templateNode.data.label;
      const nextNodeId = itemIndex === 0
        ? templateNode.id
        : `${templateNode.type}-${uuidv4().slice(0, 8)}`;
      const mergedReferenceImages = mergeStructuredInputValue(
        'image',
        templateNode.data.config.referenceImages ?? templateNode.data.config.images,
        item.images
      );

      cloneNodeIdMap.set(templateNode.id, nextNodeId);

      const nextConfig = (() => {
        if (templateNode.type === NodeType.AI_IMAGE) {
          return {
            ...applyTaskVisualSpecToImageConfig(templateNode.data.config, itemVisualSpec, params.provider),
            prompt: item.prompt,
            referenceImages: mergedReferenceImages
          };
        }
        if (templateNode.type === NodeType.PRODUCT_IMAGE_MATCH) {
          return {
            ...templateNode.data.config,
            prompt: templateNode.data.config.prompt || item.prompt,
            batchTask: item.task
          };
        }
        if (templateNode.type === NodeType.STYLE_GUIDE) {
          return {
            ...templateNode.data.config,
            batchTask: item.task
          };
        }
        return { ...templateNode.data.config };
      })();

      createdNodes.push({
        ...templateNode,
        ...(itemIndex === 0 ? {} : { id: nextNodeId }),
        selected: false,
        position: itemIndex === 0
          ? templateNode.position
          : {
            x: templateNode.position.x + offsetX,
            y: templateNode.position.y + offsetY
          },
        data: {
          ...templateNode.data,
          label: `${baseLabel} ${item.selectedIndex}${batchNodeLabelSuffix}`,
          status: 'idle',
          error: undefined,
          progress: undefined,
          output: undefined,
          inputs: undefined,
          isSkipped: false,
          config: nextConfig,
          meta: {
            ...templateMeta,
            batchBaseLabel: baseLabel,
            batchItem: item,
            batchTask: item.task,
            batchPrompt: item.prompt,
            rawPrompt: item.prompt,
            optimizedPrompt: item.prompt,
            forwardedImages: item.images,
            selectedTaskId: item.task.taskId,
            selectedIndex: item.selectedIndex,
            task: item.task,
            visualSpec: itemVisualSpec,
            variantKey: item.variantKey,
            variantLabel: item.variantLabel,
            batchExpansion: {
              sourceBatchNodeId: params.batchNode.id,
              templateNodeId: templateNode.id,
              batchId: item.batchId,
              selectedIndex: item.selectedIndex,
              taskId: item.task.taskId,
              isSeedNode: itemIndex === 0,
              baseLabel,
              variantKey: item.variantKey,
              variantLabel: item.variantLabel
            }
          }
        }
      });
    });

    templateGraph.internalEdges.forEach((edge) => {
      const nextSourceId = cloneNodeIdMap.get(edge.source);
      const nextTargetId = cloneNodeIdMap.get(edge.target);
      if (!nextSourceId || !nextTargetId || itemIndex === 0) {
        return;
      }
      createdEdges.push(createClonedBatchEdge({
        edge,
        source: nextSourceId,
        target: nextTargetId
      }));
    });

    templateGraph.externalInputEdges.forEach((edge) => {
      const nextTargetId = cloneNodeIdMap.get(edge.target);
      if (!nextTargetId || itemIndex === 0) {
        return;
      }
      createdEdges.push(createClonedBatchEdge({
        edge,
        target: nextTargetId
      }));
    });

    templateGraph.roots.forEach((root) => {
      const nextTargetNodeId = cloneNodeIdMap.get(root.nodeId);
      if (!nextTargetNodeId) {
        return;
      }

      const isFirstItemRoot = itemIndex === 0;
      if (isFirstItemRoot && firstRootNodeIdSet.has(nextTargetNodeId)) {
        return;
      }

      createdEdges.push(createBatchMappingEdge({
        batchNodeId: params.batchNode.id,
        targetNodeId: nextTargetNodeId,
        sourceHandle: 'batch',
        targetHandle: root.targetHandle,
        batchId: item.batchId,
        selectedIndex: item.selectedIndex,
        kind: isFirstItemRoot ? 'batch-template' : 'batch-mapping',
        opacity: isFirstItemRoot ? 0.72 : 0.55
      }));
    });

    templateGraph.terminalNodeIds.forEach((templateTerminalNodeId) => {
      const createdTerminalNodeId = cloneNodeIdMap.get(templateTerminalNodeId);
      if (createdTerminalNodeId) {
        createdTerminalNodeIds.push(createdTerminalNodeId);
      }
    });
  });

  return {
    nodes: [...preservedNodes, ...createdNodes],
    edges: [...preservedEdges, ...createdEdges],
    templateNodes,
    templateGraph,
    autoCreatedTemplateNodes,
    removedNodes,
    createdNodes,
    createdEdges,
    createdTerminalNodeIds
  };
};

const prepareAiImageRequest = (
  nodeConfig: Record<string, any>,
  structuredInputs: Record<string, any>,
  provider?: Partial<APIProvider> | null
) => {
  const upstreamRawPrompt = typeof structuredInputs._raw_prompt === 'string'
    ? normalizePromptText(structuredInputs._raw_prompt)
    : '';
  const hasPromptInput = Object.prototype.hasOwnProperty.call(structuredInputs, 'prompt');
  const upstreamTaskVisualSpec = (
    structuredInputs.visualSpec
    || structuredInputs.task?.visualSpec
    || structuredInputs.default?.visualSpec
  ) as TaskVisualSpec | undefined;
  const strictPrompt = normalizePromptText(
    hasPromptInput ? structuredInputs.prompt : (upstreamRawPrompt || nodeConfig.prompt)
  );
  const connectedHandles = new Set(
    Array.isArray(structuredInputs.__connectedHandles)
      ? structuredInputs.__connectedHandles.map((item: unknown) => String(item || ''))
      : []
  );
  const hasExplicitImageInput = Object.prototype.hasOwnProperty.call(structuredInputs, 'image');
  const hasImageConnection = hasExplicitImageInput || connectedHandles.has('image');
  const fallbackImages = hasExplicitImageInput
    ? structuredInputs.image
    : (hasImageConnection ? undefined : (nodeConfig.referenceImages ?? nodeConfig.images));
  if (hasImageConnection && fallbackImages === undefined) {
    throw new Error('参考图输入已连接，但没有收到有效图片；请先运行或重新上传上游产品图节点');
  }
  const requestInputs: Record<string, any> = {
    ...structuredInputs,
    ...(fallbackImages !== undefined ? { image: fallbackImages } : {}),
    prompt: strictPrompt,
    _raw_prompt: strictPrompt
  };

  Object.keys(requestInputs).forEach((key) => {
    if (key.startsWith('__')) {
      delete requestInputs[key];
      return;
    }
    if (key === 'batch' || key === 'template') {
      delete requestInputs[key];
      return;
    }
    if (key === 'prompt' || key === 'image' || key === '_raw_prompt') return;
    if (typeof requestInputs[key] === 'string') {
      delete requestInputs[key];
    }
  });

  const requestConfig = applyTaskVisualSpecToImageConfig({
    ...nodeConfig,
    prompt: strictPrompt,
    promptTemplate: nodeConfig.enablePromptTemplate ? nodeConfig.promptTemplate : 'free_mode',
    enablePromptTemplate: !!nodeConfig.enablePromptTemplate
  }, upstreamTaskVisualSpec, provider);

  return { requestInputs, requestConfig, strictPrompt };
};

const executeAiImageBatch = async (
  params: {
    nodeId: string;
    nodeLabel: string;
    nodeConfig: Record<string, any>;
    structuredInputs: Record<string, any>;
    service: AIService;
    provider: Partial<APIProvider>;
    onProgress?: (progress: number) => void;
    shouldStop?: () => boolean;
  }
) => {
  const batchInput = params.structuredInputs.batch;
  const batchItems = getBatchItemsFromInput(batchInput);
  if (batchItems.length === 0) {
    throw new Error('请先连接并运行批量执行节点');
  }

  const intervalMs = Math.max(
    0,
    Number(
      (batchInput && typeof batchInput === 'object' && 'intervalMs' in (batchInput as BatchExecutionOutput))
        ? (batchInput as BatchExecutionOutput).intervalMs
        : 0
    )
  );
  const continueOnError = params.structuredInputs.batch?.continueOnError !== false && params.nodeConfig.continueOnError !== false;
  const results: BatchImageResult[] = [];

  for (let index = 0; index < batchItems.length; index += 1) {
    if (params.shouldStop?.()) {
      throw new Error('批量执行已停止');
    }

    const item = batchItems[index];
    const prepared = prepareAiImageRequest(params.nodeConfig, {
      prompt: item.prompt,
      _raw_prompt: item.prompt,
      image: item.images
    }, params.provider);

    if (!prepared.strictPrompt) {
      results.push({
        batchId: item.batchId,
        selectedIndex: item.selectedIndex,
        prompt: item.prompt,
        task: item.task,
        error: '当前任务没有可用提示词'
      });
    } else {
      try {
        const resolvedApiInputs = await resolvePayloadBeforeApi(prepared.requestInputs);
        const response = await params.service.executeNode(
          params.nodeId,
          NodeType.AI_IMAGE,
          prepared.requestConfig,
          resolvedApiInputs,
          buildApiSettings(params.provider)!
        );
        const rawOutput = response?.output ?? response;
        const normalizedOutput = normalizeImageSrc(rawOutput) ?? rawOutput;

        if (typeof normalizedOutput !== 'string' || !normalizedOutput.trim()) {
          results.push({
            batchId: item.batchId,
            selectedIndex: item.selectedIndex,
            prompt: prepared.strictPrompt,
            task: item.task,
            error: '模型未返回有效图片'
          });
        } else {
          results.push({
            batchId: item.batchId,
            selectedIndex: item.selectedIndex,
            prompt: prepared.strictPrompt,
            task: item.task,
            output: normalizedOutput
          });
        }
      } catch (error: any) {
        results.push({
          batchId: item.batchId,
          selectedIndex: item.selectedIndex,
          prompt: prepared.strictPrompt,
          task: item.task,
          error: typeof error === 'string' ? error : (error?.message || '鎵归噺鍑哄浘澶辫触')
        });
        if (!continueOnError) {
          throw error;
        }
      }
    }

    const progress = Math.round(((index + 1) / batchItems.length) * 100);
    params.onProgress?.(progress);

    if (intervalMs > 0 && index < batchItems.length - 1) {
      await delay(intervalMs);
    }
  }

  const successResults = results.filter((item) => typeof item.output === 'string' && item.output.trim());
  if (successResults.length === 0) {
    const firstError = results.find((item) => item.error)?.error || '鎵归噺鎵ц澶辫触';
    throw new Error(firstError);
  }

  return {
    output: successResults.map((item) => item.output!),
    meta: {
      batchMode: true,
      batchResults: results,
      successCount: successResults.length,
      failedCount: results.length - successResults.length,
      totalCount: results.length,
      rawPrompt: successResults[0]?.prompt || '',
      optimizedPrompt: successResults[0]?.prompt || '',
      modelId: params.nodeConfig.modelId || 'unknown'
    }
  };
};

const getSheetRowValue = (row: any[], columnRef: string) => {
  const index = columnRefToIndex(columnRef);
  return normalizeCellText(row?.[index]);
};

const normalizeAsciiDigits = (value: string) => value.replace(/[\uFF10-\uFF19]/g, (char) => String(char.charCodeAt(0) - 0xFF10));

const extractTaskSerialValue = (rawValue: string) => {
  const normalized = normalizeAsciiDigits(normalizeCellText(rawValue));
  if (!normalized) return '';
  const match = normalized.match(/^\s*(?:\u7B2C\s*)?(\d+)/i);
  return match ? match[1] : '';
};

const pushUniqueCellText = (target: string[], rawValue: string) => {
  const normalized = normalizeCellText(rawValue);
  if (!normalized || target.includes(normalized)) return;
  target.push(normalized);
};

const columnIndexToRef = (index: number) => {
  if (index < 0) return 'A';
  let current = index;
  let ref = '';
  while (current >= 0) {
    ref = String.fromCharCode((current % 26) + 65) + ref;
    current = Math.floor(current / 26) - 1;
  }
  return ref;
};

const normalizeSheetHeaderText = (value: unknown) => normalizeAsciiDigits(normalizeCellText(value))
  .replace(/[\s_\-??:?/\\??()\[\]??.?]/g, '')
  .toLowerCase();

const detectSheetHeaderRowIndex = (matrix: any[][]) => {
  const headerKeywords = ['\u7f16\u53f7', '\u50cf\u7d20', '\u53c2\u8003\u56fe', '\u9700\u6c42', '\u63d2\u5165\u7684\u82f1\u6587'];
  let bestIndex = -1;
  let bestScore = 0;

  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 6); rowIndex += 1) {
    const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
    const normalizedCells = row.map((cell) => normalizeSheetHeaderText(cell)).filter(Boolean);
    if (normalizedCells.length === 0) continue;

    const score = headerKeywords.reduce((count, keyword) => (
      normalizedCells.some((cell) => cell.includes(keyword)) ? count + 1 : count
    ), 0);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  }

  return bestScore >= 2 ? bestIndex : -1;
};

const countSerialMatchesInColumn = (
  matrix: any[][],
  columnRef: string,
  startRowIndex: number,
  endExclusive: number
) => {
  let count = 0;
  for (let rowIndex = startRowIndex; rowIndex < endExclusive; rowIndex += 1) {
    const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
    if (extractTaskSerialValue(getSheetRowValue(row, columnRef))) {
      count += 1;
    }
  }
  return count;
};

const detectSheetIdColumn = (
  matrix: any[][],
  config: {
    idColumn: string;
    headerRow: number;
    textColumns: string[];
  },
  startRowIndex: number,
  endExclusive: number
) => {
  const configuredColumn = config.idColumn;
  const configuredCount = countSerialMatchesInColumn(matrix, configuredColumn, startRowIndex, endExclusive);
  const headerRow = Array.isArray(matrix[Math.max(0, config.headerRow - 1)]) ? matrix[Math.max(0, config.headerRow - 1)] : [];
  const headerKeywords = ['\u7f16\u53f7', '\u5e8f\u53f7', 'id', 'no', 'no.'];

  let bestColumn = configuredColumn;
  let bestCount = configuredCount;
  let reason: 'configured' | 'header' = 'configured';

  headerRow.forEach((cell, index) => {
    const normalizedHeader = normalizeSheetHeaderText(cell);
    if (!normalizedHeader) return;
    const matchesHeader = headerKeywords.some((keyword) => normalizedHeader.includes(keyword));
    if (!matchesHeader) return;
    const candidateColumn = columnIndexToRef(index);
    const candidateCount = countSerialMatchesInColumn(matrix, candidateColumn, startRowIndex, endExclusive);
    if (candidateCount > bestCount) {
      bestColumn = candidateColumn;
      bestCount = candidateCount;
      reason = 'header';
    }
  });


  return {
    columnRef: bestColumn,
    matchedRows: bestCount,
    configuredCount,
    reason
  };
};

const buildSheetRowSnapshot = (row: any[], columnRefs: string[]) => {
  return columnRefs.reduce<Record<string, string>>((acc, columnRef) => {
    acc[columnRef] = getSheetRowValue(row, columnRef);
    return acc;
  }, {});
};

const buildPopulatedRowSnapshot = (row: any[]) => {
  return (Array.isArray(row) ? row : []).reduce<Record<string, string>>((acc, cell, index) => {
    const normalized = normalizeCellText(cell);
    if (!normalized) return acc;
    acc[columnIndexToRef(index)] = normalized;
    return acc;
  }, {});
};

const mergeRowSnapshot = (target: Record<string, string>, source: Record<string, string>) => {
  Object.entries(source).forEach(([columnRef, value]) => {
    const normalized = normalizeCellText(value);
    if (!normalized) return;
    if (!target[columnRef]) {
      target[columnRef] = normalized;
      return;
    }
    const currentParts = target[columnRef]
      .split('\n')
      .map((item) => normalizeCellText(item))
      .filter(Boolean);
    if (currentParts.includes(normalized)) return;
    target[columnRef] = [...currentParts, normalized].join('\n');
  });
};

const findFirstSerialRowIndex = (
  matrix: any[][],
  columnRef: string,
  startRowIndex: number,
  endExclusive: number
) => {
  for (let rowIndex = startRowIndex; rowIndex < endExclusive; rowIndex += 1) {
    const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
    if (extractTaskSerialValue(getSheetRowValue(row, columnRef))) {
      return rowIndex;
    }
  }
  return -1;
};

const isSpreadsheetPayload = (payload: unknown): payload is StandardFilePayload => {
  return !!payload
    && typeof payload === 'object'
    && 'type' in payload
    && (payload as StandardFilePayload).type === 'xlsx';
};

const getZipEntry = (files: Record<string, any> | undefined, path: string) => {
  if (!files) return undefined;
  const normalizedPath = normalizeZipPath(path);
  return files[normalizedPath] || files[`/${normalizedPath}`] || files[path];
};

const getZipEntryContentBytes = (entry: any): Uint8Array | null => {
  if (!entry) return null;
  const content = entry.content ?? entry.data ?? entry;
  if (!content) return null;
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  }
  if (Array.isArray(content)) return Uint8Array.from(content);
  return null;
};

const readZipEntryText = (files: Record<string, any> | undefined, path: string) => {
  const entry = getZipEntry(files, path);
  if (!entry) return '';
  if (typeof entry.content === 'string') return entry.content;
  if (typeof entry.data === 'string') return entry.data;
  const bytes = getZipEntryContentBytes(entry);
  if (!bytes) return '';
  return new TextDecoder('utf-8').decode(bytes);
};

const getRelsPathForZipPath = (path: string) => {
  const normalized = normalizeZipPath(path);
  const idx = normalized.lastIndexOf('/');
  const dir = idx >= 0 ? normalized.slice(0, idx + 1) : '';
  const file = idx >= 0 ? normalized.slice(idx + 1) : normalized;
  return `${dir}_rels/${file}.rels`;
};

const resolveZipTargetPath = (basePath: string, target: string) => {
  if (!target) return '';
  if (/^[a-z]+:/i.test(target)) return '';
  const normalizedBase = normalizeZipPath(basePath);
  const normalizedTarget = normalizeZipPath(target);
  if (target.startsWith('/')) return normalizedTarget;

  const baseDir = normalizedBase.includes('/')
    ? normalizedBase.slice(0, normalizedBase.lastIndexOf('/') + 1)
    : '';

  const stack = baseDir.split('/').filter(Boolean);
  normalizedTarget.split('/').forEach((segment) => {
    if (!segment || segment === '.') return;
    if (segment === '..') {
      stack.pop();
      return;
    }
    stack.push(segment);
  });

  return stack.join('/');
};

const parseXmlDocument = (xml: string) => {
  if (!xml.trim()) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  return doc;
};

const parseRelationshipsXml = (xml: string, sourcePath: string) => {
  const doc = parseXmlDocument(xml);
  const result = new Map<string, { target: string; type: string }>();
  if (!doc) return result;

  Array.from(doc.getElementsByTagNameNS('*', 'Relationship')).forEach((node) => {
    const id = node.getAttribute('Id') || '';
    const type = node.getAttribute('Type') || '';
    const target = node.getAttribute('Target') || '';
    const resolvedTarget = resolveZipTargetPath(sourcePath, target);
    if (id && resolvedTarget) {
      result.set(id, { target: resolvedTarget, type });
    }
  });

  return result;
};

const getFirstElementByLocalName = (parent: ParentNode | Element, localName: string) => {
  const nodes = (parent as Element | Document).getElementsByTagNameNS('*', localName);
  return nodes.length > 0 ? nodes[0] : null;
};

const getTextFromLocalName = (parent: ParentNode | Element, localName: string) => {
  return getFirstElementByLocalName(parent, localName)?.textContent?.trim() || '';
};

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/emf'
};

const inferMimeFromPath = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return IMAGE_MIME_BY_EXT[ext] || 'application/octet-stream';
};

const createEmbeddedImagePayload = (
  mediaPath: string,
  bytes: Uint8Array,
  sheetName: string,
  rowNumber: number
): StandardFilePayload => {
  const name = mediaPath.split('/').pop() || `embedded-${rowNumber}`;
  const mime = inferMimeFromPath(name);
  const blob = new Blob([bytes], { type: mime });
  return {
    id: `xlsx-image-${sheetName}-${rowNumber}-${name}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    source: 'local',
    type: 'image',
    name,
    size: bytes.byteLength,
    mime,
    url: URL.createObjectURL(blob),
    meta: {
      origin: 'xlsx-embedded',
      sheetName,
      rowNumber,
      path: mediaPath
    }
  };
};

const getSheetPathByName = (files: Record<string, any> | undefined, sheetName: string) => {
  const workbookXml = readZipEntryText(files, 'xl/workbook.xml');
  const workbookRels = parseRelationshipsXml(readZipEntryText(files, 'xl/_rels/workbook.xml.rels'), 'xl/workbook.xml');
  const workbookDoc = parseXmlDocument(workbookXml);
  if (!workbookDoc) return '';

  const sheets = Array.from(workbookDoc.getElementsByTagNameNS('*', 'sheet'));
  const targetSheet = sheets.find((sheet) => sheet.getAttribute('name') === sheetName);
  if (!targetSheet) return '';

  const relId = targetSheet.getAttribute('r:id') || targetSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || '';
  return relId ? (workbookRels.get(relId)?.target || '') : '';
};

const extractEmbeddedImagesByRow = (
  files: Record<string, any> | undefined,
  sheetName: string
) => {
  const warnings: string[] = [];
  const imagesByRow = new Map<number, StandardFilePayload[]>();
  if (!files || Object.keys(files).length === 0) {
    return { imagesByRow, warnings };
  }

  const sheetPath = getSheetPathByName(files, sheetName);
  if (!sheetPath) {
    return { imagesByRow, warnings };
  }

  const sheetRels = parseRelationshipsXml(readZipEntryText(files, getRelsPathForZipPath(sheetPath)), sheetPath);
  const drawingTargets = Array.from(sheetRels.values())
    .filter((rel) => rel.type.includes('/drawing'))
    .map((rel) => rel.target);

  drawingTargets.forEach((drawingPath) => {
    const drawingDoc = parseXmlDocument(readZipEntryText(files, drawingPath));
    if (!drawingDoc) return;

    const drawingRels = parseRelationshipsXml(readZipEntryText(files, getRelsPathForZipPath(drawingPath)), drawingPath);
    const anchors = [
      ...Array.from(drawingDoc.getElementsByTagNameNS('*', 'twoCellAnchor')),
      ...Array.from(drawingDoc.getElementsByTagNameNS('*', 'oneCellAnchor'))
    ];

    anchors.forEach((anchor) => {
      const fromNode = getFirstElementByLocalName(anchor, 'from');
      const rowText = fromNode ? getTextFromLocalName(fromNode, 'row') : '';
      const rowNumber = Number(rowText) + 1;
      if (!Number.isFinite(rowNumber) || rowNumber <= 0) return;

      const blips = Array.from(anchor.getElementsByTagNameNS('*', 'blip'));
      blips.forEach((blip) => {
        const relId = blip.getAttribute('r:embed')
          || blip.getAttribute('embed')
          || blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')
          || '';
        if (!relId) return;
        const target = drawingRels.get(relId);
        if (!target || !target.type.includes('/image')) return;
        const mediaEntry = getZipEntry(files, target.target);
        const mediaBytes = getZipEntryContentBytes(mediaEntry);
        if (!mediaBytes) {
          warnings.push(`鍥剧墖璧勬簮璇诲彇澶辫触锛?{target.target}`);
          return;
        }
        const payload = createEmbeddedImagePayload(target.target, mediaBytes, sheetName, rowNumber);
        const current = imagesByRow.get(rowNumber) || [];
        current.push(payload);
        imagesByRow.set(rowNumber, current);
      });
    });
  });

  return { imagesByRow, warnings };
};

const readSpreadsheetArrayBuffer = async (payload: StandardFilePayload) => {
  if (payload.data instanceof ArrayBuffer) return payload.data;
  if (!payload.url) throw new Error('鏈壘鍒拌〃鏍兼枃浠跺湴鍧€');
  const response = await fetch(payload.url);
  if (!response.ok) throw new Error('璇诲彇琛ㄦ牸鏂囦欢澶辫触');
  return await response.arrayBuffer();
};

const parseSpreadsheetOutputStandard = async (
  payload: StandardFilePayload,
  effectiveConfig: EffectiveTableParseConfig
): Promise<SpreadsheetParseOutput> => {
  if (!isSpreadsheetPayload(payload)) {
    throw new Error('璇蜂笂浼?Excel / CSV 琛ㄦ牸鏂囦欢');
  }
  const buffer = await readSpreadsheetArrayBuffer(payload);
  const workbook = XLSX.read(buffer, { type: 'array', bookFiles: true });
  const warnings: string[] = [];
  const requestedSheet = effectiveConfig.sheetName.trim();
  const normalizedRequestedSheet = requestedSheet.toLowerCase();
  const parseAllSheets = !requestedSheet || normalizedRequestedSheet === 'auto' || normalizedRequestedSheet === 'all' || requestedSheet === '*';
  const resolvedSheetNames = parseAllSheets
    ? workbook.SheetNames.filter(Boolean)
    : (workbook.Sheets[requestedSheet] ? [requestedSheet] : [workbook.SheetNames[0]].filter(Boolean));

  if (resolvedSheetNames.length === 0) {
    throw new Error('表格中未找到可解析的工作表');
  }

  if (!parseAllSheets && requestedSheet !== resolvedSheetNames[0]) {
    warnings.push(`未找到工作表“${requestedSheet}”，已自动回退到“${resolvedSheetNames[0]}”。`);


  }

  const tasks: SpreadsheetParseTask[] = [];
  let totalRows = 0;
  let skippedRows = 0;
  resolvedSheetNames.forEach((resolvedSheetName) => {
    const sheet = workbook.Sheets[resolvedSheetName];
    if (!sheet) return;

    const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
    const { imagesByRow, warnings: imageWarnings } = effectiveConfig.extractEmbeddedImages
      ? extractEmbeddedImagesByRow((workbook as any).files, resolvedSheetName)
      : { imagesByRow: new Map<number, StandardFilePayload[]>(), warnings: [] as string[] };

    warnings.push(...imageWarnings.map((warning) => `宸ヤ綔琛ㄢ€?{resolvedSheetName}鈥濓細${warning}`));

    const configuredStartRowIndex = Math.max(0, effectiveConfig.dataStartRow - 1);
    const detectedHeaderRowIndex = detectSheetHeaderRowIndex(matrix);
    const defaultStartRowIndex = detectedHeaderRowIndex >= 0
      ? detectedHeaderRowIndex + 1
      : configuredStartRowIndex;
    const detectionStartRowIndex = Math.max(0, Math.min(effectiveConfig.headerRow, effectiveConfig.dataStartRow) - 1);
    const taskCountBeforeSheet = tasks.length;
    const idColumnDetection = detectSheetIdColumn(matrix, effectiveConfig, detectionStartRowIndex, matrix.length);
    const sheetIdColumn = idColumnDetection.columnRef;
    const detectedStartRowIndex = findFirstSerialRowIndex(matrix, sheetIdColumn, detectionStartRowIndex, matrix.length);
    const startRowIndex = detectedStartRowIndex >= 0
      ? Math.min(defaultStartRowIndex, configuredStartRowIndex, detectedStartRowIndex)
      : defaultStartRowIndex;
    const endExclusive = Math.min(matrix.length, startRowIndex + effectiveConfig.maxRows);
    totalRows += Math.max(0, matrix.length - startRowIndex);

    if (sheetIdColumn !== effectiveConfig.idColumn && idColumnDetection.matchedRows > 0) {
      warnings.push(`????${resolvedSheetName}????????? ${effectiveConfig.idColumn} ??? ${sheetIdColumn}?`);
    }

    if (detectedStartRowIndex >= 0 && detectedStartRowIndex < configuredStartRowIndex) {
      warnings.push(`????${resolvedSheetName}???????????? ${configuredStartRowIndex + 1} ????? ${detectedStartRowIndex + 1} ??`);
    }

    if (idColumnDetection.matchedRows === 0) {
      let sheetTaskIndex = 0;

      for (let rowIndex = startRowIndex; rowIndex < endExclusive; rowIndex += 1) {
        const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
        const rowSnapshot = buildPopulatedRowSnapshot(row);
        const embeddedImages = imagesByRow.get(rowIndex + 1) || [];
        const size = getSheetRowValue(row, effectiveConfig.sizeColumn);
        const referenceText = getSheetRowValue(row, effectiveConfig.referenceColumn);
        const requirementZh = getSheetRowValue(row, effectiveConfig.requirementColumn);
        const textLayers = effectiveConfig.textColumns
          .map((columnRef) => getSheetRowValue(row, columnRef))
          .filter(Boolean);
        const fallbackValues = Object.entries(rowSnapshot)
          .sort((left, right) => columnRefToIndex(left[0]) - columnRefToIndex(right[0]))
          .map(([, value]) => normalizeCellText(value))
          .filter((value, index, list) => value
            && value !== normalizeCellText(size)
            && list.indexOf(value) === index);
        const resolvedRequirementZh = requirementZh || fallbackValues.join('\n');
        const hasMeaningfulContent = Boolean(
          resolvedRequirementZh || referenceText || textLayers.length > 0 || embeddedImages.length > 0
        );

        if (!hasMeaningfulContent && effectiveConfig.skipEmptyRows) {
          skippedRows += 1;
          continue;
        }

        if (!hasMeaningfulContent) {
          continue;
        }

        sheetTaskIndex += 1;
        tasks.push(withResolvedTaskVisualSpec({
          taskId: `${resolvedSheetName}-row-${rowIndex + 1}`,
          rowNumber: rowIndex + 1,
          serialNo: String(sheetTaskIndex),
          size,
          requirementZh: resolvedRequirementZh,
          referenceText,
          textLayers,
          referenceImages: [...embeddedImages],
          embeddedImages: [...embeddedImages],
          source: {
            sheetName: resolvedSheetName,
            rowNumber: rowIndex + 1
          },
          rawRow: rowSnapshot
        }));
      }

      if (sheetTaskIndex > 0) {
        warnings.push(`????${resolvedSheetName}??????????????????? ${sheetTaskIndex} ????`);
      }

      if (matrix.length > endExclusive) {
        warnings.push(`????${resolvedSheetName}????? ${effectiveConfig.maxRows} ???????????`);
      }

      return;
    }

    let currentTask:
      | {
        serialNo: string;
        startRowNumber: number;
        rawRow: Record<string, string>;
        size: string;
        requirementParts: string[];
        referenceParts: string[];
        textLayers: string[];
        images: StandardFilePayload[];
        imageKeys: Set<string>;
      }
      | null = null;

    const appendTaskImages = (images: StandardFilePayload[]) => {
      if (!currentTask) return;
      images.forEach((image) => {
        const imageKey = `${image.id || ''}|${image.name || ''}|${image.url || ''}|${image.createdAt || ''}`;
        if (currentTask!.imageKeys.has(imageKey)) return;
        currentTask!.imageKeys.add(imageKey);
        currentTask!.images.push(image);
      });
    };

    const flushCurrentTask = () => {
      if (!currentTask) return;

      const fallbackValues = Object.entries(currentTask.rawRow || {})
        .sort((left, right) => columnRefToIndex(left[0]) - columnRefToIndex(right[0]))
        .map(([, value]) => normalizeCellText(value))
        .filter((value, index, list) => value
          && value !== normalizeCellText(currentTask?.serialNo)
          && value !== normalizeCellText(currentTask?.size)
          && list.indexOf(value) === index);
      const referenceText = currentTask.referenceParts.join('\n');
      const requirementZh = currentTask.requirementParts.join('\n') || fallbackValues.join('\n');
      const hasMeaningfulContent = Boolean(
        requirementZh || referenceText || currentTask.textLayers.length > 0 || currentTask.images.length > 0
      );

      if (!hasMeaningfulContent) {
        currentTask = null;
        return;
      }

      tasks.push(withResolvedTaskVisualSpec({
        taskId: `${resolvedSheetName}-${currentTask.serialNo}-${currentTask.startRowNumber}`,
        rowNumber: currentTask.startRowNumber,
        serialNo: currentTask.serialNo,
        size: currentTask.size,
        requirementZh,
        referenceText,
        textLayers: [...currentTask.textLayers],
        referenceImages: [...currentTask.images],
        embeddedImages: [...currentTask.images],
        source: {
          sheetName: resolvedSheetName,
          rowNumber: currentTask.startRowNumber
        },
        rawRow: currentTask.rawRow
      }));

      currentTask = null;
    };

    for (let rowIndex = startRowIndex; rowIndex < endExclusive; rowIndex += 1) {
      const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
      const rowSnapshot = buildPopulatedRowSnapshot(row);
      const rawSerialNo = getSheetRowValue(row, sheetIdColumn);
      const serialNo = extractTaskSerialValue(rawSerialNo);
      const size = getSheetRowValue(row, effectiveConfig.sizeColumn);
      const referenceText = getSheetRowValue(row, effectiveConfig.referenceColumn);
      const requirementZh = getSheetRowValue(row, effectiveConfig.requirementColumn);
      const textLayers = effectiveConfig.textColumns
        .map((columnRef) => getSheetRowValue(row, columnRef))
        .filter(Boolean);
      const embeddedImages = imagesByRow.get(rowIndex + 1) || [];
      const hasMeaningfulContent = Object.values(rowSnapshot).some(Boolean)
        || embeddedImages.length > 0;

      if (serialNo && (!currentTask || currentTask.serialNo !== serialNo)) {
        flushCurrentTask();
        currentTask = {
          serialNo,
          startRowNumber: rowIndex + 1,
          rawRow: rowSnapshot,
          size: '',
          requirementParts: [],
          referenceParts: [],
          textLayers: [],
          images: [],
          imageKeys: new Set<string>()
        };
      }

      if (!currentTask) {
        skippedRows += 1;
        continue;
      }

      if (!hasMeaningfulContent && effectiveConfig.skipEmptyRows) {
        skippedRows += 1;
        continue;
      }

      if (!currentTask.size && size) {
        currentTask.size = size;
      }

      mergeRowSnapshot(currentTask.rawRow, rowSnapshot);
      pushUniqueCellText(currentTask.requirementParts, requirementZh);
      pushUniqueCellText(currentTask.referenceParts, referenceText);
      textLayers.forEach((text) => pushUniqueCellText(currentTask!.textLayers, text));
      appendTaskImages(embeddedImages);
    }

    flushCurrentTask();

    if (tasks.length === taskCountBeforeSheet) {
      const hasSheetContent = matrix
        .slice(startRowIndex, endExclusive)
        .some((row, offset) => {
          const actualRow = Array.isArray(row) ? row : [];
          const hasRowText = actualRow.some((cell) => normalizeCellText(cell));
          const hasRowImages = (imagesByRow.get(startRowIndex + offset + 1) || []).length > 0;
          return hasRowText || hasRowImages;
        });

      if (hasSheetContent) {
        warnings.push(`工作表“${resolvedSheetName}”未识别到可用任务，请检查编号列是否正确，当前使用 ${sheetIdColumn} 列。`);
      }
    }

    if (matrix.length > endExclusive) {
      warnings.push(`工作表“${resolvedSheetName}”仅解析前 ${effectiveConfig.maxRows} 行，剩余行已忽略。`);
    }
  });

  const sheetOrderMap = new Map(resolvedSheetNames.map((name, index) => [name, index]));
  tasks.sort((left, right) => {
    const leftSheetOrder = sheetOrderMap.get(left.source.sheetName) ?? Number.MAX_SAFE_INTEGER;
    const rightSheetOrder = sheetOrderMap.get(right.source.sheetName) ?? Number.MAX_SAFE_INTEGER;
    if (leftSheetOrder !== rightSheetOrder) {
      return leftSheetOrder - rightSheetOrder;
    }

    if (left.rowNumber !== right.rowNumber) {
      return left.rowNumber - right.rowNumber;
    }

    return String(left.serialNo || '').localeCompare(String(right.serialNo || ''), 'zh-Hans-CN', { numeric: true });
  });

  const summarySheetName = resolvedSheetNames.length === 1
    ? resolvedSheetNames[0]
    : `鍏ㄩ儴宸ヤ綔琛?(${resolvedSheetNames.length})`;

  return {
    runId: `sheet-${Date.now()}`,
    fileName: payload.name,
    sheetName: summarySheetName,
    sheetNames: resolvedSheetNames,
    sheetCount: resolvedSheetNames.length,
    taskCount: tasks.length,
    totalRows,
    skippedRows,
    warnings,
    parseMode: 'standard',
    tasks
  };
};

type TableParseApiSettings = {
  apiKey: string;
  baseUrl: string;
};

const SMART_TABLE_PARSE_SYSTEM_INSTRUCTION = [
  'You read complex Excel layouts and extract the true creative task blocks.',
  'Keep original Chinese copy exactly as written and never translate it into English.',
  'Return strict JSON with a root object that contains a tasks array.',
  'Ignore pure headers, helper notes, blank rows, and support columns unless they belong to a real task.'
].join('\n');

const sortSpreadsheetTasks = (tasks: SpreadsheetParseTask[], sheetNames: string[]) => {
  const sheetOrderMap = new Map(sheetNames.map((name, index) => [name, index]));
  tasks.sort((left, right) => {
    const leftSheetOrder = sheetOrderMap.get(left.source.sheetName) ?? Number.MAX_SAFE_INTEGER;
    const rightSheetOrder = sheetOrderMap.get(right.source.sheetName) ?? Number.MAX_SAFE_INTEGER;
    if (leftSheetOrder !== rightSheetOrder) {
      return leftSheetOrder - rightSheetOrder;
    }

    if (left.rowNumber !== right.rowNumber) {
      return left.rowNumber - right.rowNumber;
    }

    return String(left.serialNo || '').localeCompare(String(right.serialNo || ''), 'zh-Hans-CN', {
      numeric: true
    });
  });

  const sheetTaskCounters = new Map<string, number>();
  tasks.forEach((task) => {
    const sheetName = task.source?.sheetName || '';
    const sheetTaskIndex = (sheetTaskCounters.get(sheetName) || 0) + 1;
    sheetTaskCounters.set(sheetName, sheetTaskIndex);
    task.sheetTaskIndex = sheetTaskIndex;
    task.visualSpec = resolveTaskVisualSpec(task);
  });
};

const getSpreadsheetSummarySheetName = (sheetNames: string[]) => (
  sheetNames.length === 1 ? sheetNames[0] : `All Sheets (${sheetNames.length})`
);

const normalizeSmartFieldText = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeSmartFieldText(item))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return normalizeCellText(value);
  }
  return '';
};

const normalizeSmartFieldList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeSmartFieldText(item))
      .filter(Boolean);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
      .split(/\r?\n|[|｜/]/)
      .map((item) => normalizeCellText(item))
      .filter(Boolean);
  }
  return [];
};

const buildFallbackRequirementFromRawRow = (rawRow: Record<string, string>, serialNo: string, size: string) => (
  Object.entries(rawRow || {})
    .sort((left, right) => columnRefToIndex(left[0]) - columnRefToIndex(right[0]))
    .map(([, value]) => normalizeCellText(value))
    .filter((value, index, list) => value
      && value !== normalizeCellText(serialNo)
      && value !== normalizeCellText(size)
      && list.indexOf(value) === index)
    .join('\n')
);

const buildSmartCellPreviewText = (value: unknown) => normalizeCellText(value)
  .replace(/\s*\n\s*/g, ' / ')
  .replace(/\s{2,}/g, ' ')
  .trim();

const parseSourceRowsFromRange = (sourceRange: string) => {
  const matches = [...String(sourceRange || '').matchAll(/[A-Z]+(\d+)/gi)];
  if (matches.length === 0) return [] as number[];
  const rowNumbers = matches
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (rowNumbers.length === 0) return [] as number[];
  const startRow = Math.min(...rowNumbers);
  const endRow = Math.max(...rowNumbers);
  if (endRow - startRow > 500) {
    return [startRow];
  }
  return Array.from({ length: endRow - startRow + 1 }, (_, index) => startRow + index);
};

const buildSourceRangeFromRows = (rawRow: Record<string, string>, rowNumbers: number[]) => {
  if (rowNumbers.length === 0) return '';
  const sortedRows = [...new Set(rowNumbers)].sort((left, right) => left - right);
  const columnRefs = Object.keys(rawRow || {}).filter((key) => /^[A-Z]+$/.test(key));
  if (columnRefs.length === 0) {
    return `A${sortedRows[0]}:A${sortedRows[sortedRows.length - 1]}`;
  }
  const columnIndexes = columnRefs.map((ref) => columnRefToIndex(ref));
  const startColumn = columnIndexToRef(Math.min(...columnIndexes));
  const endColumn = columnIndexToRef(Math.max(...columnIndexes));
  return `${startColumn}${sortedRows[0]}:${endColumn}${sortedRows[sortedRows.length - 1]}`;
};

const collectImagesForRows = (imagesByRow: Map<number, StandardFilePayload[]>, rowNumbers: number[]) => {
  const deduped = new Map<string, StandardFilePayload>();
  rowNumbers.forEach((rowNumber) => {
    (imagesByRow.get(rowNumber) || []).forEach((image) => {
      const key = `${image.id || ''}|${image.name || ''}|${image.url || ''}|${image.createdAt || ''}`;
      if (!deduped.has(key)) {
        deduped.set(key, image);
      }
    });
  });
  return Array.from(deduped.values());
};

const buildMergedRawRowSnapshot = (matrix: any[][], rowNumbers: number[]) => {
  const merged: Record<string, string> = {};
  rowNumbers.forEach((rowNumber) => {
    const row = Array.isArray(matrix[rowNumber - 1]) ? matrix[rowNumber - 1] : [];
    mergeRowSnapshot(merged, buildPopulatedRowSnapshot(row));
  });
  return merged;
};

const countMeaningfulRows = (matrix: any[][], imagesByRow: Map<number, StandardFilePayload[]>) => {
  let count = 0;
  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
    const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
    const hasText = row.some((cell) => normalizeCellText(cell));
    const hasImages = (imagesByRow.get(rowIndex + 1) || []).length > 0;
    if (hasText || hasImages) {
      count += 1;
    }
  }
  return count;
};

const getSheetUsedBounds = (
  matrix: any[][],
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>,
  imagesByRow: Map<number, StandardFilePayload[]>
) => {
  let startRowIndex = Number.MAX_SAFE_INTEGER;
  let endRowIndex = -1;
  let maxColumnIndex = 0;

  matrix.forEach((row, rowIndex) => {
    const actualRow = Array.isArray(row) ? row : [];
    let rowHasText = false;
    actualRow.forEach((cell, columnIndex) => {
      if (normalizeCellText(cell)) {
        rowHasText = true;
        maxColumnIndex = Math.max(maxColumnIndex, columnIndex);
      }
    });
    if (rowHasText) {
      startRowIndex = Math.min(startRowIndex, rowIndex);
      endRowIndex = Math.max(endRowIndex, rowIndex);
    }
  });

  merges.forEach((merge) => {
    startRowIndex = Math.min(startRowIndex, merge.s.r);
    endRowIndex = Math.max(endRowIndex, merge.e.r);
    maxColumnIndex = Math.max(maxColumnIndex, merge.e.c);
  });

  imagesByRow.forEach((images, rowNumber) => {
    if (images.length > 0) {
      startRowIndex = Math.min(startRowIndex, rowNumber - 1);
      endRowIndex = Math.max(endRowIndex, rowNumber - 1);
    }
  });

  if (startRowIndex === Number.MAX_SAFE_INTEGER) {
    startRowIndex = 0;
    endRowIndex = Math.max(0, matrix.length - 1);
  }

  return {
    startRowIndex,
    endRowIndex,
    maxColumnIndex
  };
};

const drawWrappedCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  lineHeight = 15
) => {
  const normalized = normalizeCellText(text);
  if (!normalized || maxWidth <= 4 || maxHeight <= 4) return;

  const paragraphs = normalized.split('\n');
  const wrappedLines: string[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (!paragraph) {
      wrappedLines.push('');
      return;
    }
    let currentLine = '';
    Array.from(paragraph).forEach((char) => {
      const nextLine = `${currentLine}${char}`;
      if (currentLine && ctx.measureText(nextLine).width > maxWidth) {
        wrappedLines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = nextLine;
      }
    });
    if (currentLine) {
      wrappedLines.push(currentLine);
    }
    if (paragraphIndex < paragraphs.length - 1) {
      wrappedLines.push('');
    }
  });

  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  wrappedLines.slice(0, maxLines).forEach((line, index) => {
    let displayLine = line;
    if (index === maxLines - 1 && wrappedLines.length > maxLines) {
      while (displayLine && ctx.measureText(`${displayLine}...`).width > maxWidth) {
        displayLine = displayLine.slice(0, -1);
      }
      displayLine = `${displayLine}...`;
    }
    ctx.fillText(displayLine, x, y + index * lineHeight);
  });
};

const createSheetSnapshotDataUrls = ({
  sheetName,
  matrix,
  merges,
  imagesByRow,
  rowsPerSnapshot,
  maxColumns
}: {
  sheetName: string;
  matrix: any[][];
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
  imagesByRow: Map<number, StandardFilePayload[]>;
  rowsPerSnapshot: number;
  maxColumns: number;
}) => {
  if (typeof document === 'undefined') {
    return [] as string[];
  }

  const { startRowIndex, endRowIndex, maxColumnIndex } = getSheetUsedBounds(matrix, merges, imagesByRow);
  const columnCount = Math.max(1, Math.min(maxColumnIndex + 1, maxColumns));
  const windows: Array<{ startRowIndex: number; endRowIndex: number }> = [];

  for (let current = startRowIndex; current <= endRowIndex; current += rowsPerSnapshot) {
    windows.push({
      startRowIndex: current,
      endRowIndex: Math.min(endRowIndex, current + rowsPerSnapshot - 1)
    });
  }

  return windows.map((windowRange, pageIndex) => {
    const rowCount = windowRange.endRowIndex - windowRange.startRowIndex + 1;
    const deviceScale = 2;
    const titleHeight = 54;
    const columnHeaderHeight = 28;
    const rowHeaderWidth = 60;
    const rowHeight = 54;
    const padding = 12;
    const maxCanvasWidth = 2100;
    const cellWidth = Math.max(
      120,
      Math.min(220, Math.floor((maxCanvasWidth - rowHeaderWidth - padding * 2) / columnCount))
    );
    const logicalWidth = rowHeaderWidth + padding * 2 + columnCount * cellWidth;
    const logicalHeight = titleHeight + columnHeaderHeight + padding * 2 + rowCount * rowHeight;
    const canvas = document.createElement('canvas');
    canvas.width = logicalWidth * deviceScale;
    canvas.height = logicalHeight * deviceScale;

    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.scale(deviceScale, deviceScale);

    ctx.fillStyle = '#0b0b0f';
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    ctx.fillStyle = '#e5e7eb';
    ctx.font = '600 18px sans-serif';
    ctx.fillText(`${sheetName}  Page ${pageIndex + 1}/${windows.length}`, padding, 24);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px sans-serif';
    ctx.fillText(`Rows ${windowRange.startRowIndex + 1}-${windowRange.endRowIndex + 1}`, padding, 42);

    const anchorMap = new Map<string, { rowSpan: number; colSpan: number }>();
    const coveredCells = new Set<string>();
    merges.forEach((merge) => {
      if (
        merge.s.r < windowRange.startRowIndex
        || merge.s.r > windowRange.endRowIndex
        || merge.s.c >= columnCount
      ) {
        return;
      }
      const rowSpan = Math.min(merge.e.r, windowRange.endRowIndex) - merge.s.r + 1;
      const colSpan = Math.min(merge.e.c, columnCount - 1) - merge.s.c + 1;
      if (rowSpan <= 0 || colSpan <= 0) return;
      anchorMap.set(`${merge.s.r}:${merge.s.c}`, { rowSpan, colSpan });
      for (let rowIndex = merge.s.r; rowIndex <= Math.min(merge.e.r, windowRange.endRowIndex); rowIndex += 1) {
        for (let columnIndex = merge.s.c; columnIndex <= Math.min(merge.e.c, columnCount - 1); columnIndex += 1) {
          if (rowIndex === merge.s.r && columnIndex === merge.s.c) continue;
          coveredCells.add(`${rowIndex}:${columnIndex}`);
        }
      }
    });

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const x = padding + rowHeaderWidth + columnIndex * cellWidth;
      ctx.fillStyle = '#111827';
      ctx.fillRect(x, titleHeight, cellWidth, columnHeaderHeight);
      ctx.strokeStyle = '#374151';
      ctx.strokeRect(x, titleHeight, cellWidth, columnHeaderHeight);
      ctx.fillStyle = '#93c5fd';
      ctx.font = '600 12px sans-serif';
      ctx.fillText(columnIndexToRef(columnIndex), x + 8, titleHeight + 18);
    }

    for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
      const rowIndex = windowRange.startRowIndex + rowOffset;
      const rowNumber = rowIndex + 1;
      const rowY = titleHeight + columnHeaderHeight + rowOffset * rowHeight;
      const rowImages = imagesByRow.get(rowNumber) || [];
      const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];

      ctx.fillStyle = rowOffset % 2 === 0 ? '#111827' : '#0f172a';
      ctx.fillRect(padding, rowY, rowHeaderWidth, rowHeight);
      ctx.strokeStyle = '#374151';
      ctx.strokeRect(padding, rowY, rowHeaderWidth, rowHeight);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '600 12px sans-serif';
      ctx.fillText(String(rowNumber), padding + 8, rowY + 18);
      if (rowImages.length > 0) {
        ctx.fillStyle = '#fb923c';
        ctx.font = '600 11px sans-serif';
        ctx.fillText(`Img x${rowImages.length}`, padding + 8, rowY + 36);
      }

      for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        if (coveredCells.has(`${rowIndex}:${columnIndex}`)) {
          continue;
        }

        const merge = anchorMap.get(`${rowIndex}:${columnIndex}`);
        const rowSpan = merge?.rowSpan ?? 1;
        const colSpan = merge?.colSpan ?? 1;
        const x = padding + rowHeaderWidth + columnIndex * cellWidth;
        const cellY = rowY;
        const width = colSpan * cellWidth;
        const height = rowSpan * rowHeight;

        ctx.fillStyle = merge ? '#1f2937' : (rowOffset % 2 === 0 ? '#0f172a' : '#111827');
        ctx.fillRect(x, cellY, width, height);
        ctx.strokeStyle = '#334155';
        ctx.strokeRect(x, cellY, width, height);

        const cellText = normalizeCellText(row[columnIndex]);
        if (!cellText) continue;

        ctx.fillStyle = '#f8fafc';
        ctx.font = merge ? '600 12px sans-serif' : '12px sans-serif';
        drawWrappedCanvasText(ctx, cellText, x + 8, cellY + 18, width - 14, height - 12);
      }
    }

    return canvas.toDataURL('image/png', 0.92);
  }).filter(Boolean);
};

const extractJsonPayloadFromText = (value: string) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('Smart table parsing returned empty content');
  }

  const candidates: string[] = [];
  const codeBlockMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    candidates.push(codeBlockMatch[1].trim());
  }
  candidates.push(normalized);

  const firstBrace = normalized.indexOf('{');
  const lastBrace = normalized.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(normalized.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = normalized.indexOf('[');
  const lastBracket = normalized.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(normalized.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of Array.from(new Set(candidates.filter(Boolean)))) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return { tasks: parsed };
      }
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
    }
  }

  throw new Error('Smart table parsing did not return valid JSON');
};

const getSmartTaskCandidates = (payload: any) => {
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  if (Array.isArray(payload?.data?.tasks)) return payload.data.tasks;
  if (Array.isArray(payload?.result?.tasks)) return payload.result.tasks;
  if (Array.isArray(payload)) return payload;
  return [] as any[];
};

const buildSmartSheetPrompt = ({
  fileName,
  sheetName,
  matrix,
  merges,
  imagesByRow,
  effectiveConfig
}: {
  fileName: string;
  sheetName: string;
  matrix: any[][];
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
  imagesByRow: Map<number, StandardFilePayload[]>;
  effectiveConfig: EffectiveTableParseConfig;
}) => {
  const headerRowIndex = detectSheetHeaderRowIndex(matrix);
  const detectionStartRowIndex = Math.max(
    0,
    Math.min(effectiveConfig.headerRow, effectiveConfig.dataStartRow) - 1
  );
  const idColumnDetection = detectSheetIdColumn(matrix, effectiveConfig, detectionStartRowIndex, matrix.length);
  const detectedStartRowIndex = findFirstSerialRowIndex(
    matrix,
    idColumnDetection.columnRef,
    detectionStartRowIndex,
    matrix.length
  );

  const rowLines = matrix
    .map((row, rowIndex) => {
      const snapshot = buildPopulatedRowSnapshot(Array.isArray(row) ? row : []);
      const imageCount = (imagesByRow.get(rowIndex + 1) || []).length;
      const entries = Object.entries(snapshot)
        .sort((left, right) => columnRefToIndex(left[0]) - columnRefToIndex(right[0]))
        .map(([column, value]) => `${column}=${buildSmartCellPreviewText(value)}`)
        .filter((entry) => entry && !entry.endsWith('='));
      if (entries.length === 0 && imageCount === 0) {
        return '';
      }
      return `- Row ${rowIndex + 1} | ${entries.join(' | ')}${imageCount > 0 ? ` | embedded_images=${imageCount}` : ''}`;
    })
    .filter(Boolean)
    .join('\n');

  const mergeLines = merges.length > 0
    ? merges.map((merge) => {
      const topLeftRow = Array.isArray(matrix[merge.s.r]) ? matrix[merge.s.r] : [];
      const topLeftText = buildSmartCellPreviewText(topLeftRow[merge.s.c]);
      return `- ${columnIndexToRef(merge.s.c)}${merge.s.r + 1}:${columnIndexToRef(merge.e.c)}${merge.e.r + 1}${topLeftText ? ` | ${topLeftText}` : ''}`;
    }).join('\n')
    : 'None';

  const imageRows = Array.from(imagesByRow.entries())
    .filter(([, images]) => images.length > 0)
    .map(([rowNumber, images]) => `- Row ${rowNumber}: ${images.length} embedded images`)
    .join('\n') || 'None';

  const notesSection = effectiveConfig.smartParseNotes
    ? `\nExtra notes:\n${effectiveConfig.smartParseNotes}\n`
    : '';

  return [
    `File: ${fileName}`,
    `Sheet: ${sheetName}`,
    '',
    'Use both the screenshot pages and the structured sheet data below to identify the real creative tasks in this sheet.',
    'Rules:',
    '1. If a visible serial number exists, split tasks by that serial number and do not skip any task.',
    '2. If there is no visible serial number, split by visually independent task blocks instead of helper notes.',
    '3. requirementZh must keep the original Chinese text exactly as it appears in the workbook.',
    '4. textLayers should contain only on-image copy, otherwise return an empty array.',
    '5. sourceRange and sourceRows should be as accurate as possible, and tasks must stay in top-to-bottom order.',
    '6. Unknown fields should be empty strings or empty arrays. Do not hallucinate.',
    '',
    'Return strict JSON with this shape:',
    '{',
    '  "sheetName": "sheet name",',
    '  "tasks": [',
    '    {',
    '      "serialNo": "1",',
    '      "size": "",',
    '      "requirementZh": "full Chinese requirement text",',
    '      "referenceText": "",',
    '      "textLayers": ["copy 1", "copy 2"],',
    '      "sourceRange": "A5:G8",',
    '      "sourceRows": [5, 6, 7, 8],',
    '      "confidence": 0.95',
    '    }',
    '  ]',
    '}',
    notesSection,
    'Heuristics:',
    `- probable_header_row: ${headerRowIndex >= 0 ? `Row ${headerRowIndex + 1}` : 'unknown'}`,
    `- probable_serial_column: ${idColumnDetection.columnRef || 'unknown'}`,
    `- probable_first_task_row: ${detectedStartRowIndex >= 0 ? `Row ${detectedStartRowIndex + 1}` : 'unknown'}`,
    '',
    'Merged ranges:',
    mergeLines,
    '',
    'Embedded image rows:',
    imageRows,
    '',
    'Structured rows:',
    rowLines || 'None'
  ].join('\n');
};
const normalizeSmartTaskCandidate = ({
  candidate,
  index,
  sheetName,
  matrix,
  imagesByRow
}: {
  candidate: any;
  index: number;
  sheetName: string;
  matrix: any[][];
  imagesByRow: Map<number, StandardFilePayload[]>;
}) => {
  const sourceRange = normalizeSmartFieldText(candidate?.sourceRange);

  const sourceRowCandidates = (
    Array.isArray(candidate?.sourceRows)
      ? candidate.sourceRows
      : parseSourceRowsFromRange(sourceRange)
  )
    .map((value: unknown) => Number(value))
    .filter((value): value is number => Number.isFinite(value) && value > 0);
  const sourceRows: number[] = Array.from(new Set<number>(sourceRowCandidates))
    .sort((left, right) => left - right);

  const rowNumber = sourceRows[0]
    || Math.max(1, Number(candidate?.rowNumber || candidate?.source?.rowNumber || index + 1));
  const serialNo = normalizeSmartFieldText(candidate?.serialNo) || String(index + 1);
  const size = normalizeSmartFieldText(candidate?.size);
  const referenceText = normalizeSmartFieldText(candidate?.referenceText ?? candidate?.reference);
  const textLayers = normalizeSmartFieldList(candidate?.textLayers);
  const rawRow = buildMergedRawRowSnapshot(matrix, sourceRows.length > 0 ? sourceRows : [rowNumber]);
  const images = collectImagesForRows(imagesByRow, sourceRows.length > 0 ? sourceRows : [rowNumber]);
  const fallbackRequirement = buildFallbackRequirementFromRawRow(rawRow, serialNo, size);
  const requirementZh = normalizeSmartFieldText(
    candidate?.requirementZh ?? candidate?.requirement ?? candidate?.description
  ) || fallbackRequirement;
  const confidenceRaw = Number(candidate?.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : undefined;
  const resolvedSourceRows = sourceRows.length > 0 ? sourceRows : [rowNumber];

  if (!requirementZh && !referenceText && textLayers.length === 0 && images.length === 0) {
    return null;
  }

  return withResolvedTaskVisualSpec({
    taskId: `${sheetName}-${serialNo}-${rowNumber}`,
    rowNumber,
    serialNo,
    size,
    requirementZh,
    referenceText,
    textLayers,
    referenceImages: [...images],
    embeddedImages: [...images],
    parseMode: 'smart' as const,
    confidence,
    sourceRange: sourceRange || buildSourceRangeFromRows(rawRow, resolvedSourceRows),
    sourceRows: resolvedSourceRows,
    source: {
      sheetName,
      rowNumber
    },
    rawRow
  } satisfies SpreadsheetParseTask);
};

const parseSmartSheetTasks = async ({
  fileName,
  sheetName,
  sheet,
  matrix,
  imagesByRow,
  effectiveConfig,
  apiSettings,
  modelId
}: {
  fileName: string;
  sheetName: string;
  sheet: any;
  matrix: any[][];
  imagesByRow: Map<number, StandardFilePayload[]>;
  effectiveConfig: EffectiveTableParseConfig;
  apiSettings: TableParseApiSettings;
  modelId: string;
}) => {
  const service = new AIService();
  const merges = (Array.isArray(sheet?.['!merges']) ? sheet['!merges'] : []) as Array<{
    s: { r: number; c: number };
    e: { r: number; c: number };
  }>;
  const snapshotImages = createSheetSnapshotDataUrls({
    sheetName,
    matrix,
    merges,
    imagesByRow,
    rowsPerSnapshot: effectiveConfig.smartRowsPerSnapshot,
    maxColumns: effectiveConfig.smartMaxColumns
  });
  const prompt = buildSmartSheetPrompt({
    fileName,
    sheetName,
    matrix,
    merges,
    imagesByRow,
    effectiveConfig
  });

  const response = await service.executeNode(
    `table-smart-${Date.now()}-${sheetName}`,
    'AI_CHAT',
    {
      modelId,
      systemInstruction: SMART_TABLE_PARSE_SYSTEM_INSTRUCTION
    },
    {
      prompt,
      image: snapshotImages
    },
    apiSettings
  );

  const parsedPayload = extractJsonPayloadFromText(String(response.output || ''));
  const tasks = getSmartTaskCandidates(parsedPayload)
    .map((candidate, index) => normalizeSmartTaskCandidate({
      candidate,
      index,
      sheetName,
      matrix,
      imagesByRow
    }))
    .filter((task): task is SpreadsheetParseTask => !!task);

  const coveredRows = new Set<number>();
  tasks.forEach((task) => {
    (task.sourceRows?.length ? task.sourceRows : [task.rowNumber]).forEach((rowNumber) => {
      if (Number.isFinite(rowNumber) && rowNumber > 0) {
        coveredRows.add(rowNumber);
      }
    });
  });

  const warnings = normalizeSmartFieldList(parsedPayload?.warnings);
  return {
    tasks,
    warnings,
    meaningfulRows: countMeaningfulRows(matrix, imagesByRow),
    coveredRows: coveredRows.size
  };
};

const parseSpreadsheetOutputSmart = async (
  payload: StandardFilePayload,
  effectiveConfig: EffectiveTableParseConfig,
  apiSettings: TableParseApiSettings,
  modelId: string
): Promise<SpreadsheetParseOutput> => {
  if (!isSpreadsheetPayload(payload)) {
    throw new Error('Please upload an Excel or CSV file');
  }

  const buffer = await readSpreadsheetArrayBuffer(payload);
  const workbook = XLSX.read(buffer, { type: 'array', bookFiles: true });
  const warnings: string[] = [];
  const requestedSheet = effectiveConfig.sheetName.trim();
  const normalizedRequestedSheet = requestedSheet.toLowerCase();
  const parseAllSheets = !requestedSheet || normalizedRequestedSheet === 'auto' || normalizedRequestedSheet === 'all' || requestedSheet === '*';
  const resolvedSheetNames = parseAllSheets
    ? workbook.SheetNames.filter(Boolean)
    : (workbook.Sheets[requestedSheet] ? [requestedSheet] : [workbook.SheetNames[0]].filter(Boolean));

  if (resolvedSheetNames.length === 0) {
    throw new Error('表格中未找到可解析的工作表');
  }

  if (!parseAllSheets && requestedSheet !== resolvedSheetNames[0]) {
    warnings.push(`未找到工作表“${requestedSheet}”，已自动回退到“${resolvedSheetNames[0]}”。`);
  }

  const targetSheetNames = effectiveConfig.smartMaxSheets > 0
    ? resolvedSheetNames.slice(0, effectiveConfig.smartMaxSheets)
    : resolvedSheetNames;

  if (targetSheetNames.length < resolvedSheetNames.length) {
    warnings.push(`Smart parsing only processed the first ${targetSheetNames.length} sheet(s). Remaining sheets were skipped.`);
  }

  const tasks: SpreadsheetParseTask[] = [];
  let totalRows = 0;
  let skippedRows = 0;

  for (const sheetName of targetSheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
    const { imagesByRow, warnings: imageWarnings } = effectiveConfig.extractEmbeddedImages
      ? extractEmbeddedImagesByRow((workbook as any).files, sheetName)
      : { imagesByRow: new Map<number, StandardFilePayload[]>(), warnings: [] as string[] };

    warnings.push(...imageWarnings.map((warning) => `Sheet "${sheetName}": ${warning}`));
    totalRows += matrix.length;

    const parsed = await parseSmartSheetTasks({
      fileName: payload.name,
      sheetName,
      sheet,
      matrix,
      imagesByRow,
      effectiveConfig,
      apiSettings,
      modelId
    });

    if (parsed.tasks.length === 0 && parsed.meaningfulRows > 0) {
      warnings.push(`Sheet "${sheetName}" has content but smart parsing did not identify any task.`);
    }

    tasks.push(...parsed.tasks);
    warnings.push(...parsed.warnings.map((warning) => `Sheet "${sheetName}": ${warning}`));
    skippedRows += Math.max(0, parsed.meaningfulRows - parsed.coveredRows);
  }

  sortSpreadsheetTasks(tasks, targetSheetNames);

  return {
    runId: `sheet-smart-${Date.now()}`,
    fileName: payload.name,
    sheetName: getSpreadsheetSummarySheetName(targetSheetNames),
    sheetNames: targetSheetNames,
    sheetCount: targetSheetNames.length,
    taskCount: tasks.length,
    totalRows,
    skippedRows,
    warnings,
    parseMode: 'smart',
    parseModelId: modelId,
    tasks
  };
};

const parseSpreadsheetOutput = async (
  payload: StandardFilePayload,
  config: NodeData['config'],
  options?: {
    apiSettings?: TableParseApiSettings;
    availableChatModels?: string[];
    preferredChatModelId?: string;
  }
): Promise<SpreadsheetParseOutput> => {
  const effectiveConfig = getEffectiveTableParseConfig(config);

  if (effectiveConfig.parseMode === 'standard') {
    return parseSpreadsheetOutputStandard(payload, effectiveConfig);
  }

  const resolvedSmartModelId = normalizeCellText(
    options?.preferredChatModelId || effectiveConfig.smartModelId || options?.availableChatModels?.[0] || ''
  );
  if (!options?.apiSettings || !options.apiSettings.apiKey || !options.apiSettings.baseUrl || !resolvedSmartModelId) {
    if (effectiveConfig.parseMode === 'auto') {
      const fallback = await parseSpreadsheetOutputStandard(payload, effectiveConfig);
      fallback.warnings.unshift('Smart parsing is not fully configured, so it fell back to standard parsing.');
      return fallback;
    }
    if (!resolvedSmartModelId) {
      throw new Error('Smart parsing mode requires a chat model');
    }
    throw new Error('Smart parsing mode requires a valid API provider');
  }

  try {
    const smartOutput = await parseSpreadsheetOutputSmart(
      payload,
      effectiveConfig,
      options.apiSettings,
      resolvedSmartModelId
    );
    if (effectiveConfig.parseMode === 'auto' && smartOutput.taskCount === 0) {
      const fallback = await parseSpreadsheetOutputStandard(payload, effectiveConfig);
      fallback.warnings.unshift('Smart parsing found no task, so it fell back to standard parsing.');
      return fallback;
    }
    return smartOutput;
  } catch (error: any) {
    if (effectiveConfig.parseMode === 'auto') {
      const fallback = await parseSpreadsheetOutputStandard(payload, effectiveConfig);
      fallback.warnings.unshift(`Smart parsing failed and fell back to standard parsing: ${error?.message || "Unknown error"}`);
      return fallback;
    }
    throw error;
  }
};

const getNodePrimaryOutput = (node?: Node<NodeData>) => {
  if (!node || node.data.isSkipped) return undefined;
  if (node.type === NodeType.INPUT) {
    const text = node.data.config.prompt;
    return typeof text === 'string' ? text : '';
  }
  return node.data.output;
};

const getValueFromSourceHandle = (
  sourceOutput: any,
  sourceMeta: any,
  sourceHandle?: string | null
) => {
  if (!sourceHandle) return sourceOutput;

  if (sourceHandle === 'prompt') {
    if (typeof sourceOutput === 'string') return sourceOutput;
    if (sourceOutput && typeof sourceOutput === 'object' && typeof sourceOutput.prompt === 'string') {
      return sourceOutput.prompt;
    }
    return undefined;
  }

  if (sourceHandle === 'image') {
    if (sourceOutput && typeof sourceOutput === 'object') {
      if (isCanonicalImageResult(sourceOutput)) {
        const urls = getAllImageUrls(sourceOutput);
        if (urls.length > 1) return urls;
        if (urls.length === 1) return urls[0];
      }
      if (Array.isArray(sourceOutput.image)) return sourceOutput.image;
      if (Array.isArray(sourceOutput.images)) return sourceOutput.images;
      if (sourceOutput.image && typeof sourceOutput.image === 'object') return sourceOutput.image;
      if (Array.isArray(sourceOutput.referenceImages)) return sourceOutput.referenceImages;
      if (Array.isArray(sourceOutput.embeddedImages)) return sourceOutput.embeddedImages;
      if ('type' in sourceOutput && 'source' in sourceOutput) return sourceOutput;
    }
    return sourceMeta?.forwardedImages;
  }

  if (sourceHandle === 'task') {
    if (sourceOutput && typeof sourceOutput === 'object' && 'task' in sourceOutput) {
      return sourceOutput.task;
    }
    return sourceOutput;
  }

  if (sourceHandle === 'style') {
    if (typeof sourceOutput === 'string') return sourceOutput;
    if (sourceOutput && typeof sourceOutput === 'object') {
      if (typeof sourceOutput.stylePrompt === 'string') return sourceOutput.stylePrompt;
      if (typeof sourceOutput.prompt === 'string') return sourceOutput.prompt;
      if (typeof sourceOutput.summary === 'string') return sourceOutput.summary;
    }
    if (typeof sourceMeta?.stylePrompt === 'string') return sourceMeta.stylePrompt;
    if (typeof sourceMeta?.optimizedPrompt === 'string') return sourceMeta.optimizedPrompt;
    return undefined;
  }

  return sourceOutput;
};

const getInputMergeIdentity = (value: unknown) => {
  if (typeof value === 'string') return `str:${value}`;
  if (isStandardFilePayload(value)) {
    return `file:${value.id || value.url || value.name || value.createdAt}`;
  }
  if (value && typeof value === 'object') {
    try {
      return `obj:${JSON.stringify(value)}`;
    } catch {
      return `obj:${String(value)}`;
    }
  }
  return String(value);
};

const mergeStructuredInputValue = (key: string, currentValue: any, nextValue: any) => {
  if (nextValue === undefined) {
    return currentValue;
  }

  if (key !== 'image' || currentValue === undefined) {
    return nextValue;
  }

  const mergedList = [
    ...(Array.isArray(currentValue) ? currentValue : [currentValue]),
    ...(Array.isArray(nextValue) ? nextValue : [nextValue])
  ].filter((item) => {
    if (item === undefined || item === null) return false;
    if (typeof item === 'string') return item.trim().length > 0;
    return true;
  });

  if (mergedList.length === 0) {
    return undefined;
  }

  const uniqueItems = new Map<string, any>();
  mergedList.forEach((item) => {
    const identity = getInputMergeIdentity(item);
    if (!uniqueItems.has(identity)) {
      uniqueItems.set(identity, item);
    }
  });

  const deduped = Array.from(uniqueItems.values());
  return deduped.length === 1 ? deduped[0] : deduped;
};

const NODE_TO_MODEL_MODALITY: Partial<Record<NodeType, ModelModality>> = {
  [NodeType.AI_CHAT]: 'chat',
  [NodeType.PRODUCT_IMAGE_MATCH]: 'chat',
  [NodeType.AI_IMAGE]: 'image',
  [NodeType.AI_AUDIO]: 'audio',
  [NodeType.AI_VIDEO]: 'video'
};

const getModalityForNodeType = (type?: NodeType | string | null): ModelModality => (
  NODE_TO_MODEL_MODALITY[type as NodeType] || 'chat'
);

const getActiveProviderForModality = (
  providers: APIProvider[],
  activeProviderIds: Partial<Record<ModelModality, string>> | undefined,
  fallbackProviderId: string | null | undefined,
  modality: ModelModality
) => (
  providers.find((provider) => provider.id === activeProviderIds?.[modality])
  || providers.find((provider) => provider.id === fallbackProviderId)
  || providers[0]
);

const getActiveProviderForNodeType = (
  providers: APIProvider[],
  activeProviderIds: Partial<Record<ModelModality, string>> | undefined,
  fallbackProviderId: string | null | undefined,
  type?: NodeType | string | null
) => getActiveProviderForModality(providers, activeProviderIds, fallbackProviderId, getModalityForNodeType(type));

const DEFAULT_NODE_LABELS: Partial<Record<NodeType, string>> = {
  [NodeType.INPUT]: '输入文本',
  [NodeType.FILE_UPLOAD]: '文件上传',
  [NodeType.TABLE_PARSE]: '表格解析',
  [NodeType.IMAGE_UPLOAD]: '图片上传',
  [NodeType.MULTI_IMAGE_UPLOAD]: '多图上传',
  [NodeType.AI_CHAT]: '智能对话',
  [NodeType.AI_IMAGE]: '图像生成',
  [NodeType.AI_AUDIO]: '语音合成',
  [NodeType.AI_VIDEO]: '视频生成',
  [NodeType.OUTPUT]: '结果输出',
  [NodeType.GROUP]: '视觉分组'
};

DEFAULT_NODE_LABELS[NodeType.TASK_SELECT] = '任务选择';
DEFAULT_NODE_LABELS[NodeType.BATCH_EXECUTE] = '批量执行';
DEFAULT_NODE_LABELS[NodeType.STYLE_GUIDE] = '风格控制';
DEFAULT_NODE_LABELS[NodeType.PRODUCT_IMAGE_MATCH] = '产品图筛选';

const DEFAULT_NODE_DIMENSIONS: Partial<Record<NodeType, { width: number; height: number }>> = {
  [NodeType.INPUT]: { width: 320, height: 220 },
  [NodeType.IMAGE_UPLOAD]: { width: 320, height: 240 },
  [NodeType.MULTI_IMAGE_UPLOAD]: { width: 340, height: 280 },
  [NodeType.FILE_UPLOAD]: { width: 360, height: 280 },
  [NodeType.TABLE_PARSE]: { width: 560, height: 860 },
  [NodeType.TASK_SELECT]: { width: 380, height: 620 },
  [NodeType.BATCH_EXECUTE]: { width: 460, height: 720 },
  [NodeType.STYLE_GUIDE]: { width: 460, height: 760 },
  [NodeType.PRODUCT_IMAGE_MATCH]: { width: 420, height: 700 },
  [NodeType.AI_CHAT]: { width: 340, height: 240 },
  [NodeType.AI_IMAGE]: { width: 360, height: 360 },
  [NodeType.AI_AUDIO]: { width: 340, height: 220 },
  [NodeType.AI_VIDEO]: { width: 360, height: 260 },
  [NodeType.OUTPUT]: { width: 320, height: 220 },
  [NodeType.GROUP]: { width: 600, height: 400 }
};

export const useStore = create<CanvasState>((set, get) => ({
  nodes: [
    {
      id: 'default-input-node',
      type: 'INPUT',
      position: { x: 240, y: 20 },
      style: { ...(DEFAULT_NODE_DIMENSIONS[NodeType.INPUT] || { width: 300, height: 200 }) },
      data: {
        label: '输入文本',
        type: NodeType.INPUT,
        status: 'idle',
        isSkipped: false,
        config: { prompt: '', modelId: '' }
      },
    },
    {
      id: 'default-upload-node',
      type: 'MULTI_IMAGE_UPLOAD',
      position: { x: 300, y: 300 },
      style: { width: 340, height: 280 },
      data: {
        label: '多图上传',
        type: NodeType.MULTI_IMAGE_UPLOAD,
        status: 'idle',
        isSkipped: false,
        config: {
          prompt: '',
          modelId: ''
        }
      },
    },
    {
      id: 'default-chat-node',
      type: 'AI_CHAT',
      position: { x: 760, y: 160 },
      style: { width: 340, height: 240 },
      data: {
        label: '智能对话',
        type: NodeType.AI_CHAT,
        status: 'idle',
        isSkipped: false,
        config: {
          prompt: '',
          systemInstruction: DEFAULT_CHAT_PROMPT_TEMPLATE?.content || '',
          modelId: DEFAULT_GLOBAL_ACTIVE_MODELS.chat || ''
        }
      },
    },
    {
      id: 'default-image-node',
      type: 'AI_IMAGE',
      position: { x: 1220, y: 180 },
      style: { width: 360, height: 360 },
      data: {
        label: '图像生成',
        type: NodeType.AI_IMAGE,
        status: 'idle',
        isSkipped: false,
        config: {
          prompt: '',
          modelId: DEFAULT_GLOBAL_ACTIVE_MODELS.image || '',
          promptTemplate: 'free_mode',
          enablePromptTemplate: false
        }
      },
    },
  ],
  edges: [
    {
      type: 'soft',
      animated: false,
      style: {
        strokeWidth: 1.5,
        stroke: '#4f46e5'
      },
      source: 'default-input-node',
      sourceHandle: 'output',
      target: 'default-chat-node',
      targetHandle: 'prompt',
      id: 'default-edge-input-chat'
    },
    {
      type: 'soft',
      animated: false,
      style: {
        strokeWidth: 1.5,
        stroke: '#4f46e5'
      },
      source: 'default-upload-node',
      sourceHandle: 'output',
      target: 'default-chat-node',
      targetHandle: 'image',
      id: 'default-edge-upload-chat'
    },
    {
      type: 'soft',
      animated: false,
      style: {
        strokeWidth: 1.5,
        stroke: '#4f46e5'
      },
      source: 'default-chat-node',
      sourceHandle: null,
      target: 'default-image-node',
      targetHandle: 'prompt',
      id: 'default-edge-chat-image'
    },
    {
      type: 'soft',
      animated: false,
      style: {
        strokeWidth: 1.5,
        stroke: '#4f46e5'
      },
      source: 'default-upload-node',
      sourceHandle: 'output',
      target: 'default-image-node',
      targetHandle: 'image',
      id: 'default-edge-upload-image'
    }
  ],
  selectedNodeId: null,

  apiProviders: initialApiProviders,
  activeProviderId: initialActiveProviderId,
  activeProviderIds: initialActiveProviderIds,

  logs: [],
  notices: [],
  imageHistory: [],
  isWorkflowRunning: false,
  maxWorkflowConcurrency: MAX_WORKFLOW_CONCURRENCY,

  savedWorkflows: loadSavedWorkflows(),
  registeredModels: loadRegisteredModels(),

  // Security & Dev Actions
  isDevMode: localStorage.getItem('is_dev_mode') === 'true',
  unlockedNodeIds: new Set<string>(),
  isPromptVaultUnlocked: false,

  setDevMode: (active: boolean) => {
    localStorage.setItem('is_dev_mode', active.toString());
    set({ isDevMode: active });
  },

  setPromptVaultUnlocked: (active: boolean) => {
    set({ isPromptVaultUnlocked: active });
  },

  vaultNode: (id, passwordHash, hint) => {
    set(state => {
      const newUnlocked = new Set(state.unlockedNodeIds);
      newUnlocked.delete(id);
      return {
        nodes: state.nodes.map(node =>
          node.id === id
            ? {
              ...node,
              data: {
                ...node.data,
                security: { isLocked: true, passwordHash, hint }
              }
            }
            : node
        ),
        unlockedNodeIds: newUnlocked,
      };
    });
    const targetNode = get().nodes.find(n => n.id === id);
    get().addLog('warn', 'Stored node in vault and locked it.', {
      nodeId: id,
      nodeLabel: targetNode?.data.label
    });
  },

  unlockNode: (id, password) => {
    const node = get().nodes.find(n => n.id === id);
    if (node?.data.security?.isLocked && node.data.security.passwordHash === password) {
      const newUnlocked = new Set(get().unlockedNodeIds);
      newUnlocked.add(id);
      set({ unlockedNodeIds: newUnlocked });
      get().addLog('success', 'Vault password verified. Node unlocked for this session.', {
        nodeId: id,
        nodeLabel: node.data.label
      });
      return true;
    }
    get().addLog('error', 'Unlock failed: wrong password.', {
      nodeId: id,
      nodeLabel: node?.data.label
    });
    return false;
  },

  unvaultNode: (id) => {
    set(state => {
      const newUnlocked = new Set(state.unlockedNodeIds);
      newUnlocked.delete(id);
      return {
        nodes: state.nodes.map(node =>
          node.id === id
            ? {
              ...node,
              data: {
                ...node.data,
                security: undefined
              }
            }
            : node
        ),
        unlockedNodeIds: newUnlocked,
      };
    });
    const targetNode = get().nodes.find(n => n.id === id);
    get().addLog('info', 'Removed node from vault.', {
      nodeId: id,
      nodeLabel: targetNode?.data.label
    });
  },

  applyPromptTemplateToNode: (id, value) => {
    const node = get().nodes.find(n => n.id === id);
    if (!node) return;

    set(state => ({
      nodes: state.nodes.map(current =>
        current.id === id
          ? {
            ...current,
            data: {
              ...current.data,
              config: {
                ...current.data.config,
                systemInstruction: value
              }
            }
          }
          : current
      )
    }));

    get().addLog('info', 'Applied prompt template to node.', {
      nodeId: id,
      nodeLabel: node.data.label
    });
  },

  addLog: (level, message, meta) => {
    const newLog: LogEntry = {
      id: uuidv4(),
      level,
      message,
      timestamp: new Date().toLocaleTimeString(),
      nodeId: meta?.nodeId,
      nodeLabel: meta?.nodeLabel
    };
    set(state => ({ logs: [newLog, ...state.logs].slice(0, 50) }));
  },

  clearLogs: () => set({ logs: [] }),

  pushNotice: (level, message, durationMs = 3200) => {
    const notice: Notice = { id: uuidv4(), level, message };
    set((state) => ({ notices: [...state.notices, notice].slice(-4) }));
    setTimeout(() => {
      get().removeNotice(notice.id);
    }, durationMs);
  },

  removeNotice: (id) => {
    set((state) => ({ notices: state.notices.filter((item) => item.id !== id) }));
  },

  requestStopWorkflow: () => {
    stopExecutionRequested = true;
    activeNodeAbortControllers.forEach((controller) => controller.abort());
    activeNodeAbortControllers.clear();
    stopAllNodeProgress();
    get().addLog('warn', 'Stop requested. Execution will stop after the current node finishes.');
    get().pushNotice('warn', 'Stop requested. Current API requests are being cancelled...');
  },

  requestStopConcurrent: () => {
    stopExecutionRequested = true;
    activeNodeAbortControllers.forEach((controller) => controller.abort());
    activeNodeAbortControllers.clear();
    stopAllNodeProgress();
    get().addLog('warn', `Concurrent execution stop requested (limit ${MAX_WORKFLOW_CONCURRENCY}). Running tasks will finish but no new task will start.`);
    get().pushNotice('warn', 'Stop requested and queue paused. Current API requests are being cancelled...');
  },

  onNodesChange: (changes: NodeChange[]) => {
    changes.forEach((change) => {
      if (change.type === 'remove') {
        const node = get().nodes.find((n) => n.id === change.id);
        if (node) revokeNodeResources(node);
      }
    });
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection: Connection) => {
    set({
      edges: addEdge({
        ...connection,
        type: 'soft',
        animated: false,
        style: { strokeWidth: 1.5 }
      }, get().edges)
    });
  },

  removeEdge: (edgeId: string) => {
    const edge = get().edges.find((item) => item.id === edgeId);
    set({ edges: get().edges.filter((item) => item.id !== edgeId) });
    if (edge) {
      const sourceLabel = get().nodes.find((n) => n.id === edge.source)?.data.label || edge.source;
      const targetLabel = get().nodes.find((n) => n.id === edge.target)?.data.label || edge.target;
      get().addLog('info', `Disconnected: [${sourceLabel}] -> [${targetLabel}]`);
    }
  },

  onSelectionChange: (id: string | null) => {
    set({ selectedNodeId: id });
  },

  addProvider: (provider) => {
    const providers = [...get().apiProviders, normalizeApiProvider(provider)];
    localStorage.setItem('api_providers', JSON.stringify(providers));
    set({ apiProviders: providers });
    if (!get().activeProviderId) {
      get().setActiveProvider(providers[providers.length - 1].id);
    }
    get().addLog('success', `API provider added: ${providers[providers.length - 1].name}`);
  },

  updateProvider: (id, provider) => {
    const providers = get().apiProviders.map(p => p.id === id ? normalizeApiProvider({ ...p, ...provider }) : p);
    localStorage.setItem('api_providers', JSON.stringify(providers));
    set({ apiProviders: providers });
    get().addLog('info', `API provider updated: ${provider.name || id}`);
  },

  deleteProvider: (id) => {
    const providers = get().apiProviders.filter(p => p.id !== id);
    localStorage.setItem('api_providers', JSON.stringify(providers));
    let nextActiveId = get().activeProviderId;
    if (nextActiveId === id) {
      nextActiveId = providers[0]?.id || null;
      localStorage.setItem('active_provider_id', nextActiveId || '');
    }
    const nextActiveProviderIds = PROVIDER_MODALITIES.reduce<Partial<Record<ModelModality, string>>>((acc, modality) => {
      const currentId = get().activeProviderIds?.[modality];
      acc[modality] = currentId && currentId !== id
        ? currentId
        : (nextActiveId || providers[0]?.id || undefined);
      return acc;
    }, {});
    localStorage.setItem(ACTIVE_PROVIDER_IDS_STORAGE_KEY, JSON.stringify(nextActiveProviderIds));
    set({ apiProviders: providers, activeProviderId: nextActiveId, activeProviderIds: nextActiveProviderIds });
    get().addLog('warn', `API provider deleted. ID: ${id}`);
  },

  setActiveProvider: (id) => {
    localStorage.setItem('active_provider_id', id);
    const provider = get().apiProviders.find(p => p.id === id);
    const activeProviderIds = PROVIDER_MODALITIES.reduce<Partial<Record<ModelModality, string>>>((acc, modality) => {
      acc[modality] = id;
      return acc;
    }, {});
    localStorage.setItem(ACTIVE_PROVIDER_IDS_STORAGE_KEY, JSON.stringify(activeProviderIds));
    set({ activeProviderId: id, activeProviderIds });
    if (provider) get().addLog('info', `Active provider: ${provider.name}`);
  },

  setActiveProviderForModality: (modality, id) => {
    const provider = get().apiProviders.find(p => p.id === id);
    const activeProviderIds = { ...get().activeProviderIds, [modality]: id };
    localStorage.setItem(ACTIVE_PROVIDER_IDS_STORAGE_KEY, JSON.stringify(activeProviderIds));
    set({ activeProviderIds });
    if (provider) {
      const label = ({ chat: 'Chat/Reasoning', image: 'Image', audio: 'Audio', video: 'Video' } as const)[modality] || modality;
      get().addLog('info', `${label} provider: ${provider.name}`);
    }
  },

  importWorkflow: (nodes: Node<NodeData>[], edges: Edge[]) => {
    const normalized = normalizeWorkflowPayload({ nodes, edges });
    set({ nodes: normalized.nodes, edges: normalized.edges });
    get().addLog('success', 'Workflow imported successfully.');
  },

  saveWorkflow: (name: string) => {
    const { nodes, edges, savedWorkflows } = get();

    const workflowId = `wf-${Date.now()}`;
    const newWorkflow: SavedWorkflow = {
      id: workflowId,
      name: name || `鏈懡鍚嶅伐浣滄祦 ${new Date().toLocaleString()}`,
      timestamp: new Date().toLocaleString(),
      storage: 'idb'
    };

    try {
      const updated = [newWorkflow, ...savedWorkflows];
      persistWorkflowIndex(updated);
      set({ savedWorkflows: updated });
      get().addLog('info', `Saving workflow: ${newWorkflow.name}`);

      void saveWorkflowPayload(workflowId, { nodes, edges })
        .then(() => {
          get().addLog('success', `Workflow saved: ${newWorkflow.name}`);
          get().pushNotice('success', `Workflow saved: ${newWorkflow.name}`);
        })
        .catch((err) => {
          console.error('Failed to save workflow payload into indexedDB:', err);
          const fallbackWorkflow: SavedWorkflow = {
            ...newWorkflow,
            storage: 'local',
            nodes,
            edges
          };
          const fallbackUpdated = [fallbackWorkflow, ...savedWorkflows];
          try {
            saveLocalWorkflowPayload(workflowId, { nodes, edges });
            persistWorkflowIndex(fallbackUpdated);
            get().addLog('warn', 'IndexedDB unavailable, downgraded to localStorage.');

          } catch (fallbackErr) {
            console.error('Fallback save failed:', fallbackErr);
            deleteLocalWorkflowPayload(workflowId);
            const reverted = savedWorkflows;
            persistWorkflowIndex(reverted);
            get().addLog('error', 'Save failed: storage quota exceeded.');
            get().addLog('error', 'Save failed: storage quota exceeded.');
            get().pushNotice('error', 'Save failed: storage quota exceeded. Clear old workflows and try again.');
          }
        });
    } catch (err) {
      get().addLog('error', 'Save failed: unable to write workflow index.');
      get().addLog('error', 'Save failed: unable to write workflow index.');
      get().pushNotice('error', 'Save failed: unable to write workflow index.');
    }
  },

  cloneWorkflow: async (id: string, count = 1) => {
    const source = get().savedWorkflows.find((wf) => wf.id === id);
    if (!source) {
      get().pushNotice('error', 'Clone failed: source workflow not found.');
      return;
    }

    const safeCount = Math.max(1, Math.min(50, Math.floor(count || 1)));

    try {
      let payload: { nodes: Node<NodeData>[]; edges: Edge[] } | null = null;
      if (source.nodes && source.edges) {
        payload = { nodes: source.nodes, edges: source.edges };
      } else if (source.storage === 'local') {
        payload = loadLocalWorkflowPayload(source.id);
      } else {
        payload = await loadWorkflowPayload(source.id);
      }

      if (!payload) {
        get().pushNotice('error', 'Clone failed: workflow payload is missing.');
        return;
      }

      const existing = get().savedWorkflows;
      const takenNames = new Set(existing.map((wf) => wf.name));
      const now = Date.now();
      const copies: SavedWorkflow[] = [];

      for (let i = 0; i < safeCount; i += 1) {
        const copyId = `wf-${now}-${i}-${Math.random().toString(36).slice(2, 7)}`;
        const copyName = buildCopyName(source.name, takenNames);
        takenNames.add(copyName);
        const copy: SavedWorkflow = {
          id: copyId,
          name: copyName,
          timestamp: new Date().toLocaleString(),
          storage: 'idb'
        };
        copies.push(copy);
      }

      const updated = [...copies, ...existing];
      persistWorkflowIndex(updated);
      set({ savedWorkflows: updated });

      await Promise.all(
        copies.map((wf) => saveWorkflowPayload(wf.id, clonePayload(payload!)))
      );

      get().addLog('success', `Workflow cloned ${safeCount} time(s): ${source.name}`);
      get().pushNotice('success', `Cloned ${safeCount} workflow(s)`);
    } catch (err) {
      console.error('Failed to clone workflow:', err);
      get().addLog('error', `Workflow clone failed: ${source.name}`);
      get().pushNotice('error', 'Clone failed. Please try again later.');
    }
  },

  loadWorkflow: (id: string) => {
    const workflow = get().savedWorkflows.find(w => w.id === id);
    if (!workflow) return;

    if (workflow.nodes && workflow.edges) {
      get().nodes.forEach(node => revokeNodeResources(node));
      set({ nodes: workflow.nodes, edges: workflow.edges });
      get().addLog('success', `Workflow loaded: ${workflow.name}`);
      return;
    }

    const payloadPromise = workflow.storage === 'local'
      ? Promise.resolve(loadLocalWorkflowPayload(id))
      : loadWorkflowPayload(id);

    void payloadPromise
      .then((payload) => {
        if (!payload) {
          get().addLog('error', 'Load failed: workflow payload not found.');
          get().pushNotice('error', 'Load failed: workflow data not found.');
          return;
        }
        get().nodes.forEach(node => revokeNodeResources(node));
        set({ nodes: payload.nodes, edges: payload.edges });
        get().addLog('success', `Workflow loaded: ${workflow.name}`);
        get().pushNotice('success', `Loaded workflow: ${workflow.name}`);
      })
      .catch((err) => {
        get().addLog('error', 'Load failed: could not read storage.');
        get().pushNotice('error', 'Load failed: could not read storage.');
        get().pushNotice('error', 'Load failed: could not read storage.');
      });
  },

  deleteWorkflow: (id: string) => {
    const updated = get().savedWorkflows.filter(w => w.id !== id);
    persistWorkflowIndex(updated);
    set({ savedWorkflows: updated });
    deleteLocalWorkflowPayload(id);
    get().addLog('info', 'Workflow record deleted.');
    void deleteWorkflowPayload(id).catch((err) => {
      console.error('Failed to delete workflow payload:', err);
    });
  },

  clearCanvas: () => {
    get().nodes.forEach(node => revokeNodeResources(node));
    set({ nodes: [], edges: [], selectedNodeId: null });
    get().addLog('info', 'Canvas cleared.');
  },

  addNode: (type: NodeType, position: { x: number; y: number }, connectFromId?: string) => {
    const id = `${type}-${uuidv4().slice(0, 8)}`;
    const nodeModality = NODE_TO_MODEL_MODALITY[type];
    const defaultModel = nodeModality ? (get().globalActiveModels[nodeModality] || '') : '';

    // Custom styles for special nodes
    const isGroup = type === NodeType.GROUP;
    const defaultDimensions = DEFAULT_NODE_DIMENSIONS[type] || { width: 300, height: 200 };
    const style = isGroup
      ? { ...defaultDimensions, zIndex: -1 }
      : { ...defaultDimensions };

    const videoDefaults = type === NodeType.AI_VIDEO ? { aspectRatio: '16:9' } : {};
    const imageDefaults = type === NodeType.AI_IMAGE ? { promptTemplate: 'free_mode', enablePromptTemplate: false } : {};
    const tableDefaults = type === NodeType.TABLE_PARSE
      ? { ...DEFAULT_TABLE_PARSE_CONFIG, smartModelId: get().globalActiveModels.chat || '' }
      : {};
    const taskSelectDefaults = type === NodeType.TASK_SELECT ? { ...DEFAULT_TASK_SELECT_CONFIG } : {};
    const batchDefaults = type === NodeType.BATCH_EXECUTE ? { ...DEFAULT_BATCH_EXECUTE_CONFIG } : {};
    const styleGuideDefaults = type === NodeType.STYLE_GUIDE ? { ...DEFAULT_STYLE_GUIDE_CONFIG } : {};
    const productImageMatchDefaults = type === NodeType.PRODUCT_IMAGE_MATCH ? { ...DEFAULT_PRODUCT_IMAGE_MATCH_CONFIG } : {};

    const newNode: Node<NodeData> = {
      id,
      type,
      position,
      style,
      data: {
        label: isGroup ? '鏂板缓鍒嗙粍' : (type.split('_').pop() || type),
        type,
        status: 'idle',
        isSkipped: false,
        config: {
          prompt: '',
          modelId: defaultModel,
          ...(type === NodeType.AI_CHAT ? { systemInstruction: DEFAULT_CHAT_PROMPT_TEMPLATE?.content || '' } : {}),
          color: isGroup ? ['#4f46e5', '#ec4899', '#06b6d4', '#8b5cf6'][Math.floor(Math.random() * 4)] : undefined,
          ...imageDefaults,
          ...videoDefaults,
          ...tableDefaults,
          ...taskSelectDefaults,
          ...batchDefaults,
          ...styleGuideDefaults,
          ...productImageMatchDefaults,
        },
      },
    };

    if (!isGroup && DEFAULT_NODE_LABELS[type]) {
      newNode.data.label = DEFAULT_NODE_LABELS[type]!;
    }

    const sourceNode = connectFromId ? get().nodes.find((node) => node.id === connectFromId) : undefined;
    const inferredHandles = connectFromId
      ? inferConnectionHandles(sourceNode?.data?.type || sourceNode?.type, type)
      : {};
    const nextEdges = connectFromId
      ? [
        ...get().edges,
        {
          id: `e-${connectFromId}-${id}-${Date.now()}`,
          type: 'soft',
          source: connectFromId,
          sourceHandle: inferredHandles.sourceHandle || null,
          target: id,
          targetHandle: inferredHandles.targetHandle || null,
          animated: false,
          style: { strokeWidth: 1.5 }
        }
      ]
      : get().edges;

    set({ nodes: [...get().nodes, newNode], edges: nextEdges, selectedNodeId: id });
    get().addLog('info', `Node added: ${newNode.data.label}`);
    return id;
  },

  duplicateSelectionInCanvas: (count = 1, options) => {
    const nodes = get().nodes;
    const edges = get().edges;
    const safeCount = Math.max(1, Math.min(30, Math.floor(count || 1)));
    const keepUploadData = !!options?.keepUploadData;
    const gapX = options?.gapX ?? 140;
    const gapY = options?.gapY ?? 100;

    const selectedNodes = nodes.filter((n: any) => !!n.selected);
    const fallbackSelected = selectedNodes.length === 0 && get().selectedNodeId
      ? nodes.filter((n) => n.id === get().selectedNodeId)
      : selectedNodes;

    if (fallbackSelected.length === 0) {
      get().pushNotice('warn', 'Select at least one node before duplicating.');
      return 0;
    }

    const selectedIdSet = new Set(fallbackSelected.map((n) => n.id));
    const internalEdges = edges.filter((e) => selectedIdSet.has(e.source) && selectedIdSet.has(e.target));

    const minX = Math.min(...fallbackSelected.map((n) => n.position.x));
    const minY = Math.min(...fallbackSelected.map((n) => n.position.y));
    const maxX = Math.max(...fallbackSelected.map((n) => n.position.x + Number((n.style as any)?.width || 320)));
    const maxY = Math.max(...fallbackSelected.map((n) => n.position.y + Number((n.style as any)?.height || 220)));
    const blockWidth = Math.max(300, maxX - minX);
    const blockHeight = Math.max(200, maxY - minY);

    const cols = Math.min(4, safeCount);
    const createdNodes: Node<NodeData>[] = [];
    const createdEdges: Edge[] = [];
    let firstNewNodeId: string | null = null;

    for (let i = 0; i < safeCount; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const offsetX = (col + 1) * (blockWidth + gapX);
      const offsetY = row * (blockHeight + gapY);

      const idMap = new Map<string, string>();
      fallbackSelected.forEach((node) => {
        const newId = `${node.type}-${uuidv4().slice(0, 8)}`;
        idMap.set(node.id, newId);
      });

      fallbackSelected.forEach((node) => {
        const newId = idMap.get(node.id)!;
        if (!firstNewNodeId) firstNewNodeId = newId;
        createdNodes.push({
          ...node,
          id: newId,
          selected: false,
          position: {
            x: node.position.x + offsetX,
            y: node.position.y + offsetY
          },
          data: sanitizeDuplicatedNodeData(node.data, keepUploadData)
        });
      });

      internalEdges.forEach((edge) => {
        const source = idMap.get(edge.source);
        const target = idMap.get(edge.target);
        if (!source || !target) return;
        createdEdges.push({
          ...edge,
          id: `e-${source}-${target}-${uuidv4().slice(0, 6)}`,
          source,
          target,
          selected: false,
        });
      });
    }

    set({
      nodes: [...nodes, ...createdNodes],
      edges: [...edges, ...createdEdges],
      selectedNodeId: firstNewNodeId
    });
    get().addLog('success', `Duplicated ${safeCount} selection group(s): ${createdNodes.length} node(s), ${createdEdges.length} edge(s).`);
    get().pushNotice('success', `Duplicated ${safeCount} group(s).`);

    return safeCount;
  },

  toggleSkipForSelection: () => {
    const state = get();
    const selected = state.nodes.filter((n: any) => !!n.selected);
    const targets = selected.length > 0
      ? selected
      : (state.selectedNodeId ? state.nodes.filter((n) => n.id === state.selectedNodeId) : []);

    if (targets.length === 0) {
      state.pushNotice('warn', 'Select at least one node before skipping.');
      return 0;
    }

    const shouldSkip = targets.some((n) => !n.data.isSkipped);
    const targetIds = new Set(targets.map((n) => n.id));

    set({
      nodes: state.nodes.map((node) => targetIds.has(node.id)
        ? { ...node, data: { ...node.data, isSkipped: shouldSkip, status: 'idle', error: undefined, progress: undefined } }
        : node)
    });
    state.addLog('info', `${shouldSkip ? 'Skipped' : 'Restored'} ${targets.length} node(s).`);
    state.pushNotice('info', shouldSkip ? `Skipped ${targets.length} node(s).` : `Restored ${targets.length} node(s).`);

    return targets.length;
  },

  clearAllSkipped: () => {
    const state = get();
    const skippedCount = state.nodes.filter((n) => !!n.data.isSkipped).length;
    if (skippedCount === 0) {
      state.pushNotice('info', 'There are no skipped nodes right now.');
      return 0;
    }

    set({
      nodes: state.nodes.map((node) => node.data.isSkipped
        ? { ...node, data: { ...node.data, isSkipped: false, status: 'idle', error: undefined, progress: undefined } }
        : node)
    });
    state.addLog('success', `Restored all skipped nodes (${skippedCount}).`);
    state.pushNotice('success', `Restored ${skippedCount} skipped node(s).`);
    return skippedCount;
  },

  resizeNode: (id: string, width: number, height: number) => {
    set({
      nodes: get().nodes.map(node =>
        node.id === id
          ? { ...node, style: { ...node.style, width, height } }
          : node
      )
    });
  },

  tidyUp: () => {
    const { nodes, edges } = get();
    if (nodes.length === 0) return;

    const regularNodes = nodes.filter(n => n.type !== NodeType.GROUP);
    if (regularNodes.length === 0) return;

    const nodeById = new Map(regularNodes.map((n) => [n.id, n]));
    const undirectedAdj = new Map<string, string[]>();
    regularNodes.forEach((n) => undirectedAdj.set(n.id, []));

    edges.forEach((e) => {
      if (!undirectedAdj.has(e.source) || !undirectedAdj.has(e.target)) return;
      undirectedAdj.get(e.source)!.push(e.target);
      undirectedAdj.get(e.target)!.push(e.source);
    });

    const components: string[][] = [];
    const visited = new Set<string>();

    regularNodes.forEach((node) => {
      if (visited.has(node.id)) return;
      const stack = [node.id];
      visited.add(node.id);
      const comp: string[] = [];

      while (stack.length > 0) {
        const cur = stack.pop()!;
        comp.push(cur);
        (undirectedAdj.get(cur) || []).forEach((next) => {
          if (visited.has(next)) return;
          visited.add(next);
          stack.push(next);
        });
      }

      components.push(comp);
    });

    const workflows = components
      .map((ids) => {
        const members = ids.map((id) => nodeById.get(id)).filter(Boolean) as Node<NodeData>[];
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        members.forEach((n) => {
          const width = Number((n.style as any)?.width || 300);
          const height = Number((n.style as any)?.height || 220);
          minX = Math.min(minX, n.position.x);
          minY = Math.min(minY, n.position.y);
          maxX = Math.max(maxX, n.position.x + width);
          maxY = Math.max(maxY, n.position.y + height);
        });

        return {
          ids,
          minX,
          minY,
          width: Math.max(300, maxX - minX),
          height: Math.max(220, maxY - minY),
        };
      })
      .sort((a, b) => (a.minY - b.minY) || (a.minX - b.minX));

    const columns = 3;
    const startX = 120;
    const startY = 120;
    const cellW = Math.max(...workflows.map((w) => w.width), 300) + 200;
    const cellH = Math.max(...workflows.map((w) => w.height), 220) + 180;
    const nextPos = new Map<string, { x: number; y: number }>();

    workflows.forEach((wf, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const baseX = startX + col * cellW;
      const baseY = startY + row * cellH;

      wf.ids.forEach((id) => {
        const node = nodeById.get(id);
        if (!node) return;
        nextPos.set(id, {
          x: baseX + (node.position.x - wf.minX),
          y: baseY + (node.position.y - wf.minY),
        });
      });
    });

    set({
      nodes: nodes.map((node) => {
        if (node.type === NodeType.GROUP) return node;
        const p = nextPos.get(node.id);
        return p ? { ...node, position: p } : node;
      })
    });

    const rows = Math.ceil(workflows.length / columns);
    get().addLog('success', `Workflow arranged into a ${columns}x${rows} grid.`);
  },

  updateNodeData: (id: string, data: Partial<NodeData>) => {
    const node = get().nodes.find(n => n.id === id);
    if (!node) return;

    // Handle Graceful Degradation for model changes
    let newConfig = { ...node.data.config, ...data.config };
    if (data.config && 'modelId' in data.config && data.config.modelId !== node.data.config.modelId) {
      const currentModality = getModalityForNodeType(node.data.type);
      const state = get();
      const activeProvider = getActiveProviderForModality(
        state.apiProviders,
        state.activeProviderIds,
        state.activeProviderId,
        currentModality
      );
      const capabilities = getModelCapabilities(data.config.modelId, currentModality as any, activeProvider);
      let downgraded = false;

      if (capabilities.allowedAspectRatios && newConfig.aspectRatio && !capabilities.allowedAspectRatios.includes(newConfig.aspectRatio)) {
        newConfig.aspectRatio = capabilities.allowedAspectRatios[0] || '1:1';
        downgraded = true;
      }
      if (capabilities.supportsImageSize === false) {
        if (newConfig.imageSize) {
          newConfig.imageSize = undefined;
          downgraded = true;
        }
      } else if (capabilities.allowedImageSizes?.length && newConfig.imageSize && !capabilities.allowedImageSizes.includes(newConfig.imageSize)) {
        newConfig.imageSize = capabilities.allowedImageSizes[0] || '1K';
        downgraded = true;
      }
      if (capabilities.allowedDurations && newConfig.duration && !capabilities.allowedDurations.includes(newConfig.duration)) {
        newConfig.duration = capabilities.allowedDurations[0] || '5';
        downgraded = true;
      }

      if (downgraded) {
        get().pushNotice('info', 'Model switched. Some canvas settings were reset for compatibility.');
      }
    }

    const hasOutputPatch = Object.prototype.hasOwnProperty.call(data, 'output');
    const hasMetaPatch = Object.prototype.hasOwnProperty.call(data, 'meta');

    const shouldInvalidateDownstream = Boolean(
      hasOutputPatch
      || data.inputs !== undefined
      || hasMetaPatch
      || (data.config && Object.keys(data.config).some((key) => (
        key === 'prompt'
        || key === 'systemInstruction'
        || key === 'modelId'
        || key === 'aspectRatio'
        || key === 'imageSize'
        || key === 'imageQuality'
        || key === 'duration'
        || key === 'hd'
      )))
    );

    const downstreamIds = shouldInvalidateDownstream
      ? new Set(getDescendantNodeIds(id, get().edges))
      : new Set<string>();

    set({
      nodes: get().nodes.map((currentNode) => {
        const currentNodeType = currentNode.data.type || (currentNode.type as NodeType);
        const isSourceContentNode = isSourceContentNodeType(currentNodeType);

        if (currentNode.id === id) {
          return {
            ...currentNode,
            data: {
              ...currentNode.data,
              ...data,
              config: newConfig,
              ...(shouldInvalidateDownstream ? {
                status: data.status ?? 'idle',
                error: data.error ?? undefined,
                progress: data.progress ?? undefined
              } : {}),
              ...(shouldInvalidateDownstream && !isSourceContentNode
                ? {
                  ...(hasOutputPatch ? { output: data.output } : {}),
                  ...(hasMetaPatch ? { meta: data.meta } : {})
                }
                : {})
            }
          };
        }

        if (!downstreamIds.has(currentNode.id)) {
          return currentNode;
        }

        return {
          ...currentNode,
          data: {
            ...currentNode.data,
            status: 'idle',
            error: undefined,
            progress: undefined,
            inputs: undefined,
          }
        };
      }),
    });
  },

  resetNodeStates: () => {
    stopAllNodeProgress();
    set({
      nodes: get().nodes.map(node => ({
        ...node,
        data: { ...node.data, status: 'idle', error: undefined, progress: undefined }
      }))
    });
  },

  clearExecutionResults: () => {
    stopAllNodeProgress();
    set({
      nodes: get().nodes.map(node => {
        const nodeType = node.data.type || (node.type as NodeType);
        const isSourceNode = isSourceContentNodeType(nodeType);

        return {
          ...node,
          data: {
            ...node.data,
            status: 'idle',
            error: undefined,
            progress: undefined,
            inputs: undefined,
            output: isSourceNode ? node.data.output : undefined
          }
        };
      })
    });
    get().addLog('info', 'Execution results cleared while keeping inputs and uploaded assets.');
  },

  executeWorkflow: async () => {
    try {
      await ensureClientLicenseFresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'License verification failed.';
      get().addLog('error', message);
      get().pushNotice('error', message);
      return;
    }
    stopExecutionRequested = false;
    stopAllNodeProgress();
    set({ isWorkflowRunning: true });
    try {
      console.log("executeWorkflow called");
      get().clearLogs();
      get().addLog('info', 'Starting workflow execution...');
      const workflowConcurrency = Math.max(1, get().maxWorkflowConcurrency || MAX_WORKFLOW_CONCURRENCY);
      get().addLog('info', `Concurrent scheduler enabled: up to ${workflowConcurrency} independent chains run at the same time.`);


      const { nodes, edges, apiProviders, activeProviderId, activeProviderIds } = get();
      console.log("State:", { nodes: nodes.length, edges: edges.length, activeProviderId, activeProviderIds });

      const service = new AIService();
      const nodeIdSet = new Set(nodes.map(n => n.id));
      const getFreshNode = (id: string) => get().nodes.find(n => n.id === id);
      const incomingByTarget = new Map<string, Edge[]>();
      const outgoingCount = new Map<string, number>();

      edges.forEach((edge) => {
        if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) return;
        if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
        incomingByTarget.get(edge.target)!.push(edge);
        outgoingCount.set(edge.source, (outgoingCount.get(edge.source) || 0) + 1);
      });

      const executionNodes = nodes.filter((node) => {
        if (node.type === NodeType.IMAGE_UPLOAD || node.type === NodeType.MULTI_IMAGE_UPLOAD || node.type === NodeType.FILE_UPLOAD) {
          return (outgoingCount.get(node.id) || 0) > 0;
        }
        return true;
      });

      const completed = new Map<string, any>();
      const completedMeta = new Map<string, any>();
      const failed = new Map<string, string>();

      // 鈹€鈹€ 鍏变韩鐨勮妭鐐规墽琛屽嚱鏁帮紙鎵€鏈夐摼澶嶇敤锛?鈹€鈹€
      const executeNodeTask = async (node: Node<NodeData>) => {
        const deps = (incomingByTarget.get(node.id) || []).filter((edge) => nodeIdSet.has(edge.source));
        const structuredInputs: Record<string, any> = {};
        const connectedHandles = Array.from(new Set(deps.map((edge) => edge.targetHandle || 'default')));
        if (node.type === NodeType.AI_IMAGE && connectedHandles.length > 0) {
          structuredInputs.__connectedHandles = connectedHandles;
        }

        deps.forEach((dep) => {
          const sourceNode = getFreshNode(dep.source);
          const sourceOutput = completed.get(dep.source);
          const sourceMeta = completedMeta.get(dep.source);
          const resolvedSourceOutput = resolveBatchEdgeMappedValue({
            sourceNode,
            edge: dep,
            sourceOutput
          });
          const targetKey = dep.targetHandle || 'default';
          if (dep.targetHandle) {
            structuredInputs[dep.targetHandle] = mergeStructuredInputValue(dep.targetHandle, structuredInputs[dep.targetHandle], resolvedSourceOutput);
          } else {
            structuredInputs.default = resolvedSourceOutput;
          }

          if (dep.targetHandle === 'image' && !resolvedSourceOutput && sourceMeta?.forwardedImages) {
            structuredInputs.image = mergeStructuredInputValue('image', structuredInputs.image, sourceMeta.forwardedImages);
            get().addLog('info', `Node [${node.data.label}] loaded forwarded image data from upstream.`);
          }

          const sourceHandleValue = getValueFromSourceHandle(resolvedSourceOutput, sourceMeta, dep.sourceHandle);
          if (sourceHandleValue !== undefined) {
            structuredInputs[targetKey] = mergeStructuredInputValue(targetKey, structuredInputs[targetKey], sourceHandleValue);
          }

        });

        if (node.type === NodeType.INPUT) {
          const output = node.data.config.prompt || '';
          return {
            id: node.id, output, inputs: structuredInputs,
            meta: { rawPrompt: output, optimizedPrompt: output, modelId: 'input' }
          };
        }

        if (node.type === NodeType.STYLE_GUIDE) {
          const { output, meta } = buildStyleGuideOutput({
            config: node.data.config,
            inputs: structuredInputs
          });
          return {
            id: node.id,
            output,
            inputs: structuredInputs,
            meta
          };
        }

        if (node.type === NodeType.IMAGE_UPLOAD) {
          const output = node.data.output;
          if (!output) throw new Error('璇峰厛涓婁紶鍥剧墖');
          return { id: node.id, output, inputs: structuredInputs };
        }

        if (node.type === NodeType.MULTI_IMAGE_UPLOAD) {
          const output = node.data.output;
          if (!output || !Array.isArray(output) || output.length === 0) {
            throw new Error('Please upload at least one image');
          }
          return { id: node.id, output, inputs: structuredInputs };
        }

        if (node.type === NodeType.FILE_UPLOAD) {
          const output = node.data.output;
          if (!output) throw new Error('璇峰厛涓婁紶鏂囦欢');
          return { id: node.id, output, inputs: structuredInputs };
        }

        if (node.type === NodeType.TABLE_PARSE) {
          const sourceFile = structuredInputs.file ?? structuredInputs.default;
          if (!sourceFile) throw new Error('璇峰厛杩炴帴骞朵笂浼?Excel 琛ㄦ牸');
          const provider = getActiveProviderForModality(apiProviders, activeProviderIds, activeProviderId, 'chat');
          const output = await parseSpreadsheetOutput(sourceFile as StandardFilePayload, node.data.config, {
            apiSettings: buildApiSettings(provider),
            availableChatModels: get().getModelsForNode(NodeType.AI_CHAT),
            preferredChatModelId: get().globalActiveModels.chat || ''
          });
          return {
            id: node.id,
            output,
            inputs: structuredInputs,
            meta: {
              fileName: output.fileName,
              sheetName: output.sheetName,
              taskCount: output.taskCount,
              parseMode: output.parseMode,
              parseModelId: output.parseModelId
            }
          };
        }

        if (node.type === NodeType.TASK_SELECT) {
          const sourceTasks = structuredInputs.tasks ?? structuredInputs.default;
          const { output, meta } = buildTaskSelectionOutput(sourceTasks, node.data.config);
          return {
            id: node.id,
            output,
            inputs: structuredInputs,
            meta
          };
        }

        if (node.type === NodeType.BATCH_EXECUTE) {
          const sourceTasks = structuredInputs.tasks ?? structuredInputs.default;
          const { output, meta } = buildBatchExecutionOutput(sourceTasks, node.data.config);
          const providerForExpansion = getActiveProviderForModality(apiProviders, activeProviderIds, activeProviderId, 'image');
          const currentNodes = get().nodes;
          const currentEdges = get().edges;
          const currentTemplateGraph = getBatchTemplateGraph({
            batchNodeId: node.id,
            nodes: currentNodes,
            edges: currentEdges
          });
          const expansionSignature = buildBatchExpansionSignature({
            batchOutput: output,
            templateGraph: currentTemplateGraph
          });
          const existingExpandedState = getExistingExpandedBatchNodes({
            batchNode: node,
            nodes: currentNodes,
            edges: currentEdges
          });
          const canReuseExpandedNodes = (
            existingExpandedState.nodes.length > 0
            && node.data.meta?.expansionSignature === expansionSignature
          );

          if (canReuseExpandedNodes) {
            get().addLog('info', `[${node.data.label}] 已检测到已展开的批量子链，本轮将直接执行它们。`);
            return {
              id: node.id,
              output,
              inputs: structuredInputs,
              meta: {
                ...meta,
                createdCount: existingExpandedState.nodes.length,
                templateCount: currentTemplateGraph.nodes.length,
                expandedNodeIds: existingExpandedState.nodes.map((expandedNode) => expandedNode.id),
                expandedTerminalNodeIds: existingExpandedState.terminalNodes.map((expandedNode) => expandedNode.id),
                expansionSignature,
                readyToRun: false,
                rerunRequired: false,
                stage: 'running'
              }
            };
          }

          const expansion = expandBatchToImageNodes({
            batchNode: node,
            batchOutput: output,
            nodes: currentNodes,
            edges: currentEdges,
            preferredImageModelId: get().globalActiveModels.image || get().getModelsForNode(NodeType.AI_IMAGE)[0] || '',
            provider: providerForExpansion
          });
          const expandedNodeIds = expansion.createdNodes.map((createdNode) => createdNode.id);
          const nextExpansionSignature = buildBatchExpansionSignature({
            batchOutput: output,
            templateGraph: expansion.templateGraph
          });

          expansion.removedNodes.forEach((removedNode) => revokeNodeResources(removedNode));
          set({ nodes: expansion.nodes, edges: expansion.edges });
          get().addLog('info', `[${node.data.label}] 已展开 ${expansion.createdNodes.length} 个批量节点，等待再次运行。`);
          get().pushNotice('info', '批量任务已展开为多条执行子链，请再次运行开始批量生成。');
          if (expansion.autoCreatedTemplateNodes.length > 0) {
            get().addLog('info', `[${node.data.label}] 未检测到生图模板，已自动补齐 ${expansion.autoCreatedTemplateNodes.length} 个默认生图节点。`);
          }

          return {
            id: node.id,
            output,
            inputs: structuredInputs,
            meta: {
              ...meta,
              createdCount: expansion.createdNodes.length,
              templateCount: expansion.templateNodes.length,
              expandedNodeIds,
              expandedTerminalNodeIds: expansion.createdTerminalNodeIds,
              expansionSignature: nextExpansionSignature,
              readyToRun: true,
              rerunRequired: true,
              stage: 'expanded'
            }
          };
        }

        if (node.type === NodeType.OUTPUT || node.type === NodeType.GROUP) {
          const output = structuredInputs.default ?? Object.values(structuredInputs).find((value) => value !== undefined);
          return { id: node.id, output, inputs: structuredInputs };
        }

        if (node.type === NodeType.PRODUCT_IMAGE_MATCH) {
          const provider = getActiveProviderForModality(apiProviders, activeProviderIds, activeProviderId, 'chat');
          const { output, meta } = await executeProductImageMatch({
            nodeId: node.id,
            config: node.data.config,
            inputs: structuredInputs,
            service,
            apiSettings: buildApiSettings(provider),
            fallbackModelId: get().globalActiveModels.chat || get().getModelsForNode(NodeType.PRODUCT_IMAGE_MATCH)[0] || '',
            onProgress: (progress) => get().updateNodeData(node.id, { progress })
          });

          return {
            id: node.id,
            output,
            inputs: structuredInputs,
            meta,
            providerName: provider?.name,
            providerBaseUrl: provider?.baseUrl
          };
        }

        const provider = getActiveProviderForNodeType(apiProviders, activeProviderIds, activeProviderId, node.type);
        if (!provider) throw new Error('API provider is not configured');

        if (node.data.config.modelId) {
          get().addLog('api', `API request: [${node.data.config.modelId}] -> ${provider.baseUrl}/chat/completions`, {
            nodeId: node.id, nodeLabel: node.data.label
          });
        }

        let requestConfig: any = node.data.config;
        let requestInputs: Record<string, any> = structuredInputs;

        if (node.type === NodeType.AI_IMAGE) {
          if (structuredInputs.batch) {
            get().addLog('info', `[${node.data.label}] is a batch template node and skips direct generation.`);
            return {
              id: node.id,
              output: undefined,
              inputs: structuredInputs,
              meta: {
                ...(node.data.meta && typeof node.data.meta === 'object' ? node.data.meta : {}),
                batchTemplate: true,
                templateOnly: true
              },
              providerName: provider.name,
              providerBaseUrl: provider.baseUrl
            };
          }

          const prepared = prepareAiImageRequest(node.data.config, structuredInputs, provider);
          requestInputs = prepared.requestInputs;
          requestConfig = prepared.requestConfig;
        }

        // Resolve blob URLs to Base64 just-in-time for backend communication
        const resolvedApiInputs = await resolvePayloadBeforeApi(requestInputs);

        const nodeAbortController = new AbortController();
        activeNodeAbortControllers.set(node.id, nodeAbortController);
        let output: any;
        try {
          output = await service.executeNode(
            node.id, node.type, requestConfig, resolvedApiInputs,
            buildApiSettings(provider)!,
            { signal: nodeAbortController.signal }
          );
        } finally {
          activeNodeAbortControllers.delete(node.id);
        }

        const rawOutput = output?.output ?? output;
        // 鍥剧墖/瑙嗛鑺傜偣褰掍竴鍖?output 涓哄共鍑€瀛楃涓?
        const normalizedOutput = (node.type === NodeType.AI_IMAGE || node.type === NodeType.AI_VIDEO)
          ? normalizeGenerationOutput(rawOutput)
          : rawOutput;

        return {
          id: node.id,
          output: normalizedOutput,
          inputs: structuredInputs,
          meta: output?.meta || null,
          providerName: provider.name,
          providerBaseUrl: provider.baseUrl
        };
      };

      // 鈹€鈹€ 姝ラ 1: 妫€娴嬬嫭绔嬪伐浣滄祦閾撅紙杩為€氬垎閲忥級 鈹€鈹€
      const undirectedAdj = new Map<string, string[]>();
      executionNodes.forEach(n => undirectedAdj.set(n.id, []));
      edges.forEach((e) => {
        if (!undirectedAdj.has(e.source) || !undirectedAdj.has(e.target)) return;
        undirectedAdj.get(e.source)!.push(e.target);
        undirectedAdj.get(e.target)!.push(e.source);
      });

      const chains: string[][] = [];
      const visitedForChain = new Set<string>();
      executionNodes.forEach((node) => {
        if (visitedForChain.has(node.id)) return;
        const stack = [node.id];
        visitedForChain.add(node.id);
        const comp: string[] = [];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          comp.push(cur);
          (undirectedAdj.get(cur) || []).forEach((next) => {
            if (visitedForChain.has(next)) return;
            visitedForChain.add(next);
            stack.push(next);
          });
        }
        chains.push(comp);
      });

      const validChains = chains.filter(chain =>
        chain.some(id => { const n = getFreshNode(id); return n && n.type !== NodeType.GROUP; })
      );

      get().addLog('info', `Detected ${validChains.length} independent workflow chain(s). Concurrency limit: ${workflowConcurrency}.`);

      // 鈹€鈹€ 姝ラ 2: 鍗曟潯閾剧殑鎵ц鍣紙鍐呴儴鎸?DAG 椤哄簭鎺ㄨ繘锛?鈹€鈹€
      const executeChain = async (chainNodeIds: string[], chainIndex: number) => {
        const chainLabel = `閾?#${chainIndex + 1}`;
        const chainPending = new Set(chainNodeIds);
        type SettledResult = { node: Node<NodeData>; status: 'fulfilled'; value: any } | { node: Node<NodeData>; status: 'rejected'; reason: any };
        const chainRunning = new Map<string, Promise<SettledResult>>();

        get().addLog('info', `? ${chainLabel} started (${chainPending.size} node(s))`);

        const launchReadyInChain = () => {
          let changed = true;
          while (changed) {
            changed = false;
            for (const nodeId of Array.from(chainPending)) {
              if (stopExecutionRequested) return;
              const node = getFreshNode(nodeId);
              if (!node || chainRunning.has(nodeId)) continue;

              const deps = (incomingByTarget.get(nodeId) || []).filter(e => nodeIdSet.has(e.source));
              const unresolvedDeps = deps.filter(d => !completed.has(d.source) && !failed.has(d.source));
              if (unresolvedDeps.length > 0) continue;

              const failedDeps = deps.filter(d => failed.has(d.source));
              if (failedDeps.length > 0) {
                const reason = failedDeps.map(d => getFreshNode(d.source)?.data.label || d.source).join(', ');
                chainPending.delete(node.id);
                const failedMessage = `上游节点失败: ${normalizeLegacyText(reason)}`;
                failed.set(node.id, failedMessage);
                get().updateNodeData(node.id, { status: 'error', error: failedMessage, progress: undefined });
                get().addLog('warn', `Node [${node.data.label}] was skipped because an upstream node failed (${reason}).`);
                changed = true; continue;
              }

              if (node.data.isSkipped) {
                chainPending.delete(node.id);
                completed.set(node.id, undefined);
                completedMeta.set(node.id, { skipped: true });
                stopNodeProgress(node.id);
                get().addLog('warn', `[${node.data.label}] was skipped manually.`);
                get().addLog('warn', `[${node.data.label}] was skipped manually.`);
                changed = true; continue;
              }

              const hasAnyUpstreamData = deps.some(d => {
                const val = completed.get(d.source);
                if (val === undefined || val === null) return false;
                if (typeof val === 'string' && val.trim() === '') return false;
                if (Array.isArray(val) && val.length === 0) return false;
                return true;
              });
              const canUseOwnPrompt = typeof node.data.config.prompt === 'string' && node.data.config.prompt.trim().length > 0;
              const shouldAutoSkipForNoInput = (
                (node.type === NodeType.AI_CHAT || node.type === NodeType.AI_AUDIO || node.type === NodeType.OUTPUT)
                && deps.length > 0 && !hasAnyUpstreamData
              ) || (
                  node.type === NodeType.AI_IMAGE && deps.length > 0 && !hasAnyUpstreamData && !canUseOwnPrompt
                );

              if (shouldAutoSkipForNoInput) {
                chainPending.delete(node.id);
                completed.set(node.id, undefined);
                completedMeta.set(node.id, { skipped: true, reason: 'missing_input' });
                stopNodeProgress(node.id);
                get().addLog('warn', `[${node.data.label}] was skipped automatically because there was no valid input.`);
                get().addLog('warn', `[${node.data.label}] was skipped automatically because there was no valid input.`);
                changed = true; continue;
              }

              // 鍚姩鑺傜偣
              chainPending.delete(node.id);
              get().updateNodeData(node.id, {
                status: 'running', error: undefined,
                progress: (node.type === NodeType.AI_IMAGE || node.type === NodeType.AI_VIDEO) ? 3 : undefined
              });
              if (node.type === NodeType.AI_IMAGE || node.type === NodeType.AI_VIDEO) startImageNodeProgress(node.id, get().updateNodeData);
              get().addLog('info', `Processing node: [${node.data.label}]`);

              const wrapped = executeNodeTask(node)
                .then(value => ({ node, status: 'fulfilled' as const, value }))
                .catch(reason => ({ node, status: 'rejected' as const, reason }));
              chainRunning.set(node.id, wrapped);
              changed = true;
            }
          }
        };

        launchReadyInChain();

        while (chainRunning.size > 0 || chainPending.size > 0) {
          if (stopExecutionRequested) {
            chainPending.forEach(nodeId => {
              const node = getFreshNode(nodeId);
              if (node) get().updateNodeData(node.id, { status: 'idle', progress: undefined });
            });
            chainPending.clear();
            if (chainRunning.size > 0) {
              await Promise.allSettled(Array.from(chainRunning.values()));
              chainRunning.forEach((_, nodeId) => {
                stopNodeProgress(nodeId);
                get().updateNodeData(nodeId, { status: 'idle', progress: undefined });
              });
              chainRunning.clear();
            }
            break;
          }

          if (chainRunning.size === 0) {
            if (chainPending.size > 0) get().addLog('warn', `${chainLabel} still has blocked nodes that cannot progress (likely a cycle or unmet dependency).`);
            break;
          }

          const settled = await Promise.race(Array.from(chainRunning.values()));
          chainRunning.delete(settled.node.id);

          if (settled.status === 'fulfilled') {
            const node = settled.node;
            const { output, inputs, meta, providerName, providerBaseUrl } = settled.value;
            completed.set(node.id, output);
            completedMeta.set(node.id, meta || null);
            stopNodeProgress(node.id);
            if (node.type === NodeType.TABLE_PARSE) {
              const freshNode = getFreshNode(node.id);
              if (freshNode) revokeNodeResources(freshNode);
            }
            get().updateNodeData(node.id, {
              status: 'success', output, inputs, meta: meta || null,
              progress: (node.type === NodeType.AI_IMAGE || node.type === NodeType.AI_VIDEO) ? 100 : undefined
            });

            const batchResults = Array.isArray(meta?.batchResults) ? meta.batchResults as BatchImageResult[] : [];
            if (node.type === NodeType.AI_IMAGE && batchResults.length > 0) {
              void (async () => {
                const items: ImageHistoryItem[] = [];
                for (const result of batchResults) {
                  const primaryResultUrl = getPrimaryImageUrl(result.output);
                  if (!primaryResultUrl) continue;
                  const resultImageDataUrl = await toDataUrl(primaryResultUrl);

                  items.push({
                    id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    createdAt: Date.now(),
                    nodeId: node.id,
                    providerName: providerName || 'Unknown provider',
                    providerBaseUrl: providerBaseUrl || '',
                    modelId: String(meta?.modelId || node.data.config.modelId || 'unknown'),
                    rawPrompt: result.prompt,
                    optimizedPrompt: result.prompt,
                    sourceImageDataUrl: undefined,
                    resultImageUrl: primaryResultUrl,
                    resultImageDataUrl
                  });
                }
                try {
                  const persistedItems: ImageHistoryItem[] = [];
                  for (const item of items) {
                    const persistedItem = await saveImageHistoryItem(item);
                    if (persistedItem) persistedItems.push(persistedItem);
                  }
                  if (persistedItems.length > 0) {
                    set((state) => ({ imageHistory: [...persistedItems.reverse(), ...state.imageHistory].slice(0, MAX_LOCAL_IMAGE_HISTORY_ITEMS) }));
                  }
                } catch (err) { console.error('Failed to persist batch image history items:', err); }
              })();
            } else if (node.type === NodeType.AI_IMAGE) {
              const primaryResultUrl = getPrimaryImageUrl(output);
              if (!primaryResultUrl) {
                get().addLog('warn', `[${node.data.label}] completed without a readable primary image URL.`);
                get().addLog('success', `Node [${node.data.label}] completed.`);
                if (!stopExecutionRequested) launchReadyInChain();
                continue;
              }
              const sourceInput = Array.isArray(inputs?.image) ? inputs.image[0] : inputs?.image;
              const sourceImage = typeof sourceInput === 'string' ? sourceInput : (typeof meta?.sourceImage === 'string' ? meta.sourceImage : undefined);
              const rawPrompt = String(meta?.rawPrompt || inputs?.prompt || node.data.config.prompt || '').trim();
              const optimizedPrompt = String(meta?.optimizedPrompt || rawPrompt).trim();
              const modelId = String(meta?.modelId || node.data.config.modelId || 'unknown');

              void (async () => {
                const sourceImageDataUrl = await toDataUrl(sourceImage);
                const resultImageDataUrl = await toDataUrl(primaryResultUrl);
                const item: ImageHistoryItem = {
                  id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  createdAt: Date.now(),
                  nodeId: node.id,
                  providerName: providerName || 'Unknown provider',
                  providerBaseUrl: providerBaseUrl || '',
                  modelId,
                  rawPrompt,
                  optimizedPrompt,
                  sourceImageDataUrl,
                  resultImageUrl: primaryResultUrl,
                  resultImageDataUrl
                };
                try {
                  const persistedItem = await saveImageHistoryItem(item);
                  if (persistedItem) {
                    set((state) => ({ imageHistory: [persistedItem, ...state.imageHistory].slice(0, MAX_LOCAL_IMAGE_HISTORY_ITEMS) }));
                  }
                } catch (err) { console.error('Failed to persist image history item:', err); }
              })();
            }
            get().addLog('success', `Node [${node.data.label}] completed.`);
          } else {
            const node = settled.node;
            const rawError = settled.reason;
            const errorMsg = normalizeUiErrorMessage(
              typeof rawError === 'string'
                ? rawError
                : (rawError?.message || JSON.stringify(rawError) || 'Unknown execution error')
            );
            stopNodeProgress(node.id);
            failed.set(node.id, errorMsg);
            get().updateNodeData(node.id, { status: 'error', error: errorMsg, progress: undefined });
            get().addLog('error', `Node [${node.data.label}] failed: ${errorMsg}`);
            get().pushNotice('error', `Node execution failed: ${node.data.label}`);
          }

          if (!stopExecutionRequested) launchReadyInChain();
        }
        get().addLog('info', `? ${chainLabel} finished.`);
      };

      // 鈹€鈹€ 姝ラ 3: 宸ヤ綔娴侀摼绾у埆鐨勫苟鍙戣皟搴︼紙鏍稿績鏀瑰姩锛?鈹€鈹€
      // workflowConcurrency 鎺у埗鍚屾椂杩愯鐨?閾?鏁伴噺锛岃€岄潪鍗曚釜鑺傜偣
      const chainQueue = [...validChains];
      const runningChains = new Map<number, Promise<void>>();
      let chainCounter = 0;

      const launchNextChains = () => {
        while (runningChains.size < workflowConcurrency && chainQueue.length > 0 && !stopExecutionRequested) {
          const chain = chainQueue.shift()!;
          const idx = chainCounter++;
          const promise = executeChain(chain, idx).catch(err => {
            get().addLog('error', `Chain #${idx + 1} failed: ${(err as Error)?.message || err}`);
          });
          runningChains.set(idx, promise);
        }
      };

      launchNextChains();

      while (runningChains.size > 0) {
        if (stopExecutionRequested) {
          await Promise.allSettled(Array.from(runningChains.values()));
          get().addLog('warn', 'All workflow chains have been stopped.');

          get().pushNotice('warn', 'Workflow stopped.');
          break;
        }

        const entries = Array.from(runningChains.entries());
        const finishedIdx = await Promise.race(entries.map(([idx, p]) => p.then(() => idx)));
        runningChains.delete(finishedIdx);

        if (!stopExecutionRequested) launchNextChains();
      }

      const hasError = get().nodes.some(n => n.data.status === 'error');
      if (!hasError && !stopExecutionRequested) {
        get().pushNotice('success', 'Workflow execution finished.');

      }
    } finally {
      stopExecutionRequested = false;
      stopAllNodeProgress();
      set({ isWorkflowRunning: false });
    }
  },

  executeSingleNode: async (id: string) => {
    const node = get().nodes.find(n => n.id === id);
    if (!node) return;

    try {
      await ensureClientLicenseFresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'License verification failed.';
      get().addLog('error', message);
      get().pushNotice('error', message);
      return;
    }

    if (node.data.status === 'running') {
      get().addLog('warn', `Node [${node.data.label}] is already running.`);
      get().pushNotice('warn', `Node is already running: ${node.data.label}`);
      return;
    }

    if (node.data.isSkipped) {
      get().addLog('warn', `Node [${node.data.label}] is currently skipped. Restore it before running.`);
      get().pushNotice('warn', `Node skipped: ${node.data.label}`);
      return;
    }

    get().addLog('info', `Triggering single node: [${node.data.label}]`);
    get().updateNodeData(id, {
      status: 'running',
      error: undefined,
      progress: node.type === NodeType.AI_IMAGE ? 3 : undefined
    });
    if (node.type === NodeType.AI_IMAGE) {
      startImageNodeProgress(id, get().updateNodeData);
    }

    try {
      const { edges, nodes, apiProviders, activeProviderId, activeProviderIds } = get();

      // 1. Gather current inputs from connected edges
      // FIX: Only consider edges from nodes that actually exist in the nodes array
      const dependencies = edges.filter(e =>
        e.target === id &&
        nodes.some(n => n.id === e.source)
      );

      const structuredInputs: Record<string, any> = {};
      const missingDeps: string[] = [];
      const connectedHandles = Array.from(new Set(dependencies.map((edge) => edge.targetHandle || 'default')));
      if (node.type === NodeType.AI_IMAGE && connectedHandles.length > 0) {
        structuredInputs.__connectedHandles = connectedHandles;
      }

      dependencies.forEach(dep => {
        const sourceNode = nodes.find(n => n.id === dep.source);
        const key = dep.targetHandle || 'default';
        const isStalePromptSource = key === 'prompt'
          && sourceNode
          && sourceNode.type !== NodeType.INPUT
          && sourceNode.data.status !== 'success';

        const resolvedSourceOutput = (() => {
          if (!sourceNode) return undefined;
          // 璺宠繃鐨勮妭鐐逛笉搴斿悜涓嬫父浼犻€掑巻鍙茶緭鍑?
          if (sourceNode.data.isSkipped) return undefined;
          if (isStalePromptSource) return undefined;
          if (sourceNode.type === NodeType.INPUT) {
            const text = sourceNode.data.config.prompt;
            return typeof text === 'string' ? text : '';
          }
          return sourceNode.data.output;
        })();
        const mappedSourceOutput = resolveBatchEdgeMappedValue({
          sourceNode,
          edge: dep,
          sourceOutput: resolvedSourceOutput
        });

        // Resolve forwarded images from meta (also skip if source is skipped)
        const resolvedSourceImagePassthrough = (!sourceNode?.data.isSkipped)
          ? (sourceNode?.data.meta?.forwardedImages || (sourceNode as any)?.meta?.forwardedImages)
          : undefined;

        if (mappedSourceOutput !== undefined || (key === 'image' && resolvedSourceImagePassthrough)) {
          // If we are connecting to 'image' and the upstream output is NOT an image, BUT upstream has forwarded images in meta, use those.
          if (key === 'image' && !mappedSourceOutput && resolvedSourceImagePassthrough) {
            structuredInputs[key] = mergeStructuredInputValue(key, structuredInputs[key], resolvedSourceImagePassthrough);
          } else {
            structuredInputs[key] = mergeStructuredInputValue(key, structuredInputs[key], mappedSourceOutput);
          }

          const sourceHandleValue = getValueFromSourceHandle(mappedSourceOutput, sourceNode?.data.meta, dep.sourceHandle);
          if (sourceHandleValue !== undefined) {
            structuredInputs[key] = mergeStructuredInputValue(key, structuredInputs[key], sourceHandleValue);
          }

          get().addLog('info', `Node [${node.data.label}] read upstream data from [${sourceNode.data.label}] -> slot [${key}]`);
        } else {
          // 璺宠繃鐨勪笂娓歌妭鐐逛笉绠楃己澶变緷璧栵紙image / template 绛夊睘浜庡彲閫夎緭鍏ワ級
          if (sourceNode?.data.isSkipped) {
            get().addLog('info', `Node [${node.data.label}] skipped slot [${key}] because upstream [${sourceNode.data.label}] was skipped.`);
          } else {
            const sourceName = normalizeLegacyText(sourceNode?.data.label || sourceNode?.id || '未知节点');
            const isOptionalInput = key === 'image' || key === 'template';
            if (!isOptionalInput) {
              missingDeps.push(`[${sourceName}] 的 ${key} 插槽`);
            }
          }
        }
      });

      if (missingDeps.length > 0 && node.type !== NodeType.INPUT && node.type !== NodeType.IMAGE_UPLOAD && node.type !== NodeType.MULTI_IMAGE_UPLOAD && node.type !== NodeType.FILE_UPLOAD) {
        throw new Error(`缺少上游数据：请先运行 ${missingDeps.join(', ')}`);
      }

      if (node.type === NodeType.TABLE_PARSE) {
        const sourceFile = structuredInputs.file ?? structuredInputs.default;
        if (!sourceFile) {
          throw new Error('请先连接并上传 Excel 表格');
        }

        const provider = getActiveProviderForModality(apiProviders, activeProviderIds, activeProviderId, 'chat');
        const output = await parseSpreadsheetOutput(sourceFile as StandardFilePayload, node.data.config, {
          apiSettings: buildApiSettings(provider),
          availableChatModels: get().getModelsForNode(NodeType.AI_CHAT),
          preferredChatModelId: get().globalActiveModels.chat || ''
        });
        revokeNodeResources(node);
        stopNodeProgress(id);
        get().updateNodeData(id, {
          status: 'success',
          output,
          inputs: structuredInputs,
          meta: {
            fileName: output.fileName,
            sheetName: output.sheetName,
            taskCount: output.taskCount,
            parseMode: output.parseMode,
            parseModelId: output.parseModelId
          },
          progress: undefined
        });
        get().addLog('success', `[${node.data.label}] parsed ${output.taskCount} task(s).`);
        return;
      }

      if (node.type === NodeType.TASK_SELECT) {
        const sourceTasks = structuredInputs.tasks ?? structuredInputs.default;
        const { output, meta } = buildTaskSelectionOutput(sourceTasks, node.data.config);
        stopNodeProgress(id);
        get().updateNodeData(id, {
          status: 'success',
          output,
          inputs: structuredInputs,
          meta,
          progress: undefined
        });
        get().addLog('success', `[${node.data.label}] selected task #${output.selectedIndex}.`);
        return;
      }

      if (node.type === NodeType.BATCH_EXECUTE) {
        const sourceTasks = structuredInputs.tasks ?? structuredInputs.default;
        const { output, meta } = buildBatchExecutionOutput(sourceTasks, node.data.config);
        const providerForExpansion = getActiveProviderForModality(apiProviders, activeProviderIds, activeProviderId, 'image');
        const currentTemplateGraph = getBatchTemplateGraph({
          batchNodeId: node.id,
          nodes,
          edges
        });
        const expansionSignature = buildBatchExpansionSignature({
          batchOutput: output,
          templateGraph: currentTemplateGraph
        });
        const existingExpandedState = getExistingExpandedBatchNodes({
          batchNode: node,
          nodes,
          edges
        });
        const canReuseExpandedNodes = (
          existingExpandedState.nodes.length > 0
          && node.data.meta?.expansionSignature === expansionSignature
        );

        if (canReuseExpandedNodes) {
          get().updateNodeData(id, {
            status: 'running',
            output,
            inputs: structuredInputs,
            meta: {
              ...meta,
              createdCount: existingExpandedState.nodes.length,
              templateCount: currentTemplateGraph.nodes.length,
              expandedNodeIds: existingExpandedState.nodes.map((expandedNode) => expandedNode.id),
              expandedTerminalNodeIds: existingExpandedState.terminalNodes.map((expandedNode) => expandedNode.id),
              expansionSignature,
              readyToRun: false,
              rerunRequired: false,
              stage: 'running',
              autoTriggered: false,
              successCount: 0,
              failedCount: 0
            }
          });
          get().addLog('info', `[${node.data.label}] 已复用 ${existingExpandedState.nodes.length} 个已展开节点，开始批量生成。`);
          get().pushNotice('info', '已开始批量执行已展开的子链。');

          const { successCount, failedCount } = await executeExpandedBatchSubgraph({
            expandedNodes: existingExpandedState.nodes,
            terminalNodes: existingExpandedState.terminalNodes,
            edges: get().edges,
            executeNode: (nodeId) => get().executeSingleNode(nodeId),
            getCurrentNodes: () => get().nodes
          });

          stopNodeProgress(id);
          get().updateNodeData(id, {
            status: 'success',
            output,
            inputs: structuredInputs,
            meta: {
              ...meta,
              createdCount: existingExpandedState.nodes.length,
              templateCount: currentTemplateGraph.nodes.length,
              expandedNodeIds: existingExpandedState.nodes.map((expandedNode) => expandedNode.id),
              expandedTerminalNodeIds: existingExpandedState.terminalNodes.map((expandedNode) => expandedNode.id),
              expansionSignature,
              readyToRun: false,
              rerunRequired: false,
              stage: 'completed',
              autoTriggered: false,
              successCount,
              failedCount
            },
            progress: undefined
          });
          return;
        }

        const expansion = expandBatchToImageNodes({
          batchNode: node,
          batchOutput: output,
          nodes,
          edges,
          preferredImageModelId: get().globalActiveModels.image || get().getModelsForNode(NodeType.AI_IMAGE)[0] || '',
          provider: providerForExpansion
        });
        const expandedNodeIds = expansion.createdNodes.map((createdNode) => createdNode.id);
        const nextExpansionSignature = buildBatchExpansionSignature({
          batchOutput: output,
          templateGraph: expansion.templateGraph
        });

        expansion.removedNodes.forEach((removedNode) => revokeNodeResources(removedNode));
        set({ nodes: expansion.nodes, edges: expansion.edges });
        stopNodeProgress(id);
        get().updateNodeData(id, {
          status: 'success',
          output,
          inputs: structuredInputs,
          meta: {
            ...meta,
            createdCount: expansion.createdNodes.length,
            templateCount: expansion.templateNodes.length,
            expandedNodeIds,
            expandedTerminalNodeIds: expansion.createdTerminalNodeIds,
            expansionSignature: nextExpansionSignature,
            readyToRun: true,
            rerunRequired: true,
            stage: 'expanded',
            autoTriggered: false,
            successCount: 0,
            failedCount: 0
          },
          progress: undefined
        });
        get().addLog('success', `[${node.data.label}] 已展开 ${expansion.createdNodes.length} 个批量节点，请再次点击开始批量生成。`);
        get().pushNotice('info', '批量任务已展开，请再次点击批量执行节点开始执行整条子链。');
        if (expansion.autoCreatedTemplateNodes.length > 0) {
          get().addLog('info', `[${node.data.label}] 未检测到已连接的生图模板，已自动创建 ${expansion.autoCreatedTemplateNodes.length} 个默认图像生成节点。`);
          get().pushNotice('info', '未检测到已连接的生图模板，已自动创建默认图像生成节点。');
        }
        return;
      }

      if (node.type === NodeType.STYLE_GUIDE) {
        const { output, meta } = buildStyleGuideOutput({
          config: node.data.config,
          inputs: structuredInputs
        });
        stopNodeProgress(id);
        get().updateNodeData(id, {
          status: 'success',
          output,
          inputs: structuredInputs,
          meta,
          progress: undefined
        });
        get().addLog('success', `[${node.data.label}] 已输出统一风格约束。`, {
          nodeId: id,
          nodeLabel: node.data.label
        });
        return;
      }

      // 2. Handle simple local nodes (Utility Nodes)
      if (node.type === NodeType.INPUT || node.type === NodeType.IMAGE_UPLOAD || node.type === NodeType.MULTI_IMAGE_UPLOAD || node.type === NodeType.FILE_UPLOAD || node.type === NodeType.OUTPUT || node.type === NodeType.GROUP) {
        let output = node.data.output;

        if (node.type === NodeType.INPUT) {
          output = node.data.config.prompt || '';
        } else if (!output || (Array.isArray(output) && output.length === 0)) {
          throw new Error('请先上传数据');
        }

        stopNodeProgress(id);
        const entryLabel = node.type === NodeType.MULTI_IMAGE_UPLOAD
          ? `multi-image (${Array.isArray(output) ? output.length : 0})`
          : 'node';
        stopNodeProgress(id);
        get().updateNodeData(id, { status: 'success', output, progress: undefined });
        get().addLog('success', `[${node.data.label}] ${entryLabel} is ready.`, {
          nodeId: id,
          nodeLabel: node.data.label
        });
        return;
      }

      if (node.type === NodeType.PRODUCT_IMAGE_MATCH) {
        const provider = getActiveProviderForModality(apiProviders, activeProviderIds, activeProviderId, 'chat');
        const service = new AIService();
        const { output, meta } = await executeProductImageMatch({
          nodeId: id,
          config: node.data.config,
          inputs: structuredInputs,
          service,
          apiSettings: buildApiSettings(provider),
          fallbackModelId: get().globalActiveModels.chat || get().getModelsForNode(NodeType.PRODUCT_IMAGE_MATCH)[0] || '',
          onProgress: (progress) => get().updateNodeData(id, { progress })
        });

        stopNodeProgress(id);
        get().updateNodeData(id, {
          status: 'success',
          output,
          inputs: structuredInputs,
          meta,
          progress: undefined
        });
        get().addLog('success', `[${node.data.label}] 已筛选 ${output.selectedCount}/${output.totalImages} 张产品图。`, {
          nodeId: id,
          nodeLabel: node.data.label
        });
        return;
      }

      // 3. Handle AI nodes
      const activeProvider = getActiveProviderForNodeType(apiProviders, activeProviderIds, activeProviderId, node.type);
      if (!activeProvider) {
        throw new Error('API provider is not configured');
      }

      const service = new AIService();
      let requestConfig: any = node.data.config;
      let requestInputs: Record<string, any> = structuredInputs;

      if (node.type === NodeType.AI_IMAGE) {
        if (structuredInputs.batch) {
          stopNodeProgress(id);
          get().updateNodeData(id, {
            status: 'success',
            output: undefined,
            inputs: structuredInputs,
            meta: {
              ...(node.data.meta && typeof node.data.meta === 'object' ? node.data.meta : {}),
              batchTemplate: true,
              templateOnly: true
            },
            progress: undefined
          });
          get().addLog('info', `[${node.data.label}] is a batch template node. Run the batch execute node instead.`);
          get().pushNotice('info', 'This image node is a batch template. Run the batch execute node to expand and trigger real generation nodes.');
          return;
        }

        const prepared = prepareAiImageRequest(node.data.config, structuredInputs, activeProvider);
        requestInputs = prepared.requestInputs;
        requestConfig = prepared.requestConfig;
      }

      // Resolve blob URLs to Base64 just-in-time for backend communication
      const resolvedApiInputs = await resolvePayloadBeforeApi(requestInputs);

      const nodeAbortController = new AbortController();
      activeNodeAbortControllers.set(id, nodeAbortController);
      let output: any;
      try {
        output = await service.executeNode(
          id,
          node.type,
          requestConfig,
          resolvedApiInputs,
          buildApiSettings(activeProvider)!,
          { signal: nodeAbortController.signal }
        );
      } finally {
        activeNodeAbortControllers.delete(id);
      }

      const rawFinalOutput = output?.output ?? output;
      // 鍥剧墖/瑙嗛鑺傜偣褰掍竴鍖?output 涓哄共鍑€瀛楃涓?
      const finalOutput = (node.type === NodeType.AI_IMAGE || node.type === NodeType.AI_VIDEO)
        ? normalizeGenerationOutput(rawFinalOutput)
        : rawFinalOutput;
      const meta = output?.meta || null;

      stopNodeProgress(id);
      get().updateNodeData(id, {
        status: 'success',
        output: finalOutput,
        inputs: structuredInputs,
        meta: meta || null,
        progress: node.type === NodeType.AI_IMAGE ? 100 : undefined
      });

      const batchResults = Array.isArray(meta?.batchResults) ? meta.batchResults as BatchImageResult[] : [];
      if (node.type === NodeType.AI_IMAGE && batchResults.length > 0) {
        void (async () => {
          const items: ImageHistoryItem[] = [];
          for (const result of batchResults) {
            const primaryResultUrl = getPrimaryImageUrl(result.output);
            if (!primaryResultUrl) continue;
            const resultImageDataUrl = await toDataUrl(primaryResultUrl);
            items.push({
              id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              createdAt: Date.now(),
              nodeId: node.id,
              providerName: activeProvider.name || 'Unknown provider',
              providerBaseUrl: activeProvider.baseUrl || '',
              modelId: String(meta?.modelId || node.data.config.modelId || 'unknown'),
              rawPrompt: result.prompt,
              optimizedPrompt: result.prompt,
              sourceImageDataUrl: undefined,
              resultImageUrl: primaryResultUrl,
              resultImageDataUrl
            });
          }

          try {
            const persistedItems: ImageHistoryItem[] = [];
            for (const item of items) {
              const persistedItem = await saveImageHistoryItem(item);
              if (persistedItem) persistedItems.push(persistedItem);
            }
            if (persistedItems.length > 0) {
              set((state) => ({ imageHistory: [...persistedItems.reverse(), ...state.imageHistory].slice(0, MAX_LOCAL_IMAGE_HISTORY_ITEMS) }));
            }
          } catch (persistErr) {
            console.error('Failed to persist batch image history items:', persistErr);
          }
        })();
      } else if (node.type === NodeType.AI_IMAGE) {
        const primaryResultUrl = getPrimaryImageUrl(finalOutput);
        if (!primaryResultUrl) {
          get().addLog('warn', `[${node.data.label}] completed without a readable primary image URL.`);
          return;
        }
        const sourceCandidates = normalizeProductImageCandidates(structuredInputs?.image);
        const sourceInput = sourceCandidates[0];
        const sourceImage = typeof sourceInput === 'string'
          ? sourceInput
          : (typeof sourceInput === 'object'
            ? String(sourceInput.previewData || sourceInput.url || sourceInput.data || '')
            : (typeof meta?.sourceImage === 'string' ? meta.sourceImage : undefined));
        const rawPrompt = String(meta?.rawPrompt || structuredInputs?.prompt || node.data.config.prompt || '').trim();
        const optimizedPrompt = String(meta?.optimizedPrompt || rawPrompt).trim();
        const modelId = String(meta?.modelId || node.data.config.modelId || 'unknown');

        void (async () => {
          const sourceImageDataUrl = await toDataUrl(sourceImage);
          const resultImageDataUrl = await toDataUrl(primaryResultUrl);
          const item: ImageHistoryItem = {
            id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
            nodeId: node.id,
            providerName: activeProvider.name || 'Unknown provider',
            providerBaseUrl: activeProvider.baseUrl || '',
            modelId,
            rawPrompt,
            optimizedPrompt,
            sourceImageDataUrl,
            resultImageUrl: primaryResultUrl,
            resultImageDataUrl
          };

          try {
            const persistedItem = await saveImageHistoryItem(item);
            if (persistedItem) {
              set((state) => ({ imageHistory: [persistedItem, ...state.imageHistory].slice(0, MAX_LOCAL_IMAGE_HISTORY_ITEMS) }));
            }
          } catch (persistErr) {
            console.error('Failed to persist image history item:', persistErr);
          }
        })();
      }









      get().addLog('success', 'Single node execution completed.', {
        nodeId: id,
        nodeLabel: node.data.label
      });
    } catch (err: any) {
      const errorMsg = normalizeUiErrorMessage(typeof err === 'string' ? err : (err?.message || 'Execution error'));
      stopNodeProgress(id);
      get().updateNodeData(id, { status: 'error', error: errorMsg, progress: undefined });
      get().addLog('error', `Node [${node.data.label}] execution failed: ${errorMsg}`);
    }
  },

  hydrateImageHistory: async () => {
    try {
      const rows = await getAllImageHistory();
      set({ imageHistory: rows.slice(0, MAX_LOCAL_IMAGE_HISTORY_ITEMS) });
    } catch (err) {
      console.error('Failed to hydrate image history:', err);
    }
  },

  deleteImageHistory: async (id: string) => {
    try {
      await deleteImageHistoryItemById(id);
      set((state) => ({ imageHistory: state.imageHistory.filter((item) => item.id !== id) }));
      get().pushNotice('info', 'History item deleted.');

    } catch (err) {
      console.error('Failed to delete image history:', err);
      get().pushNotice('error', 'Failed to delete history item.');
    }
  },

  clearImageHistory: async () => {
    try {
      await clearImageHistoryStore();
      set({ imageHistory: [] });
      get().pushNotice('warn', 'History cleared.');

    } catch (err) {
      console.error('Failed to clear image history:', err);
      get().pushNotice('error', 'Failed to clear history.');
    }
  },

  getModelsForNode: (type: NodeType) => {
    const state = get();
    const activeProvider = getActiveProviderForNodeType(
      state.apiProviders,
      state.activeProviderIds,
      state.activeProviderId,
      type
    );

    // 1. Provider-specific models
    const providerChat: string[] = [];
    const providerImage: string[] = [];
    const providerAudio: string[] = [];
    const providerVideo: string[] = [];
    if (activeProvider) {
      (activeProvider.textModels || '').split(',').map(m => m.trim()).filter(Boolean).forEach(m => providerChat.push(m));
      (activeProvider.imageModels || '').split(',').map(m => m.trim()).filter(Boolean).forEach(m => providerImage.push(m));
      (activeProvider.audioModels || '').split(',').map(m => m.trim()).filter(Boolean).forEach(m => providerAudio.push(m));
      (activeProvider.videoModels || '').split(',').map(m => m.trim()).filter(Boolean).forEach(m => providerVideo.push(m));
    }

    // 2. Global registered models
    const globalModels = get().registeredModels;
    const globalChat = globalModels.filter(m => m.modality === 'chat').map(m => m.id);
    const globalImage = globalModels.filter(m => m.modality === 'image').map(m => m.id);
    const globalAudio = globalModels.filter(m => m.modality === 'audio').map(m => m.id);
    const globalVideo = globalModels.filter(m => m.modality === 'video').map(m => m.id);

    // 3. Merge & deduplicate
    switch (type) {
      case NodeType.AI_CHAT:
      case NodeType.PRODUCT_IMAGE_MATCH:
        return Array.from(new Set([...providerChat, ...globalChat]));
      case NodeType.AI_IMAGE:
        return Array.from(new Set([...providerImage, ...globalImage]));
      case NodeType.AI_AUDIO:
        return Array.from(new Set([...providerAudio, ...globalAudio]));
      case NodeType.AI_VIDEO:
        return Array.from(new Set([...providerVideo, ...globalVideo]));
      default:
        return [];
    }
  },

  draggedModel: null,
  setDraggedModel: (model) => set({ draggedModel: model }),

  globalActiveModels: loadGlobalActiveModels(),
  setGlobalActiveModel: (modality, modelId) => set((state) => {
    const updated = { ...state.globalActiveModels, [modality]: modelId };
    localStorage.setItem('global_active_models', JSON.stringify(updated));
    return {
      globalActiveModels: updated
    };
  }),

  applyModelToNodesByModality: (modality, modelId, scope: ModelApplyScope = 'modality') => {
    const targetTypes = Object.entries(NODE_TO_MODEL_MODALITY)
      .filter(([, m]) => m === modality)
      .map(([type]) => type as NodeType);

    if (targetTypes.length === 0) {
      get().setGlobalActiveModel(modality, modelId);
      return 0;
    }

    const selectedNodeId = get().selectedNodeId;
    let affected = 0;
    set((state) => {
      const updatedGlobalModels = { ...state.globalActiveModels, [modality]: modelId };
      localStorage.setItem('global_active_models', JSON.stringify(updatedGlobalModels));
      return {
        globalActiveModels: updatedGlobalModels,
        nodes: state.nodes.map((node) => {
          const typeMatched = targetTypes.includes(node.data.type as NodeType);
          const selectedMatched = selectedNodeId ? node.id === selectedNodeId : false;
          const shouldApply =
            scope === 'selected'
              ? selectedMatched && typeMatched
              : scope === 'allCompatible'
                ? typeMatched
                : typeMatched;

          if (!shouldApply) return node;
          affected += 1;
          return {
            ...node,
            data: {
              ...node.data,
              config: {
                ...node.data.config,
                modelId
              }
            }
          };
        })
      };
    });

    if (affected > 0) {
      get().addLog('success', `Model synced: ${modality} nodes (${affected}) -> ${modelId}`);
    } else {
      get().addLog('warn', 'No compatible node is selected, so only the default model was updated.');
    }

    return affected;
  },

  registerModel: (modality, modelId) => {
    const current = get().registeredModels;
    if (current.some(m => m.id === modelId && m.modality === modality)) {
      get().addLog('warn', `Model ${modelId} is already registered globally.`);
      return;
    }
    const newModel: RegisteredModel = { id: modelId, modality, addedAt: Date.now() };
    const updated = [...current, newModel];
    localStorage.setItem('registered_models', JSON.stringify(updated));
    set({ registeredModels: updated });
    get().addLog('success', `Global model registered: ${modelId} [${modality}]`);
  },

  unregisterModel: (modelId) => {
    const updated = get().registeredModels.filter(m => m.id !== modelId);
    localStorage.setItem('registered_models', JSON.stringify(updated));
    set({ registeredModels: updated });
    get().addLog('info', `Removed from global registry: ${modelId}`);
  },

}));
