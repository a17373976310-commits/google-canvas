import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from 'reactflow';
import * as XLSX from 'xlsx';
import { Bot, FilePlus2, History, ImagePlus, Loader2, Play, PlusCircle, RefreshCw, Send, Sparkles, Trash2, X } from 'lucide-react';
import { useStore } from '../store';
import { AIService, type AgentBatchItemPayload, type AgentBatchSummary } from '../services/aiService';
import { NodeType } from '../types';
import { fileToOptimizedImageDataUrl } from '../utils/imageCompression';

type AgentTask = {
  id?: string;
  title: string;
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  imageUrls?: string[];
  status?: 'draft' | 'approved' | 'running' | 'success' | 'failed';
  error?: string;
  result?: any;
  nodeId?: string;
};

type AgentMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type CreatedWorkflow = {
  promptNodeIds: string[];
  referenceNodeIds: string[];
  imageNodeIds: string[];
  itemIds: string[];
};

type RequirementReadResult = {
  text: string;
  images: string[];
  warnings?: string[];
};

type DocumentImageAsset = {
  id: string;
  src: string;
  index: number;
  assignedTaskIds: string[];
};

type DocumentAsset = {
  id: string;
  fileName: string;
  textPreview: string;
  images: DocumentImageAsset[];
  createdAt: number;
};

type AgentToolName = 'update_tasks' | 'expand_canvas' | 'run_batch' | 'retry_failed';

type AgentToolCall = {
  tool: AgentToolName;
  parameters?: Record<string, any>;
  requires_confirmation?: boolean;
  reason?: string;
};

type AgentValidation = {
  passed: boolean;
  errors: string[];
  warnings: string[];
};

type PendingAction = {
  tool: AgentToolName;
  label: string;
  reason: string;
  tasksSnapshot: AgentTask[];
};

type AgentPanelTab = 'chat' | 'tasks' | 'history';

type PersistedAgentDraft = {
  batchId?: string | null;
  batchStatus?: string;
  requirementText: string;
  tasks: AgentTask[];
  summary: string;
  messages: AgentMessage[];
  referenceImages?: string[];
  documentAssets?: DocumentAsset[];
  storedReferenceImageCount?: number;
  savedAt: number;
};

const CANVAS_AGENT_STORAGE_KEY = 'canvas-agent-batch-draft-v1';
const SUPPORTED_ASPECT_RATIOS = new Set(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '4:5', '5:4', '21:9']);

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const clampText = (value: string, max = 26000) => (
  value.length > max ? `${value.slice(0, max)}\n\n...[内容过长，已截断]` : value
);

const stripCodeFence = (value: string) => (
  value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
);

const extractImageUrlsFromText = (text: string) => (
  Array.from(text.matchAll(/https?:\/\/[^\s"'<>，。；、)）\]]+/gi))
    .map((match) => match[0])
);

const mergeUniqueImages = (...groups: Array<Array<string | undefined | null> | undefined>) => {
  const seen = new Set<string>();
  const result: string[] = [];
  groups.forEach((group) => {
    (group || []).forEach((item) => {
      const value = String(item || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      result.push(value);
    });
  });
  return result;
};

const extractJsonObject = (value: string) => {
  const cleaned = stripCodeFence(value);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('模型没有返回可解析的 JSON');
  }
};

const readPersistedDraft = (): PersistedAgentDraft | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CANVAS_AGENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      requirementText: String(parsed.requirementText || ''),
      batchId: parsed.batchId ? String(parsed.batchId) : null,
      batchStatus: String(parsed.batchStatus || 'draft'),
      tasks: Array.isArray(parsed.tasks)
        ? parsed.tasks.map(normalizeTask).filter((task: AgentTask | null): task is AgentTask => !!task)
        : [],
      summary: String(parsed.summary || ''),
      messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-30) : [],
      referenceImages: Array.isArray(parsed.referenceImages) ? parsed.referenceImages.map(String).filter(Boolean) : [],
      documentAssets: Array.isArray(parsed.documentAssets) ? parsed.documentAssets as DocumentAsset[] : [],
      storedReferenceImageCount: Number(parsed.storedReferenceImageCount || parsed.referenceImageCount || 0),
      savedAt: Number(parsed.savedAt || Date.now())
    };
  } catch {
    return null;
  }
};

const persistDraft = (draft: PersistedAgentDraft) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CANVAS_AGENT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // LocalStorage can exceed quota if users paste huge sheets. The live session still works.
  }
};

const normalizeTask = (item: any, index: number): AgentTask | null => {
  const prompt = String(item?.prompt || item?.requirement || item?.description || '').trim();

  const rawImageFields = [
    ...(Array.isArray(item?.imageUrls) ? item.imageUrls : []),
    ...(Array.isArray(item?.images) ? item.images : []),
    ...(Array.isArray(item?.referenceImages) ? item.referenceImages : []),
    item?.imageUrl,
    item?.image,
    ...extractImageUrlsFromText(prompt)
  ];
  const imageUrls = mergeUniqueImages(rawImageFields.map((url: unknown) => String(url || '').trim()));

  return {
    title: String(item?.title || item?.name || `任务 ${index + 1}`).trim() || `任务 ${index + 1}`,
    prompt,
    aspectRatio: String(item?.aspectRatio || item?.ratio || '1:1').trim() || '1:1',
    imageSize: String(item?.imageSize || item?.size || '1K').trim() || '1K',
    imageUrls,
    id: String(item?.id || `item-${index + 1}`),
    status: (String(item?.status || 'draft') as AgentTask['status']) || 'draft',
    error: String(item?.error || ''),
    result: item?.result,
    nodeId: String(item?.nodeId || '')
  };
};

const validateAgentTasks = (tasks: AgentTask[], referenceImageCount = 0): AgentValidation => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenPrompts = new Set<string>();

  if (tasks.length === 0) {
    errors.push('还没有可执行的出图任务。');
  }

  tasks.forEach((task, index) => {
    const label = task.title || `任务 ${index + 1}`;
    const prompt = task.prompt.trim();
    if (!prompt) {
      errors.push(`${label} 的提示词为空。`);
      return;
    }
    if (/同上|同前|如上|保持上一张|参考上一条/.test(prompt)) {
      errors.push(`${label} 的提示词依赖上一条内容，不是自包含提示词。`);
    }
    if (prompt.length < 12) {
      warnings.push(`${label} 的提示词过短，可能无法稳定出图。`);
    }
    const normalizedPrompt = prompt.replace(/\s+/g, ' ');
    if (seenPrompts.has(normalizedPrompt)) {
      warnings.push(`${label} 与前面任务提示词完全重复。`);
    }
    seenPrompts.add(normalizedPrompt);

    const aspectRatio = String(task.aspectRatio || '').trim();
    if (aspectRatio && !SUPPORTED_ASPECT_RATIOS.has(aspectRatio) && !/^\d+:\d+$/.test(aspectRatio)) {
      warnings.push(`${label} 的比例“${aspectRatio}”可能不被当前图像模型支持。`);
    }
  });

  if (referenceImageCount > 1 && tasks.length > 1 && referenceImageCount !== tasks.length) {
    warnings.push(`当前有 ${referenceImageCount} 张参考图和 ${tasks.length} 个任务，数量不一致；系统会把参考图作为整批共享参考。`);
  }

  return { passed: errors.length === 0, errors, warnings };
};

const formatValidationMessage = (validation: AgentValidation) => [
  validation.errors.length > 0 ? `阻止执行：${validation.errors.join('；')}` : '',
  validation.warnings.length > 0 ? `提醒：${validation.warnings.join('；')}` : ''
].filter(Boolean).join('\n');

const formatBatchTime = (value?: number) => {
  if (!value) return '未知时间';
  const timestamp = value < 10_000_000_000 ? value * 1000 : value;
  return new Date(timestamp).toLocaleString();
};

const getBatchStatusLabel = (status?: string) => {
  const map: Record<string, string> = {
    draft: '草稿',
    approved: '已确认',
    running: '运行中',
    success: '已完成',
    partial: '部分失败',
    failed: '失败'
  };
  return map[String(status || 'draft')] || String(status || '草稿');
};

const getBatchStatusClass = (status?: string) => {
  if (status === 'success') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200';
  if (status === 'partial' || status === 'failed') return 'border-rose-400/20 bg-rose-400/10 text-rose-200';
  if (status === 'running') return 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200';
  return 'border-white/10 bg-white/[0.06] text-gray-300';
};

const formatStatusCounts = (counts?: Record<string, number>) => {
  if (!counts) return '';
  const parts = [
    counts.success ? `成功 ${counts.success}` : '',
    counts.failed ? `失败 ${counts.failed}` : '',
    counts.running ? `运行中 ${counts.running}` : '',
    counts.draft ? `草稿 ${counts.draft}` : '',
  ].filter(Boolean);
  return parts.join(' / ');
};

const isRemoteUrl = (value: string) => /^https?:\/\//i.test(value);
const isInlineImageData = (value: string) => /^data:image\//i.test(value);

