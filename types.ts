
import { Node, Edge } from 'reactflow';

export enum NodeType {
  INPUT = 'INPUT',
  IMAGE_UPLOAD = 'IMAGE_UPLOAD',
  MULTI_IMAGE_UPLOAD = 'MULTI_IMAGE_UPLOAD',
  FILE_UPLOAD = 'FILE_UPLOAD',
  TABLE_PARSE = 'TABLE_PARSE',
  TASK_SELECT = 'TASK_SELECT',
  BATCH_EXECUTE = 'BATCH_EXECUTE',
  STYLE_GUIDE = 'STYLE_GUIDE',
  PRODUCT_IMAGE_MATCH = 'PRODUCT_IMAGE_MATCH',
  TEXT_RECOGNITION = 'TEXT_RECOGNITION',
  AI_CHAT = 'AI_CHAT',
  AI_IMAGE = 'AI_IMAGE',
  AI_AUDIO = 'AI_AUDIO',
  AI_VIDEO = 'AI_VIDEO',
  DESIGN_BOARD = 'DESIGN_BOARD',
  OUTPUT = 'OUTPUT',
  GROUP = 'GROUP'
}

export type ModelModality = 'chat' | 'image' | 'audio' | 'video';
export type ModelApplyScope = 'selected' | 'modality' | 'allCompatible';

export type NodeModality = 'ai' | 'utility';