const buildFallbackTasks = (text: string): AgentTask[] => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[-=]{3,}$/.test(line));

  const candidates = lines.length > 1 ? lines : text.split(/[。；;]/).map((line) => line.trim()).filter(Boolean);
  return candidates.slice(0, 30).map((line, index) => ({
    title: `任务 ${index + 1}`,
    prompt: line,
    aspectRatio: /横|banner|16:9|21:9/i.test(line) ? '16:9' : (/竖|海报|9:16|3:4/i.test(line) ? '3:4' : '1:1'),
    imageSize: '1K',
    imageUrls: extractImageUrlsFromText(line),
    id: `item-${index + 1}`,
    status: 'draft'
  }));
};

const bytesToDataUrl = async (bytes: Uint8Array, mime: string) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('Image read failed'));
  reader.readAsDataURL(new Blob([bytes], { type: mime }));
});

const detectDispimgRefs = (text: string) => (
  Array.from(text.matchAll(/DISPIMG\s*\(\s*["']?([^"',)]+)["']?/gi)).map((match) => match[1])
);

const inferImageMime = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'svg') return 'image/svg+xml';
  return 'image/png';
};

const getWorkbookEntryBytes = (entry: any): Uint8Array | null => {
  const content = entry?.content ?? entry?.data ?? entry;
  if (!content) return null;
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (ArrayBuffer.isView(content)) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  if (Array.isArray(content)) return Uint8Array.from(content);
  if (typeof content === 'string') {
    const binary = content.startsWith('data:')
      ? atob(content.split(',', 2)[1] || '')
      : content;
    return Uint8Array.from(binary, (char) => char.charCodeAt(0) & 0xff);
  }
  return null;
};

const extractWorkbookImages = async (files: Record<string, any> | undefined, limit = 24) => {
  if (!files) return [];
  const mediaPaths = Object.keys(files)
    .filter((path) => /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(path.replace(/^\/+/, '')))
    .slice(0, limit);

  const images: string[] = [];
  for (const path of mediaPaths) {
    const bytes = getWorkbookEntryBytes(files[path]);
    if (!bytes) continue;
    try {
      const name = path.split('/').pop() || `embedded-${images.length + 1}.png`;
      const mime = inferImageMime(path);
      const file = new File([bytes], name, { type: mime });
      images.push(await fileToOptimizedImageDataUrl(file, { maxEdge: 1200, quality: 0.82 }));
    } catch {
      try {
        images.push(await bytesToDataUrl(bytes, inferImageMime(path)));
      } catch {
        // Ignore unreadable embedded images; text parsing should still work.
      }
    }
  }
  return images;
};

const readRequirementFile = async (file: File): Promise<RequirementReadResult> => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx') || name.endsWith('.doc') || name.endsWith('.pdf')) {
    const service = new AIService();
    return service.parseRequirementDocument(file);
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', bookFiles: true });
    const embeddedImages = await extractWorkbookImages((workbook as any).files);
    const sections = workbook.SheetNames.slice(0, 6).map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' }).slice(0, 160);
      const textRows = rows
        .map((row) => row.map((cell) => String(cell ?? '').trim()).join('\t').trim())
        .filter(Boolean);
      return [`# 工作表：${sheetName}`, ...textRows].join('\n');
    });
    const text = sections.join('\n\n');
    const dispimgRefs = detectDispimgRefs(text);
    const warnings: string[] = [];
    if (dispimgRefs.length > 0 && embeddedImages.length === 0) {
      warnings.push(
        `检测到 ${dispimgRefs.length} 个 DISPIMG 图片占位符，但没有从表格里提取到真实图片。` +
        `这些 ID 不是图片内容，模型无法看图；请把文件另存为 .xlsx 后重传，或直接把产品图/证书图/场景图作为“参考图”上传。`
      );
    } else if (dispimgRefs.length > embeddedImages.length) {
      warnings.push(
        `检测到 ${dispimgRefs.length} 个 DISPIMG 图片占位符，但只提取到 ${embeddedImages.length} 张真实图片；仍可能有部分任务缺图。`
      );
    }
    return { text, images: embeddedImages, warnings };
  }

  return { text: await file.text(), images: [] };
};

const buildAgentSystemPrompt = () => [
  '你是嵌入在 AI Canvas 里的画布智能体，不是普通客服。',
  '你的职责是和用户沟通需求，澄清缺失信息，把需求拆成可审查的批量出图任务，并在用户确认后辅助展开/运行画布。',
  '你必须友好、简洁、直接。用户说中文时用中文。',
  '重点规则：',
  '- 如果需求不清楚，先追问关键缺失项，不要硬编。',
  '- 如果信息足够，就生成或更新 tasks。',
  '- 每个 task 对应一张真实要生成的图。',
  '- task.prompt 必须是干净、完整、自包含、可直接给图像模型使用的中文提示词。',
  '- 如果用户提供了产品图、参考图或图片链接，必须把对应图片放进 task.imageUrls；如果整批共享同一组产品图，可以让每个 task.imageUrls 为空，由系统使用整批参考图。',
  '- 如果材料里只有 DISPIMG、图片 ID、文件名、图片编号，但 image 输入里没有真实图片，你必须明确告知用户补充真实图片，不要根据 ID 猜测锅具、证书、场景或主体外观。',
  '- 如果用户要求“一图一任务/按上传顺序对应/每个链接对应一张”，必须按顺序把每个图片链接放到对应 task.imageUrls。',
  '- 不要写“同上”，不要继承旧提示词，不要依赖隐藏上下文。',
  '- 如果用户要求修改某几条任务，只更新相关任务，保留其它任务。',
  '- aspectRatio 可用 1:1、4:3、3:4、16:9、9:16、3:2、2:3、4:5、21:9。',
  '- imageSize 可用 1K、2K、4K；不确定用 1K。',
  '- 用户明确说“展开到画布”“帮我跑”“直接生成”时，用 tool_calls 表达动作意图，但不要在回复里假装已经执行。',
  '- 如果只是更新任务草案，使用 update_tasks；如果要创建画布节点，使用 expand_canvas；如果要批量执行，使用 run_batch；如果用户要重试失败项，使用 retry_failed。',
  '- validation 里必须给出你对任务草案的自检结果：是否通过、错误、提醒。错误用于阻止执行，提醒用于提示用户。',
  '你只能返回严格 JSON，不要 Markdown，不要代码块。',
  'JSON 格式：',
  '{"reply":"给用户看的自然语言回复","summary":"当前计划摘要","plan":[{"step_id":1,"description":"","tool":"update_tasks|expand_canvas|run_batch|retry_failed|null","validation":""}],"tasks":[{"title":"","prompt":"","aspectRatio":"1:1","imageSize":"1K","imageUrls":[]}],"tool_calls":[{"tool":"update_tasks|expand_canvas|run_batch|retry_failed","parameters":{},"requires_confirmation":true,"reason":""}],"validation":{"passed":true,"errors":[],"warnings":[]}}',
  '如果只是聊天或追问，tasks 可以省略或返回当前 tasks。'
].join('\n');

const buildAgentUserPayload = (params: {
  userMessage: string;
  requirementText: string;
  referenceImageCount: number;
  documentAssets: DocumentAsset[];
  tasks: AgentTask[];
  messages: AgentMessage[];
  canvasSummary: string;
}) => JSON.stringify({
  userMessage: params.userMessage,
  requirementText: clampText(params.requirementText),
  referenceImageCount: params.referenceImageCount,
  imageManifest: params.referenceImageCount > 0
    ? {
      instruction: '本次请求已随 image 输入附带图片，图片顺序与这里的序号一致。分析产品/参考图时必须结合视觉内容，不要只根据文件名或 DISPIMG 文本猜测。',
      totalImages: params.referenceImageCount,
      documents: params.documentAssets.map((asset) => ({
        fileName: asset.fileName,
        imageIndexes: asset.images.map((image) => image.index),
        imageCount: asset.images.length
      }))
    }
    : {
      instruction: '本次请求没有附带可视觉识别的图片。如果需求文本里出现 DISPIMG、图片 ID、图片文件名或“见图”，应明确提示用户重新上传包含图片的原始文件或图片素材，不要猜测图片内容。',
      totalImages: 0,
      documents: []
    },
  currentTasks: params.tasks,
  recentConversation: params.messages.slice(-10).map((message) => ({
    role: message.role,
    content: message.content
  })),
  canvasSummary: params.canvasSummary
}, null, 2);

const wantsRun = (text: string) => /帮我.*(跑|生成|执行)|直接.*(跑|生成|执行)|开始.*(跑|生成|执行)|批量跑|跑图|生成图片/.test(text);
const wantsExpand = (text: string) => /展开|放到画布|生成节点|创建节点|搭.*工作流/.test(text);
const defaultWelcomeMessage: AgentMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '把需求、表格或参考图给我，然后直接告诉我你想怎么拆。我会先和你确认任务计划，再帮你展开到画布或批量跑图。'
};

export const CanvasAgentPanel: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const reactFlow = useReactFlow();
  const requirementFileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const initialDraft = useMemo(() => readPersistedDraft(), []);
  const [requirementText, setRequirementText] = useState(initialDraft?.requirementText || '');
  const [chatInput, setChatInput] = useState('');
  const [tasks, setTasks] = useState<AgentTask[]>(initialDraft?.tasks || []);
  const [summary, setSummary] = useState(initialDraft?.summary || '');
  const [messages, setMessages] = useState<AgentMessage[]>(
    initialDraft?.messages?.length ? initialDraft.messages : [defaultWelcomeMessage]
  );
  const [referenceImages, setReferenceImages] = useState<string[]>(initialDraft?.referenceImages || []);
  const [documentAssets, setDocumentAssets] = useState<DocumentAsset[]>(initialDraft?.documentAssets || []);
  const [storedReferenceImageCount, setStoredReferenceImageCount] = useState(initialDraft?.storedReferenceImageCount || initialDraft?.referenceImages?.length || 0);
  const [createdWorkflow, setCreatedWorkflow] = useState<CreatedWorkflow | null>(null);
  const [batchId, setBatchId] = useState<string | null>(initialDraft?.batchId || null);
  const [batchStatus, setBatchStatus] = useState(initialDraft?.batchStatus || 'draft');
  const [isBatchSaving, setIsBatchSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [lastValidation, setLastValidation] = useState<AgentValidation>(() => validateAgentTasks(initialDraft?.tasks || []));
  const [isThinking, setIsThinking] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [loadingBatchId, setLoadingBatchId] = useState<string | null>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [batchHistory, setBatchHistory] = useState<AgentBatchSummary[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [activePanel, setActivePanel] = useState<AgentPanelTab>(initialDraft?.tasks?.length ? 'tasks' : 'chat');

  const {
    nodes,
    edges,
    addNode,
    updateNodeData,
    onConnect,
    executeSingleNode,
    pushNotice,
    apiProviders,
    activeProviderId,
    activeProviderIds,
    globalActiveModels,
    getModelsForNode,
  } = useStore();

  const activeProvider = apiProviders.find((provider) => provider.id === (activeProviderIds?.chat || activeProviderId));
  const imageModelId = globalActiveModels.image || getModelsForNode(NodeType.AI_IMAGE)[0] || '';
  const chatModelId = globalActiveModels.chat || getModelsForNode(NodeType.AI_CHAT)[0] || '';
  const readyTaskCount = useMemo(() => tasks.filter((task) => task.prompt.trim()).length, [tasks]);
  const failedTaskCount = useMemo(() => tasks.filter((task) => task.status === 'failed').length, [tasks]);
  const imageBoundTaskCount = useMemo(() => tasks.filter((task) => (task.imageUrls || []).length > 0).length, [tasks]);
  const documentImageCount = useMemo(
    () => documentAssets.reduce((total, asset) => total + asset.images.length, 0),
    [documentAssets]
  );
  const currentValidation = useMemo(
    () => validateAgentTasks(tasks, referenceImages.length),
    [referenceImages.length, tasks]
  );

  useEffect(() => {
    setLastValidation(currentValidation);
  }, [currentValidation]);

  useEffect(() => {
    persistDraft({
      batchId,
      batchStatus,
      requirementText,
      tasks,
      summary,
      messages: messages.slice(-30),
      referenceImages,
      documentAssets,
      storedReferenceImageCount,
      savedAt: Date.now()
    });
  }, [batchId, batchStatus, documentAssets, messages, referenceImages, requirementText, storedReferenceImageCount, summary, tasks]);

  const toBatchItems = useCallback((sourceTasks: AgentTask[]): AgentBatchItemPayload[] => (
    sourceTasks.map((task, index) => ({
      id: task.id || `item-${index + 1}`,
      title: task.title,
      prompt: task.prompt,
      aspectRatio: task.aspectRatio || '1:1',
      imageSize: task.imageSize || '1K',
      imageUrls: task.imageUrls || [],
      status: task.status || 'draft',
      error: task.error || '',
      result: task.result,
      nodeId: task.nodeId || ''
    }))
  ), []);

  const saveBatchDraft = useCallback(async (sourceTasks = tasks, options?: { status?: string; approvedAt?: number | null }) => {
    if (sourceTasks.length === 0 && !requirementText.trim()) return null;
    setIsBatchSaving(true);
    try {
      const service = new AIService();
      const saved = await service.saveAgentBatch({
        id: batchId || undefined,
        name: summary || `画布智能体批次 ${new Date().toLocaleString()}`,
        summary,
        requirementText,
        status: options?.status || batchStatus,
        modelId: chatModelId,
        imageModelId,
        referenceImageCount: referenceImages.length > 0 ? referenceImages.length : storedReferenceImageCount,
        referenceImages,
        documentAssets,
        items: toBatchItems(sourceTasks),
        approvedAt: options?.approvedAt ?? null
      });
      if (saved?.id && saved.id !== batchId) {
        setBatchId(saved.id);
      }
      if (options?.status) {
        setBatchStatus(options.status);
      }
      setLastSavedAt(Date.now());
      return saved;
    } catch (error) {
      console.warn('Failed to save agent batch draft:', error);
      return null;
    } finally {
      setIsBatchSaving(false);
    }
  }, [batchId, batchStatus, chatModelId, documentAssets, imageModelId, referenceImages, requirementText, storedReferenceImageCount, summary, tasks, toBatchItems]);

  const patchBatchItem = useCallback(async (effectiveBatchId: string | null, itemId: string, patch: Partial<AgentTask>) => {
    setTasks((prev) => prev.map((task) => (
      (task.id || '') === itemId
        ? { ...task, ...patch }
        : task
    )));
    if (!effectiveBatchId) return;
    try {
      const service = new AIService();
      const saved = await service.patchAgentBatchItem(effectiveBatchId, itemId, patch);
      if (saved?.status) {
        setBatchStatus(String(saved.status));
      }
      setLastSavedAt(Date.now());
    } catch (error) {
      console.warn('Failed to patch agent batch item:', error);
    }
  }, []);

  useEffect(() => {
    if (tasks.length === 0 && !requirementText.trim()) return;
    const timer = window.setTimeout(() => {
      void saveBatchDraft();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [requirementText, saveBatchDraft, tasks]);

  const canvasSummary = useMemo(() => {
    const counts = nodes.reduce<Record<string, number>>((acc, node) => {
      const type = String(node.type || node.data?.type || 'UNKNOWN');
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    return JSON.stringify({
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodeTypes: counts,
      selectedChatModel: chatModelId,
      selectedImageModel: imageModelId
    });
  }, [chatModelId, edges.length, imageModelId, nodes]);

  const appendMessage = useCallback((message: Omit<AgentMessage, 'id'>) => {
    setMessages((prev) => [...prev, { ...message, id: makeId() }]);
  }, []);

  const loadBatchHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    setHistoryError('');
    try {
      const service = new AIService();
      const items = await service.listAgentBatches(50);
      setBatchHistory(items);
    } catch (error: any) {
      const message = error?.message || '批次历史读取失败';
      setHistoryError(message);
      pushNotice('error', message);
    } finally {
      setIsHistoryLoading(false);
    }
  }, [pushNotice]);

  const toggleHistory = useCallback(() => {
    setIsHistoryOpen((prev) => {
      const next = !prev;
      if (next) {
        void loadBatchHistory();
        setActivePanel('history');
      }
      return next;
    });
  }, [loadBatchHistory]);

  const deleteHistoryBatch = useCallback(async (targetBatchId: string) => {
    if (!window.confirm('确定删除这个历史批次吗？删除后不能恢复。')) return;
    setDeletingBatchId(targetBatchId);
    setHistoryError('');
    try {
      const service = new AIService();
      await service.deleteAgentBatch(targetBatchId);
      setBatchHistory((prev) => prev.filter((item) => item.id !== targetBatchId));
      if (batchId === targetBatchId) {
        setBatchId(null);
        setBatchStatus('draft');
        setRequirementText('');
        setSummary('');
        setTasks([]);
        setReferenceImages([]);
        setDocumentAssets([]);
        setStoredReferenceImageCount(0);
        setCreatedWorkflow(null);
        setPendingAction(null);
        setMessages([defaultWelcomeMessage]);
        setLastSavedAt(null);
      }
      pushNotice('success', '已删除历史批次');
    } catch (error: any) {
      const message = error?.message || '历史批次删除失败';
      setHistoryError(message);
      pushNotice('error', message);
    } finally {
      setDeletingBatchId(null);
    }
  }, [batchId, pushNotice]);

  const loadHistoryBatch = useCallback(async (targetBatchId: string) => {
    setLoadingBatchId(targetBatchId);
    setHistoryError('');
    try {
      const service = new AIService();
      const batch = await service.getAgentBatch(targetBatchId);
      const nextTasks = Array.isArray(batch?.items)
        ? batch.items.map(normalizeTask).filter((task: AgentTask | null): task is AgentTask => !!task)
        : [];
      const restoredReferenceImages = Array.isArray((batch as any)?.referenceImages)
        ? (batch as any).referenceImages.map(String).filter(Boolean)
        : [];
      const restoredDocumentAssets = Array.isArray((batch as any)?.documentAssets)
        ? (batch as any).documentAssets as DocumentAsset[]
        : [];
      setBatchId(batch.id);
      setBatchStatus(String(batch.status || 'draft'));
      setStoredReferenceImageCount(restoredReferenceImages.length || Number(batch.referenceImageCount || 0));
      setRequirementText(String(batch.requirementText || ''));
      setSummary(String(batch.summary || ''));
      setTasks(nextTasks);
      setReferenceImages(restoredReferenceImages);
      setDocumentAssets(restoredDocumentAssets);
      setCreatedWorkflow(null);
      setPendingAction(null);
      setLastSavedAt(Number(batch.updatedAt || Date.now()));
      setLastValidation(validateAgentTasks(nextTasks, restoredReferenceImages.length));
      setMessages([
        defaultWelcomeMessage,
        {
          id: makeId(),
          role: 'assistant',
          content: restoredReferenceImages.length > 0
            ? `已加载历史批次「${batch.name || batch.id}」，共 ${nextTasks.length} 个任务，并恢复了 ${restoredReferenceImages.length} 张图片素材。`
            : `已加载历史批次「${batch.name || batch.id}」，共 ${nextTasks.length} 个任务。这个批次没有保存到图片素材，如果需求依赖表格/文档里的图片，请重新上传原始文件后再分析。`
        }
      ]);
      setIsHistoryOpen(false);
      setActivePanel('tasks');
      pushNotice('success', `已加载批次：${batch.name || batch.id}`);
    } catch (error: any) {
      const message = error?.message || '批次加载失败';
      setHistoryError(message);
      pushNotice('error', message);
    } finally {
      setLoadingBatchId(null);
    }
  }, [pushNotice]);

  const handleRequirementFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      const { text, images, warnings = [] } = await readRequirementFile(file);
      const warningText = warnings.length > 0
        ? `\n\n# 文件读取警告\n${warnings.map((warning) => `- ${warning}`).join('\n')}`
        : '';
      setRequirementText((prev) => [prev, `\n\n# 文件：${file.name}\n${text}`].filter(Boolean).join('\n'));
      if (warningText) {
        setRequirementText((prev) => `${prev}${warningText}`);
      }
      if (images.length > 0) {
        setReferenceImages((prev) => [...prev, ...images]);
        setStoredReferenceImageCount((prev) => prev + images.length);
        setDocumentAssets((prev) => [
          ...prev,
          {
            id: makeId(),
            fileName: file.name,
            textPreview: text.slice(0, 260),
            createdAt: Date.now(),
            images: images.map((src, index) => ({
              id: `${file.name}-${Date.now()}-${index}`,
              src,
              index: index + 1,
              assignedTaskIds: []
            }))
          }
        ]);
        setCreatedWorkflow(null);
        setPendingAction(null);
      }
      appendMessage({
        role: 'assistant',
        content: warnings.length > 0
          ? `我已经读到文件「${file.name}」，但发现图片没有完整提取：${warnings.join('；')} 现在不能只靠这些图片 ID 拆任务，需要你补充真实图片素材。`
          : images.length > 0
          ? `我已经读到文件「${file.name}」，并提取到 ${images.length} 张表格内图片。接下来分析时我会把这些图片一起发给当前对话模型。`
          : `我已经读到文件「${file.name}」。你可以告诉我按什么规则拆，或者直接说“分析并生成计划”。`
      });
      if (warnings.length > 0) {
        pushNotice('warn', '表格里的图片没有完整提取，请补充真实图片素材');
      } else {
        pushNotice('success', `已读取需求文件：${file.name}`);
      }
    } catch (error: any) {
      pushNotice('error', error?.message || '需求文件读取失败');
    }
  }, [appendMessage, pushNotice]);

  const handleImageFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const images = await Promise.all(Array.from(files).slice(0, 60).map((file) => fileToOptimizedImageDataUrl(file)));
      setReferenceImages((prev) => [...prev, ...images]);
      setStoredReferenceImageCount((prev) => prev + images.length);
      setCreatedWorkflow(null);
      setPendingAction(null);
      appendMessage({ role: 'assistant', content: `我收到了 ${images.length} 张参考图。若需要一图对应一条任务，你可以直接告诉我“按上传顺序一一对应”。` });
      pushNotice('success', `已导入 ${images.length} 张参考图`);
    } catch {
      pushNotice('error', '参考图读取失败');
    }
  }, [appendMessage, pushNotice]);

  const expandToCanvas = useCallback(async (taskOverride?: AgentTask[]) => {
    const sourceTasks = taskOverride || tasks;
    const validation = validateAgentTasks(sourceTasks, referenceImages.length);
    setLastValidation(validation);
    if (!validation.passed) {
      const message = formatValidationMessage(validation);
      appendMessage({ role: 'assistant', content: message });
      pushNotice('error', '任务自检未通过，已阻止展开');
      return null;
    }

    const validTasks = sourceTasks.filter((task) => task.prompt.trim());

    setIsExpanding(true);
    try {
      const center = reactFlow.project({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2
      });
      const promptNodeIds: string[] = [];
      const referenceNodeIds: string[] = [];
      const imageNodeIds: string[] = [];
      const itemIds: string[] = [];
      const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(validTasks.length))));
      const rowGap = 340;
      const globalImageUrls = extractImageUrlsFromText(requirementText);
      const taskImages = validTasks.map((task, index) => (
        mergeUniqueImages(
          task.imageUrls,
          extractImageUrlsFromText(task.prompt),
          referenceImages.length === validTasks.length ? [referenceImages[index]] : []
        )
      ));
      const sharedImages = referenceImages.length > 0 && referenceImages.length !== validTasks.length
        ? mergeUniqueImages(referenceImages)
        : (
          referenceImages.length === 0 && taskImages.every((items) => items.length === 0)
            ? mergeUniqueImages(globalImageUrls)
            : []
        );
      const hasReferenceInputs = sharedImages.length > 0 || taskImages.some((items) => items.length > 0);
      const colGap = hasReferenceInputs ? 1120 : 820;
      const startX = center.x - ((cols - 1) * colGap) / 2 - 260;
      const startY = center.y - 180;
      let sharedReferenceNodeId: string | null = null;

      if (sharedImages.length > 0) {
        sharedReferenceNodeId = addNode(
          sharedImages.length > 1 ? NodeType.MULTI_IMAGE_UPLOAD : NodeType.IMAGE_UPLOAD,
          { x: startX - 390, y: startY - 10 }
        );
        updateNodeData(sharedReferenceNodeId, {
          label: sharedImages.length > 1 ? '共享产品图' : '共享产品图 1',
          output: sharedImages.length > 1 ? sharedImages : sharedImages[0],
          status: 'success',
          meta: {
            canvasAgent: true,
            role: 'shared_reference_images',
            imageCount: sharedImages.length
          }
        });
        referenceNodeIds.push(sharedReferenceNodeId);
      }

      validTasks.forEach((task, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const promptId = addNode(NodeType.INPUT, { x: startX + col * colGap, y: startY + row * rowGap });
        const taskImageRefs = taskImages[index] || [];
        const referenceId = taskImageRefs.length > 0
          ? addNode(
            taskImageRefs.length > 1 ? NodeType.MULTI_IMAGE_UPLOAD : NodeType.IMAGE_UPLOAD,
            { x: startX + col * colGap + 370, y: startY + row * rowGap }
          )
          : null;
        const imageId = addNode(NodeType.AI_IMAGE, { x: startX + col * colGap + (hasReferenceInputs ? 760 : 410), y: startY + row * rowGap });
        const itemId = task.id || `item-${index + 1}`;

        updateNodeData(promptId, {
          label: `提示词 ${index + 1}`,
          config: { prompt: task.prompt },
          output: task.prompt,
          status: 'success',
          meta: { canvasAgent: true, taskTitle: task.title }
        });
        if (referenceId) {
          updateNodeData(referenceId, {
            label: `产品图 ${index + 1}`,
            output: taskImageRefs.length > 1 ? taskImageRefs : taskImageRefs[0],
            status: 'success',
            meta: {
              canvasAgent: true,
              role: 'task_reference_images',
              taskTitle: task.title,
              taskIndex: index + 1,
              imageCount: taskImageRefs.length
            }
          });
          referenceNodeIds.push(referenceId);
        }
        updateNodeData(imageId, {
          label: task.title || `出图 ${index + 1}`,
          config: {
            prompt: '',
            modelId: imageModelId,
            aspectRatio: task.aspectRatio || '1:1',
            imageSize: task.imageSize || '1K',
            promptTemplate: 'free_mode',
            enablePromptTemplate: false
          },
          meta: { canvasAgent: true, taskIndex: index + 1, taskTitle: task.title }
        });
        onConnect({
          source: promptId,
          sourceHandle: 'output',
          target: imageId,
          targetHandle: 'prompt'
        });
        const imageSourceNodeId = referenceId || sharedReferenceNodeId;
        if (imageSourceNodeId) {
          onConnect({
            source: imageSourceNodeId,
            sourceHandle: 'output',
            target: imageId,
            targetHandle: 'image'
          });
        }
        promptNodeIds.push(promptId);
        imageNodeIds.push(imageId);
        itemIds.push(itemId);
      });

      const workflow = { promptNodeIds, referenceNodeIds, imageNodeIds, itemIds };
      setCreatedWorkflow(workflow);
      setPendingAction(null);
      const sourceMatchesCurrent = validTasks.every((sourceTask, sourceIndex) => {
        const sourceId = sourceTask.id || `item-${sourceIndex + 1}`;
        return tasks.some((task, taskIndex) => (
          (task.id || `item-${taskIndex + 1}`) === sourceId
          && task.prompt === sourceTask.prompt
        ));
      });
      const baseTasks = sourceMatchesCurrent ? tasks : sourceTasks;
      const updatedIds = new Set<string>();
      const nextTasks = baseTasks.map((task, index) => {
        const itemId = task.id || `item-${index + 1}`;
        const workflowIndex = itemIds.indexOf(itemId);
        if (workflowIndex < 0) {
          return { ...task, id: itemId };
        }
        updatedIds.add(itemId);
        return {
          ...task,
          id: itemId,
          imageUrls: mergeUniqueImages(task.imageUrls, taskImages[workflowIndex]),
          status: task.status || 'draft',
          nodeId: imageNodeIds[workflowIndex] || task.nodeId || ''
        };
      });
      validTasks.forEach((task, index) => {
        const itemId = task.id || `item-${index + 1}`;
        if (updatedIds.has(itemId)) return;
        nextTasks.push({
          ...task,
          id: itemId,
          imageUrls: mergeUniqueImages(task.imageUrls, taskImages[index]),
          status: task.status || 'draft',
          nodeId: imageNodeIds[index] || task.nodeId || ''
        });
      });
      setTasks(nextTasks);
      void saveBatchDraft(nextTasks);
      setTimeout(() => reactFlow.fitView({ duration: 500, padding: 0.18 }), 80);
      pushNotice('success', `已展开 ${validTasks.length} 个出图节点`);
      appendMessage({ role: 'assistant', content: `已把 ${validTasks.length} 个任务展开到画布。你可以检查节点提示词，没问题后点“批量跑图”。` });
      return workflow;
    } finally {
      setIsExpanding(false);
    }
  }, [addNode, appendMessage, imageModelId, onConnect, pushNotice, reactFlow, referenceImages, saveBatchDraft, tasks, updateNodeData]);

  const runCreatedWorkflow = useCallback(async (taskOverride?: AgentTask[], options?: { forceExpand?: boolean }) => {
    const sourceTasks = taskOverride || tasks;
    const validation = validateAgentTasks(sourceTasks, referenceImages.length);
    setLastValidation(validation);
    if (!validation.passed) {
      const message = formatValidationMessage(validation);
      appendMessage({ role: 'assistant', content: message });
      pushNotice('error', '任务自检未通过，已阻止批量跑图');
      return;
    }

    const isPartialRun = !!taskOverride && taskOverride.length < tasks.length;
    const savedBatch = await saveBatchDraft(isPartialRun ? tasks : sourceTasks, { status: 'approved', approvedAt: Date.now() });
    const effectiveBatchId = savedBatch?.id || batchId;
    const canReuseWorkflow = !options?.forceExpand
      && !!createdWorkflow
      && createdWorkflow.imageNodeIds.length === sourceTasks.length
      && createdWorkflow.itemIds.every((itemId, index) => itemId === (sourceTasks[index]?.id || `item-${index + 1}`));
    const workflow = canReuseWorkflow ? createdWorkflow : await expandToCanvas(sourceTasks);
    if (!workflow) return;

    setIsRunning(true);
    try {
      for (const nodeId of workflow.promptNodeIds) {
        await executeSingleNode(nodeId);
      }
      for (let index = 0; index < workflow.imageNodeIds.length; index += 1) {
        const nodeId = workflow.imageNodeIds[index];
        const itemId = workflow.itemIds[index] || sourceTasks[index]?.id || `item-${index + 1}`;
        await patchBatchItem(effectiveBatchId, itemId, { status: 'running', error: '', nodeId });
        await executeSingleNode(nodeId);
        const freshNode = useStore.getState().nodes.find((node) => node.id === nodeId);
        if (freshNode?.data.status === 'error') {
          await patchBatchItem(effectiveBatchId, itemId, {
            status: 'failed',
            error: freshNode.data.error || '执行失败',
            nodeId
          });
        } else {
          await patchBatchItem(effectiveBatchId, itemId, {
            status: 'success',
            error: '',
            result: freshNode?.data.output,
            nodeId
          });
        }
      }
      pushNotice('success', '这批画布任务已提交完成');
      setPendingAction(null);
      appendMessage({ role: 'assistant', content: '这批任务已经按顺序提交完成。你可以在画布节点和图像历史里检查结果。' });
    } finally {
      setIsRunning(false);
    }
  }, [appendMessage, batchId, createdWorkflow, executeSingleNode, expandToCanvas, patchBatchItem, pushNotice, referenceImages.length, saveBatchDraft, tasks]);

  const updateTasksFromParsed = useCallback((parsed: any) => {
    const taskPayload = Array.isArray(parsed?.tasks)
      ? parsed.tasks
      : (
        Array.isArray(parsed?.tool_calls)
          ? parsed.tool_calls.find((call: any) => call?.tool === 'update_tasks' && Array.isArray(call?.parameters?.tasks))?.parameters?.tasks
          : []
      );
    const normalized = Array.isArray(taskPayload)
      ? taskPayload.map(normalizeTask).filter((task: AgentTask | null): task is AgentTask => !!task)
      : [];
    if (normalized.length > 0) {
      setTasks(normalized.slice(0, 80));
      setBatchStatus('draft');
      setActivePanel('tasks');
      setCreatedWorkflow(null);
      setPendingAction(null);
      setLastValidation(validateAgentTasks(normalized, referenceImages.length));
    }
    if (typeof parsed?.summary === 'string') {
      setSummary(parsed.summary);
    } else if (normalized.length > 0) {
      setSummary(`已准备 ${normalized.length} 个出图任务`);
    }
    return normalized;
  }, [referenceImages.length]);

  const normalizeToolCalls = useCallback((parsed: any, text: string): AgentToolCall[] => {
    const calls: AgentToolCall[] = Array.isArray(parsed?.tool_calls)
      ? parsed.tool_calls
          .map((call: any) => ({
            tool: String(call?.tool || '') as AgentToolName,
            parameters: typeof call?.parameters === 'object' && call.parameters ? call.parameters : {},
            requires_confirmation: call?.requires_confirmation !== false,
            reason: String(call?.reason || '')
          }))
          .filter((call: AgentToolCall) => ['update_tasks', 'expand_canvas', 'run_batch', 'retry_failed'].includes(call.tool))
      : [];

    const legacyAction = String(parsed?.action || 'none');
    if (legacyAction === 'run') {
      calls.push({ tool: 'run_batch', requires_confirmation: true, reason: '模型建议批量运行' });
    } else if (legacyAction === 'expand') {
      calls.push({ tool: 'expand_canvas', requires_confirmation: true, reason: '模型建议展开到画布' });
    }

    if (calls.length === 0 && wantsRun(text)) {
      calls.push({ tool: 'run_batch', requires_confirmation: false, reason: '你明确要求批量跑图' });
    } else if (calls.length === 0 && wantsExpand(text)) {
      calls.push({ tool: 'expand_canvas', requires_confirmation: false, reason: '你明确要求展开到画布' });
    }

    return calls;
  }, []);

  const executeToolCall = useCallback(async (tool: AgentToolName, taskSnapshot: AgentTask[]) => {
    if (tool === 'expand_canvas') {
      await expandToCanvas(taskSnapshot);
      return;
    }
    if (tool === 'run_batch') {
      await runCreatedWorkflow(taskSnapshot);
      return;
    }
    if (tool === 'retry_failed') {
      const failedTasks = taskSnapshot.filter((task) => task.status === 'failed');
      if (failedTasks.length === 0) {
        appendMessage({ role: 'assistant', content: '当前批次没有记录到失败项，不需要重试。' });
        return;
      }
      await runCreatedWorkflow(failedTasks, { forceExpand: true });
    }
  }, [appendMessage, expandToCanvas, runCreatedWorkflow]);

  const handleToolCalls = useCallback(async (calls: AgentToolCall[], taskSnapshot: AgentTask[], userText: string) => {
    const actionable = calls.filter((call) => call.tool !== 'update_tasks');
    if (actionable.length === 0) return;

    const call = actionable[actionable.length - 1];
    const explicit = (
      (call.tool === 'run_batch' && wantsRun(userText))
      || (call.tool === 'expand_canvas' && wantsExpand(userText))
      || call.requires_confirmation === false
    );

    const validation = validateAgentTasks(taskSnapshot, referenceImages.length);
    setLastValidation(validation);
    if (!validation.passed) {
      appendMessage({ role: 'assistant', content: formatValidationMessage(validation) });
      return;
    }

    if (explicit) {
      await executeToolCall(call.tool, taskSnapshot);
      return;
    }

    const label = call.tool === 'run_batch'
      ? `批量运行 ${taskSnapshot.length} 个出图任务`
      : call.tool === 'expand_canvas'
        ? `展开 ${taskSnapshot.length} 个任务到画布`
        : call.tool === 'retry_failed'
          ? `重试失败任务`
          : '执行工具动作';
    setPendingAction({
      tool: call.tool,
      label,
      reason: call.reason || '模型建议执行该动作，等待你确认。',
      tasksSnapshot: taskSnapshot
    });
    appendMessage({ role: 'assistant', content: `我准备执行：${label}。请确认后我再动手。` });
  }, [appendMessage, executeToolCall, referenceImages.length]);

  const sendAgentMessage = useCallback(async (rawMessage?: string) => {
    const text = (rawMessage ?? chatInput).trim();
    if (!text) return;

    setChatInput('');
    appendMessage({ role: 'user', content: text });
    setIsThinking(true);

    try {
      if (!activeProvider?.apiKey || !activeProvider?.baseUrl || !chatModelId) {
        const fallback = buildFallbackTasks(`${requirementText}\n${text}`.trim());
        if (fallback.length > 0) {
          setTasks(fallback);
          setSummary('没有可用对话模型，已按文本拆成基础任务草案。');
          setPendingAction(null);
          setLastValidation(validateAgentTasks(fallback, referenceImages.length));
        }
        appendMessage({
          role: 'assistant',
          content: '我现在没有可用的对话模型。先按文本行给你拆了一个基础草案；如果要真正沟通和推理，需要先在模型枢纽选中可用的对话模型。'
        });
        return;
      }

      const service = new AIService();
      const response = await service.executeNode(
        `canvas-agent-chat-${Date.now()}`,
        NodeType.AI_CHAT,
        {
          modelId: chatModelId,
          systemInstruction: buildAgentSystemPrompt()
        },
        {
          prompt: buildAgentUserPayload({
            userMessage: text,
            requirementText,
            referenceImageCount: referenceImages.length,
            documentAssets,
            tasks,
            messages,
            canvasSummary
          }),
          ...(referenceImages.length > 0 ? { image: referenceImages.slice(0, 12) } : {})
        },
        {
          providerName: activeProvider.name,
          apiKey: activeProvider.apiKey,
          baseUrl: activeProvider.baseUrl,
          chatProtocol: activeProvider.chatProtocol,
          reasoningProtocol: activeProvider.reasoningProtocol,
          imageProtocol: activeProvider.imageProtocol
        }
      );

      const raw = String(response.output || '').trim();
      let parsed: any = null;
      try {
        parsed = extractJsonObject(raw);
      } catch {
        appendMessage({ role: 'assistant', content: raw || '我没有拿到有效回复。' });
        return;
      }

      const normalized = updateTasksFromParsed(parsed);
      const reply = String(parsed?.reply || (normalized.length > 0 ? `我已经更新了 ${normalized.length} 个任务草案。` : '我看完了，需要你再补充一点信息。'));
      appendMessage({ role: 'assistant', content: reply });

      const nextTasks = normalized.length > 0 ? normalized : tasks;
      const modelValidation = parsed?.validation && typeof parsed.validation === 'object'
        ? {
          passed: parsed.validation.passed !== false,
          errors: Array.isArray(parsed.validation.errors) ? parsed.validation.errors.map(String) : [],
          warnings: Array.isArray(parsed.validation.warnings) ? parsed.validation.warnings.map(String) : []
        } satisfies AgentValidation
        : validateAgentTasks(nextTasks, referenceImages.length);
      const localValidation = validateAgentTasks(nextTasks, referenceImages.length);
      const mergedValidation: AgentValidation = {
        passed: modelValidation.passed && localValidation.passed,
        errors: [...modelValidation.errors, ...localValidation.errors],
        warnings: [...modelValidation.warnings, ...localValidation.warnings]
      };
      setLastValidation(mergedValidation);
      if (mergedValidation.warnings.length > 0) {
        appendMessage({ role: 'assistant', content: `自检提醒：${mergedValidation.warnings.join('；')}` });
      }

      const toolCalls = normalizeToolCalls(parsed, text);
      await handleToolCalls(toolCalls, nextTasks, text);
    } catch (error: any) {
      appendMessage({ role: 'assistant', content: `这次调用模型失败：${error?.message || error}` });
      pushNotice('error', '画布智能体调用失败');
    } finally {
      setIsThinking(false);
    }
  }, [
    activeProvider,
    appendMessage,
    canvasSummary,
    chatInput,
    chatModelId,
    documentAssets,
    handleToolCalls,
    messages,
    normalizeToolCalls,
    pushNotice,
    referenceImages,
    requirementText,
    tasks,
    updateTasksFromParsed
  ]);

  const updateTask = useCallback((index: number, patch: Partial<AgentTask>) => {
    setTasks((prev) => prev.map((task, taskIndex) => taskIndex === index ? { ...task, ...patch } : task));
    setBatchStatus('draft');
    setCreatedWorkflow(null);
    setPendingAction(null);
  }, []);

  const addManualTask = useCallback(() => {
    setTasks((prev) => [
      ...prev,
      {
        id: `item-${makeId()}`,
        title: `任务 ${prev.length + 1}`,
        prompt: '',
        aspectRatio: '1:1',
        imageSize: '1K',
        imageUrls: [],
        status: 'draft'
      }
    ]);
    setBatchStatus('draft');
    setActivePanel('tasks');
    setCreatedWorkflow(null);
    setPendingAction(null);
  }, []);

  const removeTask = useCallback((index: number) => {
    const target = tasks[index];
    const targetId = target?.id || `item-${index + 1}`;
    setTasks((prev) => prev.filter((_, taskIndex) => taskIndex !== index));
    setDocumentAssets((prev) => prev.map((asset) => ({
      ...asset,
      images: asset.images.map((image) => ({
        ...image,
        assignedTaskIds: image.assignedTaskIds.filter((itemId) => itemId !== targetId)
      }))
    })));
    setBatchStatus('draft');
    setCreatedWorkflow(null);
    setPendingAction(null);
  }, [tasks]);

  const assignDocumentImageToTask = useCallback((assetId: string, imageId: string, taskIndex: number) => {
    const asset = documentAssets.find((item) => item.id === assetId);
    const image = asset?.images.find((item) => item.id === imageId);
    const targetTask = tasks[taskIndex];
    if (!asset || !image || !targetTask) return;

    const targetTaskId = targetTask.id || `item-${taskIndex + 1}`;
    setTasks((prev) => prev.map((task, index) => (
      index === taskIndex
        ? { ...task, id: targetTaskId, imageUrls: mergeUniqueImages(task.imageUrls, [image.src]) }
        : task
    )));
    setDocumentAssets((prev) => prev.map((item) => (
      item.id !== assetId
        ? item
        : {
          ...item,
          images: item.images.map((docImage) => (
            docImage.id === imageId
              ? { ...docImage, assignedTaskIds: Array.from(new Set([...docImage.assignedTaskIds, targetTaskId])) }
              : docImage
          ))
        }
    )));
    setBatchStatus('draft');
    setCreatedWorkflow(null);
    setPendingAction(null);
    pushNotice('success', `已把文档图 ${image.index} 绑定到任务 ${taskIndex + 1}`);
  }, [documentAssets, pushNotice, tasks]);

  if (!isOpen) return null;

  const tabButtonClass = (tab: AgentPanelTab) => (
    `flex-1 rounded-2xl px-3 py-2 text-[11px] font-black transition ${
      activePanel === tab
        ? 'bg-cyan-400 text-black shadow-[0_0_24px_rgba(34,211,238,0.22)]'
        : 'border border-white/10 bg-white/[0.04] text-gray-400 hover:border-cyan-400/30 hover:text-cyan-100'
    }`
  );

  return (
    <aside className="absolute right-4 top-20 bottom-20 z-30 flex w-[540px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[28px] border border-cyan-500/20 bg-[#071018]/95 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-cyan-500/10 via-blue-500/5 to-transparent px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-cyan-500/15 p-2.5 text-cyan-300">
            <Bot size={20} />
          </div>
          <div>
            <h2 className="text-sm font-black tracking-widest text-white">画布智能体</h2>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300/70">
              对话模型：{chatModelId || '未选择'}
            </p>
            <p className="mt-1 text-[9px] font-bold text-gray-500">
              {batchId ? `批次：${batchId}` : '批次：尚未保存'}
              {isBatchSaving ? ' · 保存中' : (lastSavedAt ? ` · 已保存 ${new Date(lastSavedAt).toLocaleTimeString()}` : '')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleHistory}
            className={`rounded-xl p-2 transition ${activePanel === 'history' ? 'bg-cyan-400/15 text-cyan-200' : 'text-gray-500 hover:bg-white/10 hover:text-white'}`}
            title="批次历史"
          >
            <History size={18} />
          </button>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-500 transition hover:bg-white/10 hover:text-white">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="border-b border-white/10 bg-black/20 px-5 py-4">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <button type="button" onClick={() => setActivePanel('chat')} className={tabButtonClass('chat')}>
            沟通需求
          </button>
          <button type="button" onClick={() => setActivePanel('tasks')} className={tabButtonClass('tasks')}>
            任务草稿 {readyTaskCount > 0 ? readyTaskCount : ''}
          </button>
          <button
            type="button"
            onClick={() => {
              setActivePanel('history');
              setIsHistoryOpen(true);
              void loadBatchHistory();
            }}
            className={tabButtonClass('history')}
          >
            批次历史
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">任务</p>
            <p className="mt-1 text-sm font-black text-white">{readyTaskCount}</p>
          </div>
          <div className="rounded-2xl border border-orange-400/15 bg-orange-400/[0.045] px-3 py-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-orange-200/60">产品图绑定</p>
            <p className="mt-1 text-sm font-black text-orange-100">{imageBoundTaskCount}/{readyTaskCount || 0}</p>
          </div>
          <div className={`rounded-2xl border px-3 py-2 ${lastValidation.errors.length > 0 ? 'border-rose-400/20 bg-rose-400/[0.06]' : 'border-emerald-400/15 bg-emerald-400/[0.04]'}`}>
            <p className={`text-[9px] font-black uppercase tracking-widest ${lastValidation.errors.length > 0 ? 'text-rose-200/70' : 'text-emerald-200/60'}`}>自检</p>
            <p className={`mt-1 text-sm font-black ${lastValidation.errors.length > 0 ? 'text-rose-100' : 'text-emerald-100'}`}>
              {lastValidation.errors.length > 0 ? `${lastValidation.errors.length} 错误` : '可执行'}
            </p>
          </div>
        </div>
      </div>

      <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
        {activePanel === 'history' && (
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-cyan-100">批次历史</p>
                <p className="mt-1 text-[10px] text-cyan-200/60">恢复之前的任务草稿、状态和结果记录</p>
              </div>
              <button
                onClick={() => void loadBatchHistory()}
                disabled={isHistoryLoading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-300/20 bg-black/20 px-2.5 py-2 text-[10px] font-black text-cyan-100 transition hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={12} className={isHistoryLoading ? 'animate-spin' : ''} />
                刷新
              </button>
            </div>
            {historyError && (
              <p className="mb-3 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-[11px] text-rose-100">
                {historyError}
              </p>
            )}
            {isHistoryLoading && batchHistory.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-[11px] text-gray-400">
                <Loader2 size={13} className="animate-spin text-cyan-200" />
                正在读取历史批次...
              </div>
            ) : batchHistory.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-[11px] text-gray-400">
                暂时还没有保存过的智能体批次。
              </p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {batchHistory.map((item) => {
                  const counts = formatStatusCounts(item.statusCounts);
                  const isCurrent = item.id === batchId;
                  const isLoadingThis = loadingBatchId === item.id;
                  const isDeletingThis = deletingBatchId === item.id;
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!loadingBatchId && !deletingBatchId) void loadHistoryBatch(item.id);
                      }}
                      onKeyDown={(event) => {
                        if ((event.key === 'Enter' || event.key === ' ') && !loadingBatchId && !deletingBatchId) {
                          event.preventDefault();
                          void loadHistoryBatch(item.id);
                        }
                      }}
                      aria-disabled={!!loadingBatchId || !!deletingBatchId}
                      className={`w-full cursor-pointer rounded-2xl border p-3 text-left transition hover:border-cyan-300/40 hover:bg-cyan-300/[0.06] ${
                        (loadingBatchId || deletingBatchId) ? 'pointer-events-none opacity-60' : ''
                      } ${
                        isCurrent ? 'border-cyan-300/40 bg-cyan-300/[0.08]' : 'border-white/10 bg-black/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-black text-white">
                            {item.name || item.summary || item.id}
                          </p>
                          <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-gray-400">
                            {item.summary || '没有摘要'}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className={`rounded-full border px-2 py-1 text-[9px] font-black ${getBatchStatusClass(item.status)}`}>
                            {isLoadingThis ? '加载中' : isDeletingThis ? '删除中' : getBatchStatusLabel(item.status)}
                          </span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void deleteHistoryBatch(item.id);
                            }}
                            disabled={!!loadingBatchId || !!deletingBatchId}
                            className="pointer-events-auto rounded-lg p-1.5 text-gray-500 transition hover:bg-rose-400/10 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
                            title="删除历史批次"
                          >
                            {isDeletingThis ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px] font-bold text-gray-500">
                        <span>{item.itemCount || 0} 个任务</span>
                        {counts && <span>{counts}</span>}
                        {item.imageModelId && <span>图像模型 {item.imageModelId}</span>}
                        {item.referenceImageCount ? <span>参考图 {item.referenceImageCount}</span> : null}
                      </div>
                      <p className="mt-2 text-[9px] text-gray-600">
                        更新于 {formatBatchTime(item.updatedAt)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activePanel === 'chat' && (
          <>
        <div className="space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-2xl border px-4 py-3 text-xs leading-relaxed ${
                message.role === 'user'
                  ? 'ml-8 border-cyan-400/20 bg-cyan-400/10 text-cyan-50'
                  : 'mr-8 border-white/10 bg-white/[0.04] text-gray-200'
              }`}
            >
              {message.content}
            </div>
          ))}
          {isThinking && (
            <div className="mr-8 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs text-gray-400">
              <Loader2 size={14} className="animate-spin text-cyan-300" />
              正在调用当前对话模型思考...
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <label className="mb-2 block text-xs font-bold text-gray-300">需求材料</label>
          <textarea
            value={requirementText}
            onChange={(event) => setRequirementText(event.target.value)}
            placeholder="粘贴客户需求、表格字段、产品信息、批量规则；也可以上传 docx/xlsx/csv/txt。"
            className="h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/30 p-3 text-xs leading-relaxed text-gray-200 outline-none transition focus:border-cyan-400/60"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              ref={requirementFileRef}
              type="file"
              accept=".txt,.md,.csv,.xlsx,.xls,.docx,.doc,.pdf"
              className="hidden"
              onChange={(event) => {
                void handleRequirementFile(event.target.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
            <input
              ref={imageFileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleImageFiles(event.target.files);
                event.currentTarget.value = '';
              }}
            />
            <button
              onClick={() => requirementFileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-bold text-gray-300 transition hover:border-cyan-400/40 hover:text-cyan-200"
            >
              <FilePlus2 size={14} />
              上传需求文件
            </button>
            <button
              onClick={() => imageFileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-bold text-gray-300 transition hover:border-orange-400/40 hover:text-orange-200"
            >
              <ImagePlus size={14} />
              参考图 {referenceImages.length > 0 ? referenceImages.length : ''}
            </button>
            <button
              onClick={() => void sendAgentMessage('请分析当前需求材料，和我沟通缺失信息；如果信息足够，就生成批量出图任务计划。')}
              disabled={isThinking}
              className="ml-auto inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 text-[11px] font-black text-black transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles size={14} />
              分析需求
            </button>
          </div>
          {documentAssets.length > 0 && (
            <div className="mt-3 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-black text-cyan-100">文档图片素材</p>
                  <p className="mt-1 text-[9px] text-cyan-200/60">
                    共 {documentAssets.length} 份文档，{documentImageCount} 张图片，可点击查看或绑定到任务
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActivePanel('tasks')}
                  className="rounded-xl border border-cyan-300/20 bg-black/20 px-2.5 py-2 text-[10px] font-black text-cyan-100 transition hover:bg-cyan-300/10"
                >
                  去任务区
                </button>
              </div>
              <div className="space-y-3">
                {documentAssets.map((asset) => (
                  <div key={asset.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-black text-white">{asset.fileName}</p>
                        {asset.textPreview && (
                          <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-gray-500">
                            {asset.textPreview}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 rounded-full bg-cyan-400/10 px-2 py-1 text-[9px] font-black text-cyan-100">
                        {asset.images.length} 图
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {asset.images.slice(0, 16).map((image) => (
                        <div key={image.id} className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/40">
                          <button
                            type="button"
                            onClick={() => {
                              if ((window as any).openLightbox) {
                                (window as any).openLightbox(image.src);
                              }
                            }}
                            className="block aspect-square w-full overflow-hidden"
                            title={`${asset.fileName} - 图片 ${image.index}`}
                          >
                            <img src={image.src} alt={`${asset.fileName} 图片 ${image.index}`} className="h-full w-full object-cover transition group-hover:scale-110" />
                          </button>
                          <div className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[8px] font-black text-white/80">
                            #{image.index}
                          </div>
                          {image.assignedTaskIds.length > 0 && (
                            <div className="absolute right-1 top-1 rounded bg-emerald-400/90 px-1.5 py-0.5 text-[8px] font-black text-black">
                              已绑定
                            </div>
                          )}
                          {tasks.length > 0 && (
                            <div className="absolute inset-x-1 bottom-1 opacity-0 transition group-hover:opacity-100">
                              <select
                                value=""
                                onChange={(event) => {
                                  const nextIndex = Number(event.target.value);
                                  if (Number.isFinite(nextIndex)) {
                                    assignDocumentImageToTask(asset.id, image.id, nextIndex);
                                  }
                                  event.currentTarget.value = '';
                                }}
                                className="w-full rounded-lg border border-cyan-300/20 bg-black/85 px-1.5 py-1 text-[9px] font-bold text-cyan-50 outline-none"
                              >
                                <option value="" disabled>绑定到任务</option>
                                {tasks.map((task, taskIndex) => (
                                  <option key={`${task.id || taskIndex}-${taskIndex}`} value={taskIndex}>
                                    {taskIndex + 1}. {task.title || `任务 ${taskIndex + 1}`}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {referenceImages.length > 0 && (
            <div className="mt-3 rounded-2xl border border-orange-400/15 bg-orange-400/[0.04] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-black text-orange-200">会发送给对话模型的参考图</span>
                <span className="text-[10px] text-orange-200/70">
                  {referenceImages.length} 张，单次最多传前 12 张
                </span>
              </div>
              <div className="grid grid-cols-6 gap-2">
                {referenceImages.slice(0, 12).map((src, index) => (
                  <button
                    key={`${src.slice(0, 32)}-${index}`}
                    type="button"
                    onClick={() => {
                      if ((window as any).openLightbox) {
                        (window as any).openLightbox(src);
                      }
                    }}
                    className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/40"
                    title={`参考图 ${index + 1}`}
                  >
                    <img src={src} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover transition group-hover:scale-110" />
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[8px] font-bold text-white/80">
                      {index + 1}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

          </>
        )}

        {activePanel === 'tasks' && (
          <>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black text-white">任务草稿</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                手动补任务时先创建空白任务，提示词为空会阻止出图，不会继承上一条。
              </p>
            </div>
            <button
              type="button"
              onClick={addManualTask}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-cyan-400 px-3 py-2 text-[11px] font-black text-black transition hover:bg-cyan-300"
            >
              <PlusCircle size={14} />
              新建任务
            </button>
          </div>
        </div>
        {(summary || tasks.length > 0) && (
          <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-cyan-200">任务计划</p>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{summary || `已准备 ${readyTaskCount} 个任务`}</p>
              </div>
              <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-black text-cyan-200">
                {readyTaskCount} 张
              </span>
            </div>
          </div>
        )}

        {(lastValidation.errors.length > 0 || lastValidation.warnings.length > 0) && (
          <div className={`rounded-2xl border p-4 ${lastValidation.errors.length > 0 ? 'border-rose-500/25 bg-rose-500/[0.05]' : 'border-amber-500/20 bg-amber-500/[0.05]'}`}>
            <p className={`text-xs font-black ${lastValidation.errors.length > 0 ? 'text-rose-200' : 'text-amber-200'}`}>
              任务自检
            </p>
            {lastValidation.errors.length > 0 && (
              <div className="mt-2 space-y-1">
                {lastValidation.errors.map((item, index) => (
                  <p key={`error-${index}`} className="text-[11px] leading-relaxed text-rose-100/90">
                    {index + 1}. {item}
                  </p>
                ))}
              </div>
            )}
            {lastValidation.warnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {lastValidation.warnings.map((item, index) => (
                  <p key={`warning-${index}`} className="text-[11px] leading-relaxed text-amber-100/90">
                    {index + 1}. {item}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {pendingAction && (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
            <p className="text-xs font-black text-emerald-200">等待你确认</p>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-300">{pendingAction.label}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{pendingAction.reason}</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void executeToolCall(pendingAction.tool, pendingAction.tasksSnapshot)}
                className="rounded-xl bg-emerald-400 px-3 py-2 text-[11px] font-black text-black transition hover:bg-emerald-300"
              >
                确认执行
              </button>
              <button
                onClick={() => setPendingAction(null)}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-bold text-gray-300 transition hover:bg-white/10"
              >
                先不执行
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {tasks.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-6 text-center">
              <p className="text-xs font-black text-gray-300">还没有任务草稿</p>
              <p className="mt-1 text-[10px] text-gray-500">可以让智能体分析需求生成，也可以手动新建一个干净的空白任务。</p>
              <button
                type="button"
                onClick={addManualTask}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-cyan-400 px-3 py-2 text-[11px] font-black text-black transition hover:bg-cyan-300"
              >
                <PlusCircle size={14} />
                新建任务
              </button>
            </div>
          )}
          {tasks.map((task, index) => (
            <div key={`${task.title}-${index}`} className="rounded-2xl border border-white/10 bg-[#111827]/80 p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-cyan-500/15 text-[10px] font-black text-cyan-200">{index + 1}</span>
                <input
                  value={task.title}
                  onChange={(event) => updateTask(index, { title: event.target.value })}
                  className="min-w-0 flex-1 bg-transparent text-xs font-black text-white outline-none"
                />
                <span className={`rounded-full px-2 py-1 text-[9px] font-black ${
                  task.status === 'success'
                    ? 'bg-emerald-400/10 text-emerald-200'
                    : task.status === 'failed'
                      ? 'bg-rose-400/10 text-rose-200'
                      : task.status === 'running'
                        ? 'bg-cyan-400/10 text-cyan-200'
                        : 'bg-white/5 text-gray-400'
                }`}>
                  {task.status || 'draft'}
                </span>
                <button
                  type="button"
                  onClick={() => removeTask(index)}
                  className="rounded-lg p-1.5 text-gray-500 transition hover:bg-rose-400/10 hover:text-rose-200"
                  title="删除任务"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <textarea
                value={task.prompt}
                onChange={(event) => updateTask(index, { prompt: event.target.value })}
                className="h-24 w-full resize-none rounded-xl border border-white/10 bg-black/25 p-3 text-[11px] leading-relaxed text-gray-200 outline-none focus:border-cyan-400/60"
              />
              <div className="mt-3 rounded-xl border border-orange-400/15 bg-orange-400/[0.04] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[9px] font-black text-orange-200 uppercase tracking-widest">产品图 / 参考图链接</span>
                  {(task.imageUrls || []).length > 0 && (
                    <span className="rounded-full bg-orange-400/10 px-2 py-0.5 text-[8px] font-black text-orange-100">
                      已绑定 {(task.imageUrls || []).length} 张
                    </span>
                  )}
                </div>
                <textarea
                  value={(task.imageUrls || []).filter(isRemoteUrl).join('\n')}
                  onChange={(event) => {
                    const localImages = (task.imageUrls || []).filter((url) => !isRemoteUrl(url) || isInlineImageData(url));
                    updateTask(index, { imageUrls: mergeUniqueImages(localImages, extractImageUrlsFromText(event.target.value)) });
                  }}
                  placeholder="每行一个产品图 URL。上传到智能体的本地参考图会自动绑定，不需要粘贴在这里。"
                  className="h-16 w-full resize-none rounded-xl border border-white/10 bg-black/25 p-2.5 text-[10px] leading-relaxed text-orange-50/90 outline-none focus:border-orange-300/60"
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input
                  value={task.aspectRatio || ''}
                  onChange={(event) => updateTask(index, { aspectRatio: event.target.value })}
                  placeholder="比例，如 1:1"
                  className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-gray-300 outline-none focus:border-cyan-400/60"
                />
                <input
                  value={task.imageSize || ''}
                  onChange={(event) => updateTask(index, { imageSize: event.target.value })}
                  placeholder="清晰度，如 1K/2K"
                  className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-gray-300 outline-none focus:border-cyan-400/60"
                />
              </div>
              {task.error && (
                <p className="mt-2 rounded-xl border border-rose-400/15 bg-rose-400/[0.05] px-3 py-2 text-[10px] leading-relaxed text-rose-100">
                  {task.error}
                </p>
              )}
            </div>
          ))}
        </div>
          </>
        )}
      </div>

      <div className="border-t border-white/10 bg-black/25 p-4">
        {activePanel === 'chat' && (
        <div className="mb-3 flex gap-2">
          <input
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendAgentMessage();
              }
            }}
            placeholder="和它沟通：比如“按亚马逊A+拆成5张，先别跑”"
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-xs text-gray-200 outline-none transition focus:border-cyan-400/60"
          />
          <button
            onClick={() => void sendAgentMessage()}
            disabled={isThinking || !chatInput.trim()}
            className="rounded-2xl bg-cyan-500 px-4 text-black transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
        )}
        {activePanel !== 'history' && (
        <div className={`grid gap-3 ${failedTaskCount > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <button
            onClick={() => void expandToCanvas()}
            disabled={isExpanding || readyTaskCount === 0}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-xs font-black text-cyan-200 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExpanding ? <Loader2 size={15} className="animate-spin" /> : <PlusCircle size={15} />}
            展开到画布
          </button>
          <button
            onClick={() => void runCreatedWorkflow()}
            disabled={isRunning || readyTaskCount === 0}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-xs font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} fill="currentColor" />}
            批量跑图
          </button>
          {failedTaskCount > 0 && (
            <button
              onClick={() => void executeToolCall('retry_failed', tasks)}
              disabled={isRunning}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-xs font-black text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              重试失败 {failedTaskCount}
            </button>
          )}
        </div>
        )}
        {activePanel === 'history' && (
          <button
            onClick={() => void loadBatchHistory()}
            disabled={isHistoryLoading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-xs font-black text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={15} className={isHistoryLoading ? 'animate-spin' : ''} />
            刷新批次历史
          </button>
        )}
      </div>
    </aside>
  );
};