export enum NodeCapability {
  TEXT_REASONING = 'TEXT_REASONING',
  IMAGE_GENERATION = 'IMAGE_GENERATION',
  AUDIO_SYNTHESIS = 'AUDIO_SYNTHESIS',
  VIDEO_MOTION = 'VIDEO_MOTION',
  UTILITY = 'UTILITY',
  GROUPING = 'GROUPING'
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'api';

export type NoticeLevel = 'info' | 'success' | 'warn' | 'error';

export interface Notice {
  id: string;
  level: NoticeLevel;
  message: string;
  actionLabel?: string;
  action?: () => void;
}

export interface StandardFilePayload {
  id: string;
  createdAt: number;
  source: 'local' | 'remote';
  type: 'image' | 'video' | 'xlsx' | 'generic';
  name: string;
  size: number;
  mime: string;
  url?: string;
  data?: any;
  previewData?: any;
  meta?: {
    columns?: number;
    rowCount?: number;
    sheetName?: string;
    [key: string]: any;
  };
}

export interface SpreadsheetParseTask {
  taskId: string;
  rowNumber: number;
  serialNo: string;
  sheetTaskIndex?: number;
  size: string;
  requirementZh: string;
  referenceText?: string;
  textLayers: string[];
  referenceImages: StandardFilePayload[];
  embeddedImages: StandardFilePayload[];
  parseMode?: 'standard' | 'smart' | 'auto';
  confidence?: number;
  sourceRange?: string;
  sourceRows?: number[];
  source: {
    sheetName: string;
    rowNumber: number;
  };
  rawRow: Record<string, string>;
  visualSpec?: TaskVisualSpec;
}

export interface SpreadsheetParseOutput {
  runId: string;
  fileName: string;
  sheetName: string;
  sheetNames?: string[];
  sheetCount?: number;
  taskCount: number;
  totalRows: number;
  skippedRows: number;
  warnings: string[];
  parseMode?: 'standard' | 'smart' | 'auto';
  parseModelId?: string;
  tasks: SpreadsheetParseTask[];
}

export interface TaskVisualSpec {
  platform?: 'amazon' | 'taobao' | 'generic';
  taskType?: string;
  layoutMode?: 'fixed' | 'adaptive';
  layoutVariant?: 'short' | 'medium' | 'long' | 'fixed';
  targetAspectRatio?: string;
  targetImageSize?: string;
  matchedRule?: string;
}

export interface TaskSelectionTask {
  taskId: string;
  rowNumber: number;
  serialNo: string;
  sheetTaskIndex?: number;
  size: string;
  requirementZh: string;
  referenceText?: string;
  textLayers: string[];
  referenceImageCount: number;
  embeddedImageCount: number;
  source: {
    sheetName: string;
    rowNumber: number;
  };
  rawRow: Record<string, string>;
  visualSpec?: TaskVisualSpec;
}

export interface TaskSelectionOutput {
  prompt: string;
  selectedIndex: number;
  totalTasks: number;
  task: TaskSelectionTask;
}

export interface BatchExecutionItem {
  batchId: string;
  selectedIndex: number;
  prompt: string;
  images: StandardFilePayload[];
  task: TaskSelectionTask;
  visualSpec?: TaskVisualSpec;
  variantKey?: string;
  variantLabel?: string;
}

export interface BatchExecutionOutput {
  runId: string;
  totalTasks: number;
  selectedCount: number;
  skippedCount: number;
  startIndex: number;
  endIndex: number;
  intervalMs: number;
  items: BatchExecutionItem[];
}

export interface ProductImageCandidateAnalysis {
  index: number;
  summaryZh: string;
  primaryCategory: string;
  subject: string;
  scene: string;
  background: string;
  angle: string;
  composition: string;
  visibleParts: string[];
  suitableTaskKinds: string[];
  tags: string[];
  textVisible: string[];
  qualityNotes?: string;
  confidence?: number;
}

export interface ProductImageMatchOutput {
  image: Array<string | StandardFilePayload>;
  selectedImages: Array<string | StandardFilePayload>;
  selectedIndexes: number[];
  selectedCount: number;
  totalImages: number;
  reason: string;
  confidence?: number;
  taskSummary?: string;
  candidateAnalyses?: ProductImageCandidateAnalysis[];
  selectedAnalyses?: ProductImageCandidateAnalysis[];
}

export interface StyleGuideSpec {
  tone: string;
  palette: string[];
  lighting: string;
  background: string;
  composition: string;
  camera: string;
  material: string;
  qualityKeywords: string[];
  consistencyRules: string[];
  negativeRules: string[];
}

export interface StyleGuideOutput {
  prompt: string;
  stylePrompt: string;
  negativePrompt: string;
  summary: string;
  styleName: string;
  taskSummary?: string;
  referenceImageCount: number;
  styleSpec: StyleGuideSpec;
}

export interface BatchImageResult {
  batchId: string;
  selectedIndex: number;
  prompt: string;
  task: TaskSelectionTask;
  output?: string | CanonicalImageResult;
  error?: string;
}

export interface CanonicalImageResult {
  primaryUrl: string;
  urls: string[];
  selectedIndex: number;
  sourceKind: 'remote-url' | 'data-url' | 'local-cache-url';
  localCacheUrl?: string | null;
}

export interface DesignBoardTextLayer {
  id: string;
  type: 'text';
  name: string;
  text: string;
  x: number;
  y: number;
  width: number;
  rotation: number;
  fontId: string;
  fontSize: number;
  color: string;
  opacity: number;
  align: 'left' | 'center' | 'right';
  letterSpacing: number;
  lineHeight: number;
  role?: 'headline' | 'subtitle' | 'selling-point' | 'price' | 'badge' | 'footer' | 'icon-label' | 'other';
  readingOrder?: number;
  zIndex?: number;
  stroke?: {
    enabled: boolean;
    color: string;
    width: number;
  };
  shadow?: {
    enabled: boolean;
    color: string;
    x: number;
    y: number;
    blur: number;
  };
}

export interface DesignBoardConfig {
  boardWidth: number;
  boardHeight: number;
  backgroundColor: string;
  backgroundImage?: string;
  selectedLayerId?: string;
  layers: DesignBoardTextLayer[];
}

export interface DesignBoardOutput {
  kind: 'design-board';
  version: 1;
  boardWidth: number;
  boardHeight: number;
  backgroundColor: string;
  backgroundImage?: string;
  image?: string;
  primaryUrl?: string;
  url?: string;
  urls?: string[];
  previewDataUrl?: string;
  renderError?: string;
  layers: DesignBoardTextLayer[];
  updatedAt: number;
}

export interface TextRecognitionOutput {
  kind: 'text-recognition';
  version: 1;
  boardWidth: number;
  boardHeight: number;
  image?: string;
  text: string;
  layers: DesignBoardTextLayer[];
  rawRecognition?: string;
  structuredRecognition?: any;
  promptReference?: string;
  updatedAt: number;
}

export interface ModelCapabilities {
  allowedAspectRatios?: string[];
  allowedImageSizes?: string[];
  allowedDurations?: string[];
  supportsImageRefs?: boolean;
  supportsImageSize?: boolean;
  imageSizeMeaning?: 'resolution' | 'resolution-and-clarity';
}

export interface ImageHistoryItem {
  id: string;
  createdAt: number;
  nodeId: string;
  providerName: string;
  providerBaseUrl: string;
  modelId: string;
  rawPrompt: string;
  optimizedPrompt: string;
  sourceImageDataUrl?: string;
  resultImageUrl: string;
  resultImageDataUrl?: string;
  typographyFontId?: string;
  typographyFontLabel?: string;
  typographyText?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  nodeId?: string;
  nodeLabel?: string;
}

export const NODE_CAPABILITIES: Record<NodeType, NodeCapability> = {
  [NodeType.AI_CHAT]: NodeCapability.TEXT_REASONING,
  [NodeType.AI_IMAGE]: NodeCapability.IMAGE_GENERATION,
  [NodeType.AI_AUDIO]: NodeCapability.AUDIO_SYNTHESIS,
  [NodeType.AI_VIDEO]: NodeCapability.VIDEO_MOTION,
  [NodeType.DESIGN_BOARD]: NodeCapability.UTILITY,
  [NodeType.INPUT]: NodeCapability.UTILITY,
  [NodeType.IMAGE_UPLOAD]: NodeCapability.UTILITY,
  [NodeType.MULTI_IMAGE_UPLOAD]: NodeCapability.UTILITY,
  [NodeType.FILE_UPLOAD]: NodeCapability.UTILITY,
  [NodeType.TABLE_PARSE]: NodeCapability.UTILITY,
  [NodeType.TASK_SELECT]: NodeCapability.UTILITY,
  [NodeType.BATCH_EXECUTE]: NodeCapability.UTILITY,
  [NodeType.STYLE_GUIDE]: NodeCapability.UTILITY,
  [NodeType.PRODUCT_IMAGE_MATCH]: NodeCapability.TEXT_REASONING,
  [NodeType.TEXT_RECOGNITION]: NodeCapability.TEXT_REASONING,
  [NodeType.OUTPUT]: NodeCapability.UTILITY,
  [NodeType.GROUP]: NodeCapability.GROUPING
};

export const NODE_MODALITIES: Record<NodeType, NodeModality> = {
  [NodeType.AI_CHAT]: 'ai',
  [NodeType.AI_IMAGE]: 'ai',
  [NodeType.AI_AUDIO]: 'ai',
  [NodeType.AI_VIDEO]: 'ai',
  [NodeType.DESIGN_BOARD]: 'utility',
  [NodeType.INPUT]: 'utility',
  [NodeType.IMAGE_UPLOAD]: 'utility',
  [NodeType.MULTI_IMAGE_UPLOAD]: 'utility',
  [NodeType.FILE_UPLOAD]: 'utility',
  [NodeType.TABLE_PARSE]: 'utility',
  [NodeType.TASK_SELECT]: 'utility',
  [NodeType.BATCH_EXECUTE]: 'utility',
  [NodeType.STYLE_GUIDE]: 'utility',
  [NodeType.PRODUCT_IMAGE_MATCH]: 'ai',
  [NodeType.TEXT_RECOGNITION]: 'ai',
  [NodeType.OUTPUT]: 'utility',
  [NodeType.GROUP]: 'utility'
};

export interface NodeSecurity {
  isLocked: boolean;
  passwordHash: string; // SHA-256 or simple match for now
  hint?: string;
}

export interface NodeData {
  label: string;
  type: NodeType;
  config: {
    prompt?: string;
    systemInstruction?: string;
    modelId?: string;
    baseUrl?: string;
    [key: string]: any;
  };
  output?: any;
  inputs?: Record<string, any>;
  status: 'idle' | 'running' | 'success' | 'error';
  error?: string;
  progress?: number;
  isSkipped?: boolean;
  security?: NodeSecurity;
  meta?: any;
}

export type ChatProtocol = 'auto' | 'openai-chat' | 'openai-responses' | 'gemini-native';
export type ReasoningProtocol = 'auto' | 'inherit-chat' | 'openai-responses' | 'gemini-native';
export type ImageProtocol = 'auto' | 'openai-images' | 'gemini-native';

export interface APIProvider {
  id: string;
  name: string;
  format: string;
  baseUrl: string;
  apiKey: string;
  chatProtocol?: ChatProtocol;
  reasoningProtocol?: ReasoningProtocol;
  imageProtocol?: ImageProtocol;
  textModels: string;
  imageModels: string;
  audioModels?: string;
  videoModels?: string;
  isDefault: boolean;
}

export interface RegisteredModel {
  id: string;
  modality: 'chat' | 'image' | 'audio' | 'video';
  addedAt: number;
}

export interface SavedWorkflow {
  id: string;
  name: string;
  timestamp: string;
  storage?: 'local' | 'idb';
  nodes?: Node<NodeData>[];
  edges?: Edge[];
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasState {
  nodes: Node<NodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  workspaceDraftHydrated: boolean;
  workspaceDraftSaving: boolean;
  workspaceDraftUpdatedAt: number | null;
  workspaceDraftViewport?: CanvasViewport | null;
  apiProviders: APIProvider[];
  activeProviderId: string | null;
  activeProviderIds: Partial<Record<ModelModality, string>>;
  onNodesChange: (changes: any) => void;
  onEdgesChange: (changes: any) => void;
  onConnect: (connection: any) => void;
  removeEdge: (edgeId: string) => void;
  onSelectionChange: (id: string | null) => void;
  addNode: (type: NodeType, position: { x: number, y: number }, connectFromId?: string) => string;
  duplicateSelectionInCanvas: (count?: number, options?: { keepUploadData?: boolean; gapX?: number; gapY?: number }) => number;
  toggleSkipForSelection: () => number;
  clearAllSkipped: () => number;
  updateNodeData: (id: string, data: Partial<NodeData>) => void;
  addProvider: (provider: APIProvider) => void;
  updateProvider: (id: string, provider: Partial<APIProvider>) => void;
  deleteProvider: (id: string) => void;
  setActiveProvider: (id: string) => void;
  setActiveProviderForModality: (modality: ModelModality, id: string) => void;
  importWorkflow: (nodes: Node<NodeData>[], edges: Edge[]) => void;

  // Registry Actions
  savedWorkflows: SavedWorkflow[];
  saveWorkflow: (name: string) => void;
  cloneWorkflow: (id: string, count?: number) => Promise<void>;
  loadWorkflow: (id: string) => void;
  deleteWorkflow: (id: string) => void;
  clearCanvas: () => void;
  hydrateWorkspaceDraft: () => Promise<void>;
  persistWorkspaceDraft: (options?: { viewport?: CanvasViewport | null }) => Promise<void>;
  clearWorkspaceDraft: () => Promise<void>;

  // Security & Dev Actions
  isDevMode: boolean;
  unlockedNodeIds: Set<string>;
  setDevMode: (active: boolean) => void;
  vaultNode: (id: string, passwordHash: string, hint?: string) => void;
  unlockNode: (id: string, password: string) => boolean;
  unvaultNode: (id: string) => void;
  applyPromptTemplateToNode: (id: string, value: string) => void;
  isPromptVaultUnlocked: boolean;
  setPromptVaultUnlocked: (active: boolean) => void;

  executeWorkflow: () => Promise<void>;
  executeSingleNode: (id: string) => Promise<void>;
  reconstructImageTextToDesignBoard: (params: {
    imageSrc: string;
    sourceNodeId?: string;
    sourceLabel?: string;
    typographyFontId?: string;
    typographyText?: string;
  }) => Promise<string | null>;
  isWorkflowRunning: boolean;
  maxWorkflowConcurrency: number;
  requestStopWorkflow: () => void;
  requestStopConcurrent: () => void;
  resetNodeStates: () => void;
  clearExecutionResults: () => void;
  getModelsForNode: (type: NodeType) => string[];
  draggedModel: { id: string; capability: NodeCapability } | null;
  setDraggedModel: (model: { id: string; capability: NodeCapability } | null) => void;
  globalActiveModels: Partial<Record<ModelModality, string>>;
  setGlobalActiveModel: (modality: ModelModality, modelId: string) => void;
  applyModelToNodesByModality: (modality: ModelModality, modelId: string, scope?: ModelApplyScope) => number;
  registeredModels: RegisteredModel[];
  registerModel: (modality: ModelModality, modelId: string) => void;
  unregisterModel: (modelId: string) => void;
  resizeNode: (id: string, width: number, height: number) => void;
  tidyUp: () => void;
  logs: LogEntry[];
  addLog: (level: LogLevel, message: string, meta?: { nodeId?: string, nodeLabel?: string }) => void;
  clearLogs: () => void;
  notices: Notice[];
  pushNotice: (level: NoticeLevel, message: string, durationMs?: number, action?: { label: string; onClick: () => void }) => void;
  removeNotice: (id: string) => void;

  imageHistory: ImageHistoryItem[];
  hydrateImageHistory: () => Promise<void>;
  deleteImageHistory: (id: string) => Promise<void>;
  clearImageHistory: () => Promise<void>;
}
