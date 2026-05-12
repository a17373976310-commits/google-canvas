import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bot, Check, ChevronRight, CornerDownLeft, FileText, FileUp, Link2, Loader2, MessageSquare, Paperclip, Play, Plus, Send, Settings2, Sparkles, Square, Trash2, Wrench, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useStore } from '../store';
import { AIService } from '../services/aiService';
import { fileToOptimizedImageDataUrl } from '../utils/imageCompression';
import { NodeType, StandardFilePayload } from '../types';

type AgentMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type CanvasAgentActionType =
  | 'update_node_config'
  | 'create_node'
  | 'parse_spreadsheet_attachment'
  | 'extract_spreadsheet_images'
  | 'attach_file_to_canvas'
  | 'connect_nodes'
  | 'run_node'
  | 'run_selected'
  | 'run_all_image_nodes'
  | 'explain_canvas';

type CanvasAgentAction = {
  type: CanvasAgentActionType;
  nodeId?: string;
  nodeType?: string;
  sourceId?: string;
  sourceHandle?: string;
  targetId?: string;
  targetHandle?: string;
  connectFromId?: string;
  attachmentId?: string;
  attachmentIds?: string[];
  spreadsheetImageIds?: string[];
  maxImages?: number;
  config?: Record<string, any>;
  prompt?: string;
  label?: string;
  position?: { x?: number; y?: number };
  requiresConfirmation?: boolean;
  reason?: string;
};

type CanvasToolResult = {
  tool: CanvasAgentActionType;
  ok: boolean;
  message: string;
  nodeId?: string;
  nodeIds?: string[];
};

type PendingCanvasRequest = {
  actions: CanvasAgentAction[];
  reason: string;
  userText: string;
  conversation: AgentMessage[];
  previousResults: CanvasToolResult[];
};

type AgentAttachment = {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: StandardFilePayload['type'];
  payload: StandardFilePayload;
  modelSummary: string;
  spreadsheet?: SpreadsheetAttachmentAnalysis;
  spreadsheetImages?: SpreadsheetExtractedImage[];
};

type SpreadsheetExtractedImage = {
  id: string;
  sheetName: string;
  mediaPath: string;
  mime: string;
  dataUrl: string;
  rowIndex: number;
  columnIndex: number;
  rowNumber: number;
  columnNumber: number;
  name?: string;
};

type SpreadsheetColumnRole = 'task' | 'prompt' | 'size' | 'style' | 'reference' | 'image' | 'product' | 'unknown';

type SpreadsheetSheetAnalysis = {
  name: string;
  rowCount: number;
  columnCount: number;
  headerRowIndex: number;
  headers: string[];
  detectedColumns: Array<{
    index: number;
    header: string;
    role: SpreadsheetColumnRole;
  }>;
  sampleRows: Record<string, string>[];
};

type SpreadsheetAttachmentAnalysis = {
  sheetCount: number;
  embeddedImageCount: number;
  sheets: SpreadsheetSheetAnalysis[];
  taskLikeRowCount: number;
  summary: string;
};

const ACTION_TYPES = new Set<CanvasAgentActionType>([
  'update_node_config',
  'create_node',
  'parse_spreadsheet_attachment',
  'extract_spreadsheet_images',
  'attach_file_to_canvas',
  'connect_nodes',
  'run_node',
  'run_selected',
  'run_all_image_nodes',
  'explain_canvas',
]);

const MAX_AGENT_STEPS = 4;

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const isTextLikeFile = (file: File) => (
  file.type.startsWith('text/')
  || /\.(txt|md|json|csv|tsv|yaml|yml|html|css|js|ts|tsx|jsx|py|xml)$/i.test(file.name)
);

const readFileAsText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
  reader.readAsText(file);
});

const readFileAsArrayBuffer = (file: File) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
  reader.readAsArrayBuffer(file);
});

const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const normalizeCellText = (value: any) => String(value ?? '').replace(/\s+/g, ' ').trim();

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...Array.from(chunk));
  }
  return btoa(binary);
};

const fileEntryToBytes = (entry: any): Uint8Array => {
  const content = entry?.content ?? entry;
  if (!content) return new Uint8Array();
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (Array.isArray(content)) return new Uint8Array(content);
  if (typeof content === 'string') return new TextEncoder().encode(content);
  return new Uint8Array();
};

const fileEntryToText = (entry: any) => new TextDecoder().decode(fileEntryToBytes(entry));

const getXmlAttr = (tag: string, attrName: string) => {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${escaped}="([^"]*)"`, 'i'));
  return match?.[1] || '';
};

const parseRelationships = (xml: string) => {
  const relationships: Array<{ id: string; type: string; target: string }> = [];
  const regex = /<Relationship\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml))) {
    const tag = match[0];
    relationships.push({
      id: getXmlAttr(tag, 'Id'),
      type: getXmlAttr(tag, 'Type'),
      target: getXmlAttr(tag, 'Target'),
    });
  }
  return relationships.filter((relationship) => relationship.id && relationship.target);
};

const resolvePackagePath = (baseDir: string, target: string) => {
  if (target.startsWith('/')) return target.replace(/^\/+/, '');
  const parts = `${baseDir}/${target}`.split('/');
  const resolved: string[] = [];
  parts.forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  });
  return resolved.join('/');
};

const mimeFromMediaPath = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'svg') return 'image/svg+xml';
  return 'image/png';
};

const extractSpreadsheetImagesFromWorkbook = (
  workbook: XLSX.WorkBook,
  files: Record<string, any>,
  attachmentId: string
): SpreadsheetExtractedImage[] => {
  const images: SpreadsheetExtractedImage[] = [];
  workbook.SheetNames.forEach((sheetName, index) => {
    const sheetNumber = index + 1;
    const sheetRelPath = `xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`;
    const sheetRelsXml = fileEntryToText(files[sheetRelPath]);
    const drawingRel = parseRelationships(sheetRelsXml)
      .find((relationship) => /\/drawing$/i.test(relationship.type) || /\/drawingml\/2006\/spreadsheetDrawing$/i.test(relationship.type));
    if (!drawingRel) return;

    const drawingPath = resolvePackagePath('xl/worksheets', drawingRel.target);
    const drawingXml = fileEntryToText(files[drawingPath]);
    const drawingRelPath = drawingPath.replace(/^(.+\/)([^/]+)$/, '$1_rels/$2.rels');
    const mediaByRelId = new Map(parseRelationships(fileEntryToText(files[drawingRelPath]))
      .filter((relationship) => /\/image$/i.test(relationship.type))
      .map((relationship) => [relationship.id, resolvePackagePath('xl/drawings', relationship.target)]));

    const anchorRegex = /<xdr:(?:oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/xdr:(?:oneCellAnchor|twoCellAnchor)>/gi;
    let anchorMatch: RegExpExecArray | null;
    while ((anchorMatch = anchorRegex.exec(drawingXml))) {
      const anchorXml = anchorMatch[0];
      const embedId = anchorXml.match(/(?:r:embed|embed)="([^"]+)"/i)?.[1] || '';
      const mediaPath = mediaByRelId.get(embedId);
      if (!mediaPath || !files[mediaPath]) continue;

      const fromXml = anchorXml.match(/<xdr:from\b[^>]*>([\s\S]*?)<\/xdr:from>/i)?.[1] || '';
      const rowIndex = Number(fromXml.match(/<xdr:row\b[^>]*>(\d+)<\/xdr:row>/i)?.[1] || 0);
      const columnIndex = Number(fromXml.match(/<xdr:col\b[^>]*>(\d+)<\/xdr:col>/i)?.[1] || 0);
      const name = anchorXml.match(/<xdr:cNvPr\b[^>]*\bname="([^"]*)"/i)?.[1] || undefined;
      const bytes = fileEntryToBytes(files[mediaPath]);
      if (bytes.length === 0) continue;
      const mime = mimeFromMediaPath(mediaPath);
      images.push({
        id: `${attachmentId}-image-${images.length + 1}`,
        sheetName,
        mediaPath,
        mime,
        dataUrl: `data:${mime};base64,${bytesToBase64(bytes)}`,
        rowIndex,
        columnIndex,
        rowNumber: rowIndex + 1,
        columnNumber: columnIndex + 1,
        name,
      });
    }
  });

  return images.sort((a, b) => (
    a.sheetName.localeCompare(b.sheetName) || a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex
  ));
};

const detectSpreadsheetColumnRole = (header: string, samples: string[]): SpreadsheetColumnRole => {
  const text = `${header} ${samples.slice(0, 6).join(' ')}`.toLowerCase();
  if (/(需求|要求|任务|描述|说明|brief|requirement|task|description)/i.test(text)) return 'task';
  if (/(提示词|prompt|画面|生成|文案|copy|caption)/i.test(text)) return 'prompt';
  if (/(尺寸|比例|画幅|规格|size|ratio|aspect|分辨率)/i.test(text)) return 'size';
  if (/(风格|调性|色调|参考风格|style|tone|palette)/i.test(text)) return 'style';
  if (/(参考|素材|链接|url|reference|asset|source)/i.test(text)) return 'reference';
  if (/(图片|图像|配图|主图|image|photo|pic)/i.test(text)) return 'image';
  if (/(产品|商品|品名|sku|product|item|name)/i.test(text)) return 'product';
  return 'unknown';
};

const findHeaderRowIndex = (rows: any[][]) => {
  const limit = Math.min(rows.length, 12);
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index] || [];
    const filled = row.filter((cell) => normalizeCellText(cell)).length;
    const keywordScore = row.reduce((score, cell) => {
      const text = normalizeCellText(cell);
      return score + (/(需求|任务|尺寸|文案|图片|参考|产品|prompt|size|image|task)/i.test(text) ? 2 : 0);
    }, 0);
    const score = filled + keywordScore;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
};

const buildSpreadsheetAnalysis = (workbook: XLSX.WorkBook, embeddedImageCount: number): SpreadsheetAttachmentAnalysis => {
  const sheets = workbook.SheetNames.map((sheetName): SpreadsheetSheetAnalysis => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = worksheet ? XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' }) : [];
    const headerRowIndex = findHeaderRowIndex(rows);
    const headerRow = rows[headerRowIndex] || [];
    const columnCount = Math.max(...rows.map((row) => row.length), headerRow.length, 0);
    const headers = Array.from({ length: columnCount }).map((_, index) => (
      normalizeCellText(headerRow[index]) || `列${index + 1}`
    ));
    const bodyRows = rows.slice(headerRowIndex + 1).filter((row) => row.some((cell) => normalizeCellText(cell)));
    const sampleRows = bodyRows.slice(0, 50).map((row) => headers.reduce<Record<string, string>>((acc, header, index) => {
      const value = normalizeCellText(row[index]);
      if (value) acc[header] = value;
      return acc;
    }, {}));
    const detectedColumns = headers.map((header, index) => ({
      index,
      header,
      role: detectSpreadsheetColumnRole(header, bodyRows.map((row) => normalizeCellText(row[index]))),
    }));

    return {
      name: sheetName,
      rowCount: rows.length,
      columnCount,
      headerRowIndex,
      headers,
      detectedColumns,
      sampleRows,
    };
  });
  const taskLikeRowCount = sheets.reduce((total, sheet) => {
    const hasTaskColumn = sheet.detectedColumns.some((column) => ['task', 'prompt', 'product'].includes(column.role));
    return total + (hasTaskColumn ? Math.max(0, sheet.rowCount - sheet.headerRowIndex - 1) : 0);
  }, 0);
  const summary = [
    `识别到 ${sheets.length} 个工作表。`,
    `估算任务行 ${taskLikeRowCount} 条。`,
    embeddedImageCount > 0 ? `发现表内嵌图片约 ${embeddedImageCount} 张。` : '未发现表内嵌图片。',
    ...sheets.slice(0, 4).map((sheet) => {
      const roles = sheet.detectedColumns
        .filter((column) => column.role !== 'unknown')
        .map((column) => `${column.header}=${column.role}`)
        .join('、') || '未识别关键列';
      return `${sheet.name}：${sheet.rowCount} 行、${sheet.columnCount} 列；${roles}`;
    }),
  ].join('\n');

  return {
    sheetCount: sheets.length,
    embeddedImageCount,
    sheets,
    taskLikeRowCount,
    summary,
  };
};

const buildAttachmentFromFile = async (file: File): Promise<AgentAttachment> => {
  const id = `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const normalizedName = file.name.toLowerCase();
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  const isExcel = normalizedName.endsWith('.xlsx')
    || normalizedName.endsWith('.xls')
    || normalizedName.endsWith('.csv')
    || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || file.type === 'application/vnd.ms-excel'
    || file.type === 'text/csv';

  let kind: StandardFilePayload['type'] = 'generic';
  if (isImage) kind = 'image';
  else if (isVideo) kind = 'video';
  else if (isExcel) kind = 'xlsx';

  const payload: StandardFilePayload = {
    id,
    createdAt: Date.now(),
    source: 'local',
    type: kind,
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
  };
  let modelSummary = `${file.name} (${kind}, ${formatFileSize(file.size)})`;
  let spreadsheet: SpreadsheetAttachmentAnalysis | undefined;
  let spreadsheetImages: SpreadsheetExtractedImage[] | undefined;

  if (isImage) {
    const dataUrl = await fileToOptimizedImageDataUrl(file);
    payload.url = dataUrl;
    payload.data = dataUrl;
    modelSummary = `${file.name}：图片附件，可作为画布图片输入。`;
  } else if (isExcel) {
    const buffer = await readFileAsArrayBuffer(file);
    const workbook = XLSX.read(buffer, { type: 'array', bookFiles: true });
    const workbookFiles = ((workbook as any).files || {}) as Record<string, any>;
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = worksheet ? XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 }) : [];
    const embeddedImageCount = Object.keys(workbookFiles)
      .filter((key) => /^xl\/media\//i.test(String(key)))
      .length;
    spreadsheet = buildSpreadsheetAnalysis(workbook, embeddedImageCount);
    spreadsheetImages = extractSpreadsheetImagesFromWorkbook(workbook, workbookFiles, id);
    payload.previewData = rows.slice(0, 8);
    payload.meta = {
      sheetName: firstSheetName,
      sheetNames: workbook.SheetNames,
      sheetCount: workbook.SheetNames.length,
      rowCount: rows.length,
      columns: rows[0]?.length || 0,
      embeddedImageCount,
      extractedImageCount: spreadsheetImages.length,
      spreadsheetSummary: spreadsheet.summary,
      sheetSummaries: spreadsheet.sheets.map((sheet) => ({
        name: sheet.name,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        headers: sheet.headers,
        detectedColumns: sheet.detectedColumns,
      })),
    };
    modelSummary = `${file.name}：表格附件。\n${spreadsheet.summary}\n已提取表内图片 ${spreadsheetImages.length} 张。\n首个工作表预览：${JSON.stringify(payload.previewData).slice(0, 900)}`;
  } else if (isTextLikeFile(file) && file.size <= 512 * 1024) {
    const text = await readFileAsText(file);
    payload.data = clampText(text, 4000);
    modelSummary = `${file.name}：文本附件预览：\n${payload.data}`;
  } else {
    payload.url = URL.createObjectURL(file);
    modelSummary = `${file.name}：文件附件，类型 ${payload.mime}，大小 ${formatFileSize(file.size)}。`;
  }

  return {
    id,
    name: file.name,
    size: file.size,
    mime: payload.mime,
    kind,
    payload,
    modelSummary,
    spreadsheet,
    spreadsheetImages,
  };
};

const clampText = (value: string, max = 900) => (
  value.length > max ? `${value.slice(0, max)}...` : value
);

const stripCodeFence = (value: string) => (
  value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
);

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
    throw new Error('No JSON object found');
  }
};

const confirmsPendingAction = (text: string) => /^(好|好的|可以|确认|执行|继续|开始|是|对|ok|yes)$/i.test(text.trim());
const wantsRun = (text: string) => /(运行|执行|跑|生成|开始|run)/i.test(text);
const wantsMany = (text: string) => /(全部|所有|批量|每个|一批|多个)/i.test(text);

const resolveCanvasNodeType = (value?: string): NodeType | null => {
  const raw = String(value || '').trim();
  const normalized = raw.toUpperCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, NodeType> = {
    IMAGE: NodeType.AI_IMAGE,
    IMAGE_NODE: NodeType.AI_IMAGE,
    AIIMAGE: NodeType.AI_IMAGE,
    CHAT: NodeType.AI_CHAT,
    TEXT: NodeType.INPUT,
    PROMPT: NodeType.INPUT,
    OUTPUT_NODE: NodeType.OUTPUT,
    UPLOAD: NodeType.IMAGE_UPLOAD,
    IMAGE_REFERENCE: NodeType.IMAGE_UPLOAD,
    MULTI_UPLOAD: NodeType.MULTI_IMAGE_UPLOAD,
    FILE: NodeType.FILE_UPLOAD,
    FILE_UPLOAD: NodeType.FILE_UPLOAD,
    DOCUMENT: NodeType.FILE_UPLOAD,
    EXCEL: NodeType.FILE_UPLOAD,
    SPREADSHEET: NodeType.FILE_UPLOAD,
    TABLE: NodeType.TABLE_PARSE,
    TABLE_PARSE: NodeType.TABLE_PARSE,
    PARSE_TABLE: NodeType.TABLE_PARSE,
    SPREADSHEET_PARSE: NodeType.TABLE_PARSE,
    TASK: NodeType.TASK_SELECT,
    TASK_SELECT: NodeType.TASK_SELECT,
    SELECT_TASK: NodeType.TASK_SELECT,
    BATCH: NodeType.BATCH_EXECUTE,
    BATCH_EXECUTE: NodeType.BATCH_EXECUTE,
    BATCH_RUN: NodeType.BATCH_EXECUTE,
    STYLE: NodeType.STYLE_GUIDE,
    STYLE_GUIDE: NodeType.STYLE_GUIDE,
    PRODUCT_MATCH: NodeType.PRODUCT_IMAGE_MATCH,
    PRODUCT_IMAGE_MATCH: NodeType.PRODUCT_IMAGE_MATCH,
    IMAGE_MATCH: NodeType.PRODUCT_IMAGE_MATCH,
  };
  if (aliases[normalized]) return aliases[normalized];
  return Object.values(NodeType).find((type) => type === normalized) || null;
};

const normalizeStringArray = (value: any): string[] | undefined => {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item || '').trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === 'string') {
    const items = value.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
};

const normalizeCanvasActions = (parsed: any): CanvasAgentAction[] => {
  const rawActions = Array.isArray(parsed?.actions)
    ? parsed.actions
    : (parsed?.action && typeof parsed.action === 'object' ? [parsed.action] : []);

  return rawActions
    .map((action: any): CanvasAgentAction | null => {
      const type = String(action?.type || '').trim() as CanvasAgentActionType;
      if (!ACTION_TYPES.has(type)) return null;
      return {
        type,
        nodeId: action?.nodeId ? String(action.nodeId) : undefined,
        nodeType: action?.nodeType ? String(action.nodeType) : undefined,
        sourceId: action?.sourceId ? String(action.sourceId) : undefined,
        sourceHandle: action?.sourceHandle ? String(action.sourceHandle) : undefined,
        targetId: action?.targetId ? String(action.targetId) : undefined,
        targetHandle: action?.targetHandle ? String(action.targetHandle) : undefined,
        connectFromId: action?.connectFromId ? String(action.connectFromId) : undefined,
        attachmentId: action?.attachmentId ? String(action.attachmentId) : undefined,
        attachmentIds: normalizeStringArray(action?.attachmentIds),
        spreadsheetImageIds: normalizeStringArray(action?.spreadsheetImageIds || action?.imageIds || action?.spreadsheetImages),
        maxImages: Number.isFinite(Number(action?.maxImages)) ? Number(action.maxImages) : undefined,
        config: action?.config && typeof action.config === 'object' ? action.config : undefined,
        prompt: typeof action?.prompt === 'string' ? action.prompt : undefined,
        label: typeof action?.label === 'string' ? action.label : undefined,
        position: action?.position && typeof action.position === 'object' ? action.position : undefined,
        requiresConfirmation: action?.requiresConfirmation === true || action?.requires_confirmation === true,
        reason: typeof action?.reason === 'string' ? action.reason : undefined,
      };
    })
    .filter((action): action is CanvasAgentAction => !!action);
};

const summarizeAction = (action: CanvasAgentAction) => {
  if (action.type === 'update_node_config') return `修改 ${action.nodeId || 'selected'}`;
  if (action.type === 'create_node') return `创建 ${action.nodeType || '节点'}`;
  if (action.type === 'parse_spreadsheet_attachment') return `解析表格 ${action.attachmentId || ''}`;
  if (action.type === 'extract_spreadsheet_images') return `提取表格图片 ${action.attachmentId || ''}`;
  if (action.type === 'attach_file_to_canvas') {
    const selectedImages = action.spreadsheetImageIds?.length ? `，${action.spreadsheetImageIds.length} 张表内图` : '';
    return `上传 ${action.attachmentId || action.attachmentIds?.length || '附件'} 到画布${selectedImages}`;
  }
  if (action.type === 'connect_nodes') return `连接 ${action.sourceId || '?'} -> ${action.targetId || '?'}`;
  if (action.type === 'run_selected') return '运行选中节点';
  if (action.type === 'run_node') return `运行 ${action.nodeId || '节点'}`;
  if (action.type === 'run_all_image_nodes') return '运行全部图像节点';
  return '读取画布说明';
};

const buildAgentSystemPrompt = () => [
  '# Canvas Agent Skill v1',
  '',
  '你是 AI Canvas 的画布操作智能体。你的职责不是聊天陪跑，而是把用户的自然语言意图转成安全、可验证、可执行的画布 actions。',
  '你像 Claude Code 一样工作：你负责判断、规划、选择工具；前端负责真正执行画布工具，并把 toolResults 回传给你。',
  '',
  '## 0. 不可违反的工作边界',
  '- 只操作画布能力：查看画布状态、解释结构、分析附件、创建节点、修改节点、连接节点、运行节点。',
  '- 不要假装已经执行工具。凡是会改变画布或运行节点的事，都必须通过 actions。',
  '- 不要做批次管理、历史保存、真实文件上传；附件已经由前端读取，你只能分析 availableAttachments 或把附件节点化。',
  '- 不确定就追问。不要为了显得主动而替用户最终选择任务、图片、行号、节点或批量范围。',
  '- 每个会改变画布的 action 都必须有 reason。reason 说明为什么这一步必要。',
  '',
  '## 1. Karpathy 行为规范',
  '- Think Before Acting：先判断用户是“分析/解释/筛选/计划”还是“执行/导入/搭建/运行”。没有明确执行意图时 actions 必须为空。',
  '- Simplicity First：用最少节点完成目标。不要为了炫技创建多余节点、分组、复杂链路。',
  '- Surgical Changes：只修改用户指定或目标必需的节点。不要顺手重写其他节点 prompt、模型或连线。',
  '- Goal-Driven Execution：每次动作要有可验证结果；工具失败后先解释失败与下一步，不要继续叠加错误动作。',
  '',
  '## 2. 输出协议',
  '- 只能返回严格 JSON。不要 Markdown，不要代码块，不要额外解释。',
  '- 顶层字段：reply, actions, needsConfirmation, reason。',
  '- reply 用简短中文，说明你理解了什么、做了什么或需要用户确认什么。',
  '- actions 是数组。没有动作时返回空数组。',
  '- needsConfirmation=true 用于整组动作需要用户确认；单个 action 也可以 requiresConfirmation=true。',
  '- nodeId 可以用 "selected" 表示当前选中节点。',
  '- sourceId/targetId 必须来自 canvasState.nodes，除非 sourceId 使用 "last_created" 引用本轮刚创建的最后一个节点。',
  '- create_node 支持 connectFromId/sourceId；如果需要精确连线，可以提供 sourceHandle 和 targetHandle。',
  '- attach_file_to_canvas 支持 attachmentId/attachmentIds；导入 Excel 表内图片子集时提供 spreadsheetImageIds（也可写 imageIds）。',
  '',
  'JSON 示例：',
  '{"reply":"我会先解析表格，整理候选任务后再让你确认是否导入。","actions":[{"type":"parse_spreadsheet_attachment","attachmentId":"attachment_x","reason":"用户要求读取表格任务，解析不会修改画布。"}],"needsConfirmation":false,"reason":""}',
  '',
  '## 3. 可用 actions',
  '- explain_canvas：解释当前画布结构，不修改画布。',
  '- parse_spreadsheet_attachment：解析 xlsx/xls/csv 附件，返回 sheet、列角色、任务行估算和样例任务。不修改画布。',
  '- extract_spreadsheet_images：提取 Excel 表内嵌图片，返回图片 id、sheet、行列位置。不修改画布。',
  '- attach_file_to_canvas：把已选附件放进画布，创建 IMAGE_UPLOAD、MULTI_IMAGE_UPLOAD 或 FILE_UPLOAD 节点。只在用户明确要求导入/放到画布/连接到节点时使用；若只导入 Excel 表内某几张图片，提供 spreadsheetImageIds。',
  '- create_node：创建节点。nodeType 支持 INPUT、IMAGE_UPLOAD、MULTI_IMAGE_UPLOAD、FILE_UPLOAD、TABLE_PARSE、TASK_SELECT、BATCH_EXECUTE、STYLE_GUIDE、PRODUCT_IMAGE_MATCH、AI_CHAT、AI_IMAGE、AI_AUDIO、AI_VIDEO、OUTPUT、GROUP。',
  '- update_node_config：修改节点 label/config/prompt。常用 config：prompt、systemInstruction、modelId、aspectRatio、imageSize、imageQuality、duration、parseMode、sheetName、dataStartRow、requirementColumn、textColumns、taskIndex、startIndex、endIndex、styleName、tone、palette、lighting、background、composition、camera、material、qualityKeywords、consistencyRules、negativeRules、maxSelections、matchNotes。',
  '- connect_nodes：连接节点。可选 sourceHandle/targetHandle；没有提供时系统会推断常用 handle。',
  '- run_selected：运行当前选中节点，并自动先运行必要上游。',
  '- run_node：运行指定节点，并自动先运行必要上游。',
  '- run_all_image_nodes：运行全部 AI_IMAGE 节点。高风险，必须非常明确或确认。',
  '',
  '## 4. 节点能力地图',
  '- INPUT：输出文本 prompt。常接 AI_CHAT/AI_IMAGE/AI_AUDIO/AI_VIDEO 的 prompt。',
  '- FILE_UPLOAD：输出文件。Excel/CSV 接 TABLE_PARSE.file。',
  '- IMAGE_UPLOAD / MULTI_IMAGE_UPLOAD：输出一张/多张图片。常接 AI_IMAGE.image、AI_CHAT.image、STYLE_GUIDE.image、PRODUCT_IMAGE_MATCH.image。',
  '- TABLE_PARSE：把表格文件解析为任务列表。输入 file，输出 tasks。',
  '- TASK_SELECT：从任务列表中选第 N 条。输入 tasks，输出 prompt、image、task。',
  '- BATCH_EXECUTE：从任务列表展开批量生成。输入 tasks；第一次运行展开，第二次运行批量生成。',
  '- STYLE_GUIDE：根据任务/参考图生成统一风格约束。输入 task/image，输出 prompt/style。',
  '- PRODUCT_IMAGE_MATCH：根据任务和候选产品图筛选最匹配参考图。输入 task/prompt/image，输出 image/report。',
  '- AI_CHAT：文本/多模态推理。输入 prompt/image/style，输出文本。',
  '- AI_IMAGE：图像生成。输入 prompt/image/template/batch，输出图片。',
  '- AI_AUDIO：语音生成。输入 prompt，输出音频。',
  '- AI_VIDEO：视频生成。输入 prompt/image，输出视频。',
  '- OUTPUT：汇总展示上游输出。',
  '- GROUP：视觉分组，不参与数据流。',
  '',
  '## 5. 常用 handle',
  '- 文件到表格：FILE_UPLOAD.output -> TABLE_PARSE.file',
  '- 表格到任务选择：TABLE_PARSE.output -> TASK_SELECT.tasks',
  '- 表格到批量：TABLE_PARSE.output -> BATCH_EXECUTE.tasks',
  '- 任务到图像：TASK_SELECT.prompt -> AI_IMAGE.prompt；TASK_SELECT.image -> AI_IMAGE.image；TASK_SELECT.task -> STYLE_GUIDE.task 或 PRODUCT_IMAGE_MATCH.task',
  '- 风格到图像：STYLE_GUIDE.prompt -> AI_IMAGE.prompt',
  '- 产品图筛选到图像：PRODUCT_IMAGE_MATCH.image -> AI_IMAGE.image',
  '- 上传图到图像：IMAGE_UPLOAD.output / MULTI_IMAGE_UPLOAD.output -> AI_IMAGE.image',
  '- 已生成图片到视频：AI_IMAGE -> AI_VIDEO.image（生成类节点的 sourceHandle 留空）。',
  '- 批量节点可以直接运行并自动补默认图像模板；只有用户要求高级模板时才额外创建 STYLE_GUIDE/PRODUCT_IMAGE_MATCH/AI_IMAGE 模板链。',
  '',
  '## 6. 意图路由',
  '- 解释/看看画布/当前结构：使用 explain_canvas，或直接根据 canvasState 回复；不创建节点。',
  '- 读取/识别/分析/整理/总结附件：优先分析附件，不导入画布。',
  '- 分析表格/Excel/CSV/表格任务：如果有 xlsx 附件，先 parse_spreadsheet_attachment；返回候选任务、sheet、行号、缺失信息。',
  '- 查看/提取表格图片/内嵌图/参考图：先 extract_spreadsheet_images；列出图片 id 和行列，等待用户选择或确认导入。',
  '- 导入附件/放到画布/连接到选中节点：使用 attach_file_to_canvas；有多个附件时必须明确 attachmentIds 或先追问。',
  '- 修改当前节点：如果 selectedNodeId 存在，使用 update_node_config；没有选中且用户没给节点 id，先追问。',
  '- 创建单个生图节点：create_node AI_IMAGE，可设置 prompt/aspectRatio/imageSize/imageQuality/modelId；需要参考图时先导入或连接图片节点。',
  '- 搭建表格批量生图：典型流程是 attach_file_to_canvas -> create_node TABLE_PARSE -> connect -> create_node BATCH_EXECUTE -> connect。运行前通常 needsConfirmation=true。',
  '- 搭建单条任务生图：FILE_UPLOAD -> TABLE_PARSE -> TASK_SELECT -> AI_IMAGE；如需统一风格，加 STYLE_GUIDE；如需产品图筛选，加 PRODUCT_IMAGE_MATCH。',
  '- 运行/生成/开始：只运行用户指定节点、选中节点、明确范围或刚创建的必要节点；批量运行必须确认。',
  '',
  '## 7. 附件与候选选择纪律',
  '- 附件默认只是智能体上下文。用户说“读取/分析/看看文档/看看图片/提取需求”时，只回复整理结果或使用非修改类解析 action。',
  '- 用户说品类、系列、关键词、sheet 名、模糊范围，例如“钛锅”“做这个系列”“看看主图”“这个表里的”，只表示缩小候选，不表示执行。',
  '- 多个候选任务/图片/附件时，必须列出最相关候选：编号、sheet、行号、简短内容、图片 id，然后追问“选哪条/哪几条/是否全部”。',
  '- 只有用户明确说“第 3 行导入”“做第 1 条”“这些全部导入”“按刚才选的执行”“连接到选中节点”时，才能导入或修改画布。',
  '- 如果用户要求把表格图片导入画布，先 extract_spreadsheet_images；用户选择图片 id 后，用 attach_file_to_canvas + spreadsheetImageIds 精确导入，不要默认把整份表所有图片都导入。',
  '',
  '## 8. 安全确认规则',
  '- 以下必须 needsConfirmation=true：创建超过 3 个节点、批量范围超过 5 条、run_all_image_nodes、会运行多个节点、用户意图模糊但动作会修改画布、将附件全部导入、影响多个已有节点。',
  '- 用户只是要求“分析/整理/看看/识别/提取信息”时，不要设置修改画布的 actions。',
  '- 用户要求 46:19 且模型是 gpt-image-2 时，imageSize 只能用 2K 或 4K；如果用户要 1K，自动改 2K 并在 reply 说明。',
  '- 不删除、不清空、不重排整张画布；当前没有删除 action，不要编造。',
  '',
  '## 9. 画布搭建模板',
  '- 简单文生图：create INPUT 或直接 create AI_IMAGE(config.prompt)，必要时 run_node。只为一个 prompt 创建一个 AI_IMAGE。',
  '- 参考图生图：attach_file_to_canvas 图片 -> create AI_IMAGE -> connect image -> 设置 prompt -> 运行或等待确认。',
  '- 单条表格任务：attach_file_to_canvas 表格 -> TABLE_PARSE -> TASK_SELECT(config.taskIndex) -> AI_IMAGE。先运行 TABLE_PARSE/TASK_SELECT，再运行 AI_IMAGE。',
  '- 批量表格生图：attach_file_to_canvas 表格 -> TABLE_PARSE -> BATCH_EXECUTE(config.startIndex/endIndex)。先确认范围；第一次运行 BATCH_EXECUTE 展开，第二次运行开始批量。',
  '- 品牌统一风格：TASK_SELECT.task + 参考图 -> STYLE_GUIDE -> AI_IMAGE.prompt；STYLE_GUIDE 只放风格约束，不改产品主体真实性。',
  '- 产品图智能匹配：TASK_SELECT.task/prompt + MULTI_IMAGE_UPLOAD.image -> PRODUCT_IMAGE_MATCH -> AI_IMAGE.image。',
  '- 视频：已有图片或生成图 -> AI_VIDEO.image，加 prompt 描述运动；没有图片时只用 prompt 生成视频。',
  '',
  '## 10. 工具循环',
  '- 第 1 步通常用于分析/创建/连接/运行一个小闭环。',
  '- 收到 toolResults 后，根据结果继续：成功则汇报或下一步；失败则停止追问或给出修复动作。',
  '- 不要重复执行已经成功的同一 action，除非用户要求重跑。',
  '- 最多 4 轮，优先在 1-2 轮内完成。',
].join('\n');

const buildAgentPayload = (params: {
  userMessage: string;
  messages: AgentMessage[];
  canvasState: any;
  attachments: AgentAttachment[];
  toolResults: CanvasToolResult[];
  step: number;
}) => JSON.stringify({
  userMessage: params.userMessage,
  step: params.step,
  recentConversation: params.messages.slice(-10).map((message) => ({
    role: message.role,
    content: message.content,
  })),
  canvasState: params.canvasState,
  availableAttachments: params.attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    kind: attachment.kind,
    size: attachment.size,
    mime: attachment.mime,
    summary: attachment.modelSummary,
    spreadsheet: attachment.spreadsheet ? {
      sheetCount: attachment.spreadsheet.sheetCount,
      taskLikeRowCount: attachment.spreadsheet.taskLikeRowCount,
      embeddedImageCount: attachment.spreadsheet.embeddedImageCount,
      extractedImageCount: attachment.spreadsheetImages?.length || 0,
      extractedImages: (attachment.spreadsheetImages || []).slice(0, 20).map((image) => ({
        id: image.id,
        sheetName: image.sheetName,
        rowNumber: image.rowNumber,
        columnNumber: image.columnNumber,
        mime: image.mime,
      })),
      sheets: attachment.spreadsheet.sheets.map((sheet) => ({
        name: sheet.name,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        headers: sheet.headers,
        detectedColumns: sheet.detectedColumns,
      })),
    } : undefined,
  })),
  availableActions: Array.from(ACTION_TYPES),
  toolResults: params.toolResults,
}, null, 2);

const renderMessage = (content: string) => (
  <div className="space-y-1.5">
    {content.split('\n').map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return <div key={`${index}-empty`} className="h-1.5" />;
      }
      if (/^[-•]\s+/.test(trimmed)) {
        return (
          <div key={`${index}-${trimmed.slice(0, 12)}`} className="flex gap-1.5 text-[11px] leading-relaxed theme-text-primary">
            <ChevronRight size={12} className="mt-0.5 shrink-0 text-cyan-300/70" />
            <span className="min-w-0 break-words">{trimmed.replace(/^[-•]\s+/, '')}</span>
          </div>
        );
      }
      return (
        <p key={`${index}-${trimmed.slice(0, 12)}`} className="break-words text-[11px] leading-relaxed theme-text-primary">
          {trimmed}
        </p>
      );
    })}
  </div>
);

const getAttachmentKindLabel = (kind: AgentAttachment['kind']) => {
  if (kind === 'image') return '图片';
  if (kind === 'video') return '视频';
  if (kind === 'xlsx') return '表格';
  return '文件';
};

const summarizeToolResultsForUser = (results: CanvasToolResult[]) => {
  if (results.length === 0) return '没有可执行的画布动作。';
  return results.map((result) => {
    const raw = String(result.message || '');
    if (result.tool === 'parse_spreadsheet_attachment' && raw.startsWith('表格解析结果：')) {
      try {
        const parsed = JSON.parse(raw.replace(/^表格解析结果：\s*/, ''));
        const sheets = Array.isArray(parsed?.sheets) ? parsed.sheets : [];
        const sheetLines = sheets.slice(0, 4).map((sheet: any) => {
          const columns = Array.isArray(sheet?.detectedColumns)
            ? sheet.detectedColumns.map((column: any) => `${column.header || `列${Number(column.index || 0) + 1}`}=${column.role}`).join('、')
            : '未识别关键列';
          return `- ${sheet?.name || '工作表'}：${sheet?.rowCount || 0} 行，${sheet?.columnCount || 0} 列；${columns || '未识别关键列'}`;
        });
        return [
          `已解析表格「${parsed?.fileName || '附件'}」。`,
          `工作表 ${parsed?.sheetCount || sheets.length || 0} 个，估算任务行 ${parsed?.taskLikeRowCount || 0} 条，表内图片 ${parsed?.embeddedImageCount || 0} 张。`,
          ...sheetLines,
          '我会基于这些解析结果继续整理需求。',
        ].join('\n');
      } catch {
        return '已解析表格，我会基于解析结果继续整理需求。';
      }
    }
    if (result.tool === 'extract_spreadsheet_images' && raw.startsWith('表格图片提取结果：')) {
      try {
        const parsed = JSON.parse(raw.replace(/^表格图片提取结果：\s*/, ''));
        const images = Array.isArray(parsed?.images) ? parsed.images : [];
        const imageLines = images.slice(0, 8).map((image: any) => (
          `- ${image.id}：${image.sheetName} 第 ${image.rowNumber} 行，第 ${image.columnNumber} 列`
        ));
        return [
          `已从「${parsed?.fileName || '表格'}」提取图片。`,
          `共 ${parsed?.totalImages || 0} 张，本次返回 ${parsed?.returnedImages || images.length || 0} 张。`,
          ...imageLines,
          images.length > 8 ? `- 还有 ${images.length - 8} 张未展示。` : '',
          '这些图片现在可以作为参考图导入画布节点。',
        ].filter(Boolean).join('\n');
      } catch {
        return '已提取表格图片，可以继续导入画布。';
      }
    }
    return raw.length > 600 ? `${raw.slice(0, 600)}...` : raw;
  }).join('\n');
};

const actionIcon = (type: CanvasAgentActionType) => {
  if (type === 'update_node_config') return Settings2;
  if (type === 'create_node') return Plus;
  if (type === 'connect_nodes') return Link2;
  if (type === 'run_node' || type === 'run_selected' || type === 'run_all_image_nodes') return Play;
  return Sparkles;
};

export const CanvasAgentPanel: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const {
    nodes,
    edges,
    selectedNodeId,
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
    isWorkflowRunning,
    requestStopWorkflow,
  } = useStore();

  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '告诉我你想怎么改画布。我只负责读取画布状态、生成画布动作、调用画布执行。',
    },
  ]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<PendingCanvasRequest | null>(null);
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [isReadingFiles, setIsReadingFiles] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<AgentAttachment[]>([]);
  const agentAbortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);

  const activeProvider = apiProviders.find((provider) => provider.id === (activeProviderIds?.chat || activeProviderId));
  const chatModelId = globalActiveModels.chat || getModelsForNode(NodeType.AI_CHAT)[0] || '';
  const imageModelId = globalActiveModels.image || getModelsForNode(NodeType.AI_IMAGE)[0] || '';
  const selectedNode = selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) : null;

  const canvasState = useMemo(() => ({
    selectedNodeId,
    activeModels: {
      chat: chatModelId,
      image: imageModelId,
    },
    nodes: nodes.slice(0, 100).map((node) => ({
      id: node.id,
      type: node.data?.type || node.type,
      label: node.data?.label,
      selected: node.id === selectedNodeId || Boolean((node as any).selected),
      status: node.data?.status,
      config: {
        modelId: node.data?.config?.modelId,
        prompt: clampText(String(node.data?.config?.prompt || ''), 900),
        aspectRatio: node.data?.config?.aspectRatio,
        imageSize: node.data?.config?.imageSize,
        imageQuality: node.data?.config?.imageQuality,
        duration: node.data?.config?.duration,
      },
      hasOutput: node.data?.output !== undefined && node.data?.output !== null,
      inputKeys: Object.keys(node.data?.inputs || {}),
      position: node.position,
    })),
    edges: edges.slice(0, 160).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  }), [chatModelId, edges, imageModelId, nodes, selectedNodeId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingRequest]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => () => {
    attachmentsRef.current.forEach((attachment) => {
      const url = attachment.payload.url;
      if (typeof url === 'string' && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });
  }, []);

  const appendMessage = useCallback((message: Omit<AgentMessage, 'id'>) => {
    const next = { ...message, id: makeId() };
    setMessages((prev) => [...prev, next]);
    return next;
  }, []);

  const addAttachmentFiles = useCallback(async (files: File[], sourceLabel = '附件') => {
    if (files.length === 0) return;

    setIsReadingFiles(true);
    try {
      const nextAttachments = await Promise.all(files.slice(0, 8).map((file) => buildAttachmentFromFile(file)));
      setAttachments((prev) => [...prev, ...nextAttachments].slice(-12));
      appendMessage({
        role: 'assistant',
        content: `已读取 ${nextAttachments.length} 个${sourceLabel}。你可以让我先整理内容和需求，确认后再导入画布。`,
      });
    } catch (error: any) {
      appendMessage({ role: 'assistant', content: `读取附件失败：${error?.message || error}` });
      pushNotice('error', '读取附件失败');
    } finally {
      setIsReadingFiles(false);
    }
  }, [appendMessage, pushNotice]);

  const handleAttachmentChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []) as File[];
    event.target.value = '';
    await addAttachmentFiles(files, '附件');
  }, [addAttachmentFiles]);

  const handleComposerPaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.items || [])
      .filter((item) => item.type.startsWith('image/'))
      .map((item, index) => {
        const file = item.getAsFile();
        if (!file) return null;
        if (file.name) return file;
        const extension = item.type.split('/')[1] || 'png';
        return new File([file], `pasted-image-${Date.now()}-${index + 1}.${extension}`, { type: item.type });
      })
      .filter((file): file is File => !!file)
      .slice(0, 8);

    if (imageFiles.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    void addAttachmentFiles(imageFiles, '粘贴图片');
  }, [addAttachmentFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((attachment) => attachment.id === id);
      const url = target?.payload.url;
      if (typeof url === 'string' && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
      return prev.filter((attachment) => attachment.id !== id);
    });
  }, []);

  const pauseAll = useCallback((notify = true) => {
    stopRequestedRef.current = true;
    agentAbortControllerRef.current?.abort();
    agentAbortControllerRef.current = null;
    requestStopWorkflow();
    setPendingRequest(null);
    setIsThinking(false);
    if (notify) {
      appendMessage({ role: 'assistant', content: '已暂停全局执行。你可以修改指令后重新发送。' });
    }
  }, [appendMessage, requestStopWorkflow]);

  const executeCanvasActions = useCallback(async (actions: CanvasAgentAction[]) => {
    const createdNodeIds: string[] = [];
    const getFreshNodes = () => useStore.getState().nodes;
    const getFreshEdges = () => useStore.getState().edges;
    const resolveNodeId = (value?: string | null) => {
      const raw = String(value || '').trim();
      if (!raw || raw === 'selected' || raw === '$selected') return useStore.getState().selectedNodeId || selectedNodeId;
      if (raw === 'last_created') return createdNodeIds[createdNodeIds.length - 1] || null;
      return getFreshNodes().some((node) => node.id === raw) ? raw : null;
    };
    const nodeLabel = (id: string) => {
      const node = getFreshNodes().find((item) => item.id === id);
      return node?.data?.label || id;
    };
    const hasUsableOutput = (node: any) => {
      const output = node?.data?.output;
      if (output === undefined || output === null) return false;
      if (typeof output === 'string') return output.trim().length > 0;
      if (Array.isArray(output)) return output.length > 0;
      return true;
    };
    const isUploadNodeType = (type?: string) => (
      type === NodeType.IMAGE_UPLOAD || type === NodeType.MULTI_IMAGE_UPLOAD || type === NodeType.FILE_UPLOAD
    );
    const getNodeType = (id: string) => {
      const node = getFreshNodes().find((item) => item.id === id);
      return (node?.data?.type || node?.type) as NodeType | undefined;
    };
    const inferTargetHandle = (
      sourceType?: NodeType,
      targetType?: NodeType,
      requested?: string
    ) => {
      if (requested) return requested;
      if (targetType === NodeType.TABLE_PARSE) return 'file';
      if (targetType === NodeType.TASK_SELECT || targetType === NodeType.BATCH_EXECUTE) return 'tasks';
      if (targetType === NodeType.STYLE_GUIDE) {
        return isUploadNodeType(sourceType) ? 'image' : 'task';
      }
      if (targetType === NodeType.PRODUCT_IMAGE_MATCH) {
        if (isUploadNodeType(sourceType) || sourceType === NodeType.AI_IMAGE) return 'image';
        if (sourceType === NodeType.INPUT || sourceType === NodeType.AI_CHAT || sourceType === NodeType.STYLE_GUIDE) return 'prompt';
        return 'task';
      }
      if (targetType === NodeType.AI_IMAGE) {
        if (
          isUploadNodeType(sourceType)
          || sourceType === NodeType.PRODUCT_IMAGE_MATCH
          || sourceType === NodeType.AI_IMAGE
        ) return 'image';
        if (sourceType === NodeType.BATCH_EXECUTE) return 'batch';
        return 'prompt';
      }
      if (targetType === NodeType.AI_CHAT) {
        if (isUploadNodeType(sourceType) || sourceType === NodeType.AI_IMAGE || sourceType === NodeType.PRODUCT_IMAGE_MATCH) return 'image';
        if (sourceType === NodeType.STYLE_GUIDE) return 'style';
        return 'prompt';
      }
      if (targetType === NodeType.AI_VIDEO) {
        if (isUploadNodeType(sourceType) || sourceType === NodeType.AI_IMAGE) return 'image';
        return 'prompt';
      }
      if (targetType === NodeType.AI_AUDIO) return 'prompt';
      return undefined;
    };
    const inferSourceHandle = (
      sourceType?: NodeType,
      targetType?: NodeType,
      targetHandle?: string,
      requested?: string
    ) => {
      if (requested) return requested;
      if (sourceType === NodeType.TASK_SELECT) {
        if (targetHandle === 'image') return 'image';
        if (targetHandle === 'task') return 'task';
        return 'prompt';
      }
      if (sourceType === NodeType.STYLE_GUIDE) {
        if (targetHandle === 'style') return 'style';
        return 'prompt';
      }
      if (sourceType === NodeType.PRODUCT_IMAGE_MATCH) {
        if (targetHandle === 'prompt') return 'report';
        return 'image';
      }
      if (sourceType === NodeType.BATCH_EXECUTE) return 'batch';
      if (sourceType === NodeType.TABLE_PARSE) return 'output';
      if (sourceType === NodeType.INPUT || isUploadNodeType(sourceType)) return 'output';
      if (
        sourceType === NodeType.AI_CHAT
        || sourceType === NodeType.AI_IMAGE
        || sourceType === NodeType.AI_AUDIO
        || sourceType === NodeType.AI_VIDEO
        || sourceType === NodeType.OUTPUT
      ) return undefined;
      return undefined;
    };
    const connectToTarget = (
      sourceId: string,
      targetId: string,
      requestedSourceHandle?: string,
      requestedTargetHandle?: string
    ) => {
      const targetNode = getFreshNodes().find((node) => node.id === targetId);
      const targetType = targetNode?.data?.type || targetNode?.type;
      const sourceType = getNodeType(sourceId);
      const targetHandle = inferTargetHandle(sourceType, targetType as NodeType | undefined, requestedTargetHandle);
      const sourceHandle = inferSourceHandle(sourceType, targetType as NodeType | undefined, targetHandle, requestedSourceHandle);
      const duplicate = getFreshEdges().some((edge) => (
        edge.source === sourceId
        && edge.target === targetId
        && (edge.sourceHandle || null) === (sourceHandle || null)
        && (edge.targetHandle || null) === (targetHandle || null)
      ));
      if (duplicate || sourceId === targetId) return;
      onConnect({
        source: sourceId,
        sourceHandle: sourceHandle || null,
        target: targetId,
        targetHandle: targetHandle || null,
      });
    };
    const executeNodeWithUpstream = async (targetId: string, visited = new Set<string>()): Promise<string[]> => {
      if (visited.has(targetId) || stopRequestedRef.current) return [];
      visited.add(targetId);

      const ranLabels: string[] = [];
      const deps = getFreshEdges().filter((edge) => edge.target === targetId);
      for (const edge of deps) {
        if (stopRequestedRef.current) break;
        const sourceNode = getFreshNodes().find((node) => node.id === edge.source);
        if (!sourceNode) continue;

        ranLabels.push(...await executeNodeWithUpstream(sourceNode.id, visited));

        const freshSource = getFreshNodes().find((node) => node.id === edge.source);
        if (!freshSource) continue;
        const sourceType = freshSource.data?.type || freshSource.type;

        if (isUploadNodeType(sourceType) && !hasUsableOutput(freshSource)) {
          continue;
        }
        if (freshSource.data?.status === 'success') {
          continue;
        }

        await executeSingleNode(freshSource.id);
        ranLabels.push(nodeLabel(freshSource.id));

        const afterRun = getFreshNodes().find((node) => node.id === freshSource.id);
        if (afterRun?.data?.status === 'error') {
          throw new Error(`上游节点「${nodeLabel(freshSource.id)}」执行失败：${afterRun.data.error || '未知错误'}`);
        }
      }

      return ranLabels;
    };
    const results: CanvasToolResult[] = [];

    for (const action of actions) {
      if (stopRequestedRef.current) {
        results.push({ tool: action.type, ok: false, message: '已暂停，后续画布动作没有继续执行。' });
        break;
      }

      if (action.type === 'explain_canvas') {
        results.push({
          tool: action.type,
          ok: true,
          message: `当前画布有 ${getFreshNodes().length} 个节点、${getFreshEdges().length} 条连线。选中节点：${resolveNodeId('selected') || '无'}。`,
        });
        continue;
      }

      if (action.type === 'update_node_config') {
        const targetId = resolveNodeId(action.nodeId);
        const targetNode = targetId ? getFreshNodes().find((node) => node.id === targetId) : null;
        if (!targetId || !targetNode) {
          results.push({ tool: action.type, ok: false, message: '没有找到要修改的节点。' });
          continue;
        }

        const nextConfig: Record<string, any> = { ...(action.config || {}) };
        if (action.prompt !== undefined) nextConfig.prompt = action.prompt;
        const nextModelId = String(nextConfig.modelId || targetNode.data?.config?.modelId || '').toLowerCase();
        if (
          nextModelId.startsWith('gpt-image-2')
          && nextConfig.aspectRatio === '46:19'
          && !['2K', '4K'].includes(String(nextConfig.imageSize || ''))
        ) {
          nextConfig.imageSize = '2K';
        }

        updateNodeData(targetId, {
          ...(action.label ? { label: action.label } : {}),
          config: nextConfig,
        });
        results.push({
          tool: action.type,
          ok: true,
          nodeId: targetId,
          message: `已修改「${targetNode.data?.label || targetId}」。`,
        });
        continue;
      }

      if (action.type === 'create_node') {
        const nodeType = resolveCanvasNodeType(action.nodeType);
        if (!nodeType) {
          results.push({ tool: action.type, ok: false, message: `无法创建未知节点类型：${action.nodeType || '未指定'}` });
          continue;
        }

        const sourceId = resolveNodeId(action.connectFromId || action.sourceId);
        const baseNode = resolveNodeId('selected')
          ? getFreshNodes().find((node) => node.id === resolveNodeId('selected'))
          : null;
        const position = {
          x: Number(action.position?.x ?? ((baseNode?.position?.x ?? 120) + 360)),
          y: Number(action.position?.y ?? (baseNode?.position?.y ?? 120)),
        };
        const newNodeId = addNode(nodeType, position);
        createdNodeIds.push(newNodeId);

        if (action.config || action.prompt || action.label) {
          updateNodeData(newNodeId, {
            ...(action.label ? { label: action.label } : {}),
            config: {
              ...(action.config || {}),
              ...(action.prompt !== undefined ? { prompt: action.prompt } : {}),
            },
          });
        }
        if (sourceId) {
          connectToTarget(sourceId, newNodeId, action.sourceHandle, action.targetHandle);
        }

        results.push({
          tool: action.type,
          ok: true,
          nodeId: newNodeId,
          message: `已创建「${action.label || nodeType}」：${newNodeId}。`,
        });
        continue;
      }

      if (action.type === 'parse_spreadsheet_attachment') {
        const requestedId = action.attachmentId || action.attachmentIds?.[0];
        const spreadsheetAttachments = attachments.filter((attachment) => attachment.kind === 'xlsx' && attachment.spreadsheet);
        const targetAttachment = requestedId
          ? spreadsheetAttachments.find((attachment) => attachment.id === requestedId)
          : (spreadsheetAttachments.length === 1 ? spreadsheetAttachments[0] : null);

        if (!targetAttachment?.spreadsheet) {
          results.push({
            tool: action.type,
            ok: false,
            message: spreadsheetAttachments.length === 0
              ? '没有可解析的表格附件。请先上传 .xlsx、.xls 或 .csv 文件。'
              : '有多个表格附件，请指定要解析的 attachmentId。',
          });
          continue;
        }

        const analysis = targetAttachment.spreadsheet;
        const detail = {
          fileName: targetAttachment.name,
          sheetCount: analysis.sheetCount,
          embeddedImageCount: analysis.embeddedImageCount,
          taskLikeRowCount: analysis.taskLikeRowCount,
          sheets: analysis.sheets.map((sheet) => ({
            name: sheet.name,
            rowCount: sheet.rowCount,
            columnCount: sheet.columnCount,
            headerRow: sheet.headerRowIndex + 1,
            detectedColumns: sheet.detectedColumns.filter((column) => column.role !== 'unknown'),
            sampleRows: sheet.sampleRows.slice(0, 8),
          })),
        };

        results.push({
          tool: action.type,
          ok: true,
          message: `表格解析结果：\n${JSON.stringify(detail, null, 2).slice(0, 12000)}`,
        });
        continue;
      }

      if (action.type === 'extract_spreadsheet_images') {
        const requestedId = action.attachmentId || action.attachmentIds?.[0];
        const spreadsheetAttachments = attachments.filter((attachment) => attachment.kind === 'xlsx');
        const targetAttachment = requestedId
          ? spreadsheetAttachments.find((attachment) => attachment.id === requestedId)
          : (spreadsheetAttachments.length === 1 ? spreadsheetAttachments[0] : null);

        if (!targetAttachment) {
          results.push({
            tool: action.type,
            ok: false,
            message: spreadsheetAttachments.length === 0
              ? '没有可提取图片的表格附件。请先上传 .xlsx 文件。'
              : '有多个表格附件，请指定要提取图片的 attachmentId。',
          });
          continue;
        }

        const maxImages = Math.max(1, Math.min(80, Math.floor(action.maxImages || 30)));
        const extractedImages = (targetAttachment.spreadsheetImages || []).slice(0, maxImages);
        const detail = {
          fileName: targetAttachment.name,
          totalImages: targetAttachment.spreadsheetImages?.length || 0,
          returnedImages: extractedImages.length,
          images: extractedImages.map((image) => ({
            id: image.id,
            sheetName: image.sheetName,
            rowNumber: image.rowNumber,
            columnNumber: image.columnNumber,
            mime: image.mime,
            mediaPath: image.mediaPath,
            name: image.name,
          })),
        };

        results.push({
          tool: action.type,
          ok: extractedImages.length > 0,
          message: extractedImages.length > 0
            ? `表格图片提取结果：\n${JSON.stringify(detail, null, 2)}`
            : `没有从「${targetAttachment.name}」里提取到可用图片。`,
        });
        continue;
      }

      if (action.type === 'attach_file_to_canvas') {
        const requestedIds = [
          ...(action.attachmentIds || []),
          ...(action.attachmentId ? [action.attachmentId] : []),
        ].filter(Boolean);
        const requestedSpreadsheetImageIds = new Set(action.spreadsheetImageIds || []);
        const selectedAttachments = requestedIds.length > 0
          ? attachments.filter((attachment) => requestedIds.includes(attachment.id))
          : (requestedSpreadsheetImageIds.size > 0
            ? attachments.filter((attachment) => (
              (attachment.spreadsheetImages || []).some((image) => requestedSpreadsheetImageIds.has(image.id))
            ))
            : (attachments.length === 1 ? attachments : []));
        const connectTargetId = resolveNodeId(action.targetId || action.nodeId);

        if (selectedAttachments.length === 0) {
          results.push({
            tool: action.type,
            ok: false,
            message: attachments.length === 0
              ? '还没有选择附件。请先点击输入框旁边的回形针选择文件。'
              : '没有找到指定附件，请重新选择文件。',
          });
          continue;
        }

        const baseNode = connectTargetId
          ? getFreshNodes().find((node) => node.id === connectTargetId)
          : null;
        const basePosition = {
          x: Number(action.position?.x ?? ((baseNode?.position?.x ?? 120) - 360)),
          y: Number(action.position?.y ?? (baseNode?.position?.y ?? 120)),
        };
        const allImages = selectedAttachments.every((attachment) => attachment.kind === 'image');
        const createdIds: string[] = [];
        let importedSpreadsheetImageCount = 0;

        if (selectedAttachments.length > 1 && allImages) {
          const newNodeId = addNode(NodeType.MULTI_IMAGE_UPLOAD, basePosition);
          createdIds.push(newNodeId);
          updateNodeData(newNodeId, {
            label: `多图上传 (${selectedAttachments.length})`,
            output: selectedAttachments.map((attachment) => attachment.payload.data || attachment.payload.url).filter(Boolean),
            status: 'success',
          });
          if (connectTargetId) connectToTarget(newNodeId, connectTargetId, action.sourceHandle, action.targetHandle);
        } else {
          selectedAttachments.forEach((attachment, index) => {
            if (attachment.kind === 'xlsx' && attachment.spreadsheetImages?.length) {
              const targetType = connectTargetId ? getNodeType(connectTargetId) : undefined;
              const selectedSpreadsheetImages = requestedSpreadsheetImageIds.size > 0
                ? attachment.spreadsheetImages.filter((image) => requestedSpreadsheetImageIds.has(image.id))
                : attachment.spreadsheetImages;
              const shouldCreateFileNode = requestedSpreadsheetImageIds.size === 0 || targetType === NodeType.TABLE_PARSE;
              let fileNodeId: string | null = null;
              let imageNodeId: string | null = null;

              if (requestedSpreadsheetImageIds.size > 0 && selectedSpreadsheetImages.length === 0) {
                return;
              }

              if (shouldCreateFileNode) {
                fileNodeId = addNode(NodeType.FILE_UPLOAD, {
                  x: basePosition.x,
                  y: basePosition.y + index * 300,
                });
                createdIds.push(fileNodeId);
                updateNodeData(fileNodeId, {
                  label: attachment.name,
                  output: attachment.payload,
                  status: 'success',
                });
              }

              if (selectedSpreadsheetImages.length > 0) {
                importedSpreadsheetImageCount += selectedSpreadsheetImages.length;
                const imageNodeType = selectedSpreadsheetImages.length === 1 ? NodeType.IMAGE_UPLOAD : NodeType.MULTI_IMAGE_UPLOAD;
                imageNodeId = addNode(imageNodeType, {
                  x: basePosition.x,
                  y: basePosition.y + index * 300 + (fileNodeId ? 240 : 0),
                });
                createdIds.push(imageNodeId);
                updateNodeData(imageNodeId, {
                  label: requestedSpreadsheetImageIds.size > 0
                    ? `${attachment.name} 选中表内图片 (${selectedSpreadsheetImages.length})`
                    : `${attachment.name} 表内图片`,
                  output: imageNodeType === NodeType.IMAGE_UPLOAD
                    ? selectedSpreadsheetImages[0]?.dataUrl
                    : selectedSpreadsheetImages.map((image) => image.dataUrl),
                  status: 'success',
                  meta: {
                    spreadsheetImageMap: selectedSpreadsheetImages.map((image) => ({
                      id: image.id,
                      sheetName: image.sheetName,
                      rowNumber: image.rowNumber,
                      columnNumber: image.columnNumber,
                      mediaPath: image.mediaPath,
                    })),
                  },
                });
              }

              if (connectTargetId) {
                const xlsxSourceId = targetType === NodeType.TABLE_PARSE ? fileNodeId : imageNodeId || fileNodeId;
                if (xlsxSourceId) connectToTarget(xlsxSourceId, connectTargetId, action.sourceHandle, action.targetHandle);
              }
              return;
            }

            const nodeType = attachment.kind === 'image' ? NodeType.IMAGE_UPLOAD : NodeType.FILE_UPLOAD;
            const newNodeId = addNode(nodeType, {
              x: basePosition.x,
              y: basePosition.y + index * 240,
            });
            createdIds.push(newNodeId);
            updateNodeData(newNodeId, {
              label: attachment.name,
              output: attachment.kind === 'image'
                ? (attachment.payload.data || attachment.payload.url || '')
                : attachment.payload,
              status: 'success',
            });
            if (connectTargetId) connectToTarget(newNodeId, connectTargetId, action.sourceHandle, action.targetHandle);
          });
        }

        if (createdIds.length === 0 && requestedSpreadsheetImageIds.size > 0) {
          results.push({
            tool: action.type,
            ok: false,
            message: '没有找到指定的表格图片 id，请先提取表格图片并使用返回的 image id。',
          });
          continue;
        }

        results.push({
          tool: action.type,
          ok: true,
          nodeIds: createdIds,
          message: `已把 ${selectedAttachments.length} 个附件放到画布：${selectedAttachments.map((attachment) => attachment.name).join('、')}。${importedSpreadsheetImageCount > 0 ? `已导入表内图片 ${importedSpreadsheetImageCount} 张。` : ''}`,
        });
        continue;
      }

      if (action.type === 'connect_nodes') {
        const sourceId = resolveNodeId(action.sourceId);
        const targetId = resolveNodeId(action.targetId || action.nodeId);
        if (!sourceId || !targetId) {
          results.push({ tool: action.type, ok: false, message: '连线失败：没有找到源节点或目标节点。' });
          continue;
        }
        connectToTarget(sourceId, targetId, action.sourceHandle, action.targetHandle);
        results.push({
          tool: action.type,
          ok: true,
          nodeIds: [sourceId, targetId],
          message: `已连接「${nodeLabel(sourceId)}」到「${nodeLabel(targetId)}」。`,
        });
        continue;
      }

      if (action.type === 'run_selected') {
        const targetId = resolveNodeId('selected');
        if (!targetId) {
          results.push({ tool: action.type, ok: false, message: '没有选中可运行节点。' });
          continue;
        }
        let upstreamRan: string[] = [];
        try {
          upstreamRan = await executeNodeWithUpstream(targetId);
          await executeSingleNode(targetId);
        } catch (error: any) {
          results.push({ tool: action.type, ok: false, message: error?.message || '运行节点失败。' });
          continue;
        }
        if (stopRequestedRef.current) {
          results.push({ tool: action.type, ok: false, message: '已暂停，选中节点执行已停止。' });
          continue;
        }
        results.push({
          tool: action.type,
          ok: true,
          nodeId: targetId,
          message: `${upstreamRan.length > 0 ? `已先运行上游：${Array.from(new Set(upstreamRan)).join('、')}。\n` : ''}已运行选中节点「${nodeLabel(targetId)}」。`,
        });
        continue;
      }

      if (action.type === 'run_node') {
        const targetId = resolveNodeId(action.nodeId);
        if (!targetId) {
          results.push({ tool: action.type, ok: false, message: '没有找到要运行的节点。' });
          continue;
        }
        let upstreamRan: string[] = [];
        try {
          upstreamRan = await executeNodeWithUpstream(targetId);
          await executeSingleNode(targetId);
        } catch (error: any) {
          results.push({ tool: action.type, ok: false, message: error?.message || '运行节点失败。' });
          continue;
        }
        if (stopRequestedRef.current) {
          results.push({ tool: action.type, ok: false, message: '已暂停，节点执行已停止。' });
          continue;
        }
        results.push({
          tool: action.type,
          ok: true,
          nodeId: targetId,
          message: `${upstreamRan.length > 0 ? `已先运行上游：${Array.from(new Set(upstreamRan)).join('、')}。\n` : ''}已运行「${nodeLabel(targetId)}」。`,
        });
        continue;
      }

      if (action.type === 'run_all_image_nodes') {
        const imageNodes = getFreshNodes().filter((node) => node.data?.type === NodeType.AI_IMAGE);
        const upstreamRanAll: string[] = [];
        for (const node of imageNodes) {
          if (stopRequestedRef.current) break;
          try {
            upstreamRanAll.push(...await executeNodeWithUpstream(node.id));
            await executeSingleNode(node.id);
          } catch (error: any) {
            results.push({ tool: action.type, ok: false, message: error?.message || `运行「${nodeLabel(node.id)}」失败。` });
          }
        }
        if (stopRequestedRef.current) {
          results.push({ tool: action.type, ok: false, message: '已暂停，剩余图像节点没有继续运行。' });
          continue;
        }
        results.push({
          tool: action.type,
          ok: true,
          nodeIds: imageNodes.map((node) => node.id),
          message: `${upstreamRanAll.length > 0 ? `已先运行上游：${Array.from(new Set(upstreamRanAll)).join('、')}。\n` : ''}已运行 ${imageNodes.length} 个图像节点。`,
        });
      }
    }

    if (results.some((result) => result.ok)) {
      pushNotice('success', '画布动作已执行');
    }
    return results;
  }, [addNode, attachments, executeSingleNode, onConnect, pushNotice, selectedNodeId, updateNodeData]);

  const shouldConfirmActions = useCallback((actions: CanvasAgentAction[], parsed: any, userText: string) => {
    if (parsed?.needsConfirmation === true || parsed?.needs_confirmation === true) return true;
    if (actions.some((action) => action.requiresConfirmation)) return true;
    const writeActions = actions.filter((action) => (
      action.type === 'create_node'
      || action.type === 'update_node_config'
      || action.type === 'attach_file_to_canvas'
      || action.type === 'connect_nodes'
    ));
    const runActions = actions.filter((action) => (
      action.type === 'run_node'
      || action.type === 'run_selected'
      || action.type === 'run_all_image_nodes'
    ));
    if (actions.some((action) => action.type === 'run_all_image_nodes') && !(wantsRun(userText) && wantsMany(userText))) return true;
    if (actions.filter((action) => action.type === 'create_node').length > 3) return true;
    if (writeActions.length > 4) return true;
    if (runActions.length > 1) return true;
    if (runActions.length > 0 && writeActions.length > 0) return true;
    if (actions.some((action) => action.type === 'attach_file_to_canvas' && (
      (action.attachmentIds?.length || 0) > 1
      || (!action.attachmentId && !action.attachmentIds?.length && attachments.length > 1)
    ))) return true;
    if (actions.some((action) => {
      if (action.type !== 'run_node') return false;
      const targetId = action.nodeId === 'selected'
        ? useStore.getState().selectedNodeId
        : action.nodeId;
      const node = targetId ? useStore.getState().nodes.find((item) => item.id === targetId) : null;
      return node?.data?.type === NodeType.BATCH_EXECUTE;
    })) return true;
    if (actions.some((action) => {
      const range = action.config
        ? Number(action.config.endIndex || 0) - Number(action.config.startIndex || 1) + 1
        : 0;
      return range > 5;
    })) return true;
    return false;
  }, [attachments.length]);

  const callAgentModel = useCallback(async (params: {
    userText: string;
    conversation: AgentMessage[];
    toolResults: CanvasToolResult[];
    step: number;
  }) => {
    if (!activeProvider?.apiKey || !activeProvider?.baseUrl || !chatModelId) {
      throw new Error('现在没有可用的对话模型。请先在模型枢纽选择可用对话模型和 API 配置。');
    }

    const attachmentImages = attachments
      .flatMap((attachment) => {
        if (attachment.kind === 'image') return [attachment.payload.data || attachment.payload.url];
        return (attachment.spreadsheetImages || []).map((image) => image.dataUrl);
      })
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(0, 8);
    const service = new AIService();
    const controller = new AbortController();
    agentAbortControllerRef.current = controller;
    let response: any;
    try {
      response = await service.executeNode(
        `canvas-agent-${Date.now()}-${params.step}`,
        NodeType.AI_CHAT,
        {
          modelId: chatModelId,
          systemInstruction: buildAgentSystemPrompt(),
        },
      {
        prompt: buildAgentPayload({
          userMessage: params.userText,
          messages: params.conversation,
          canvasState,
          attachments,
          toolResults: params.toolResults,
          step: params.step,
        }),
        ...(attachmentImages.length > 0 ? { image: attachmentImages } : {}),
      },
        {
          providerName: activeProvider.name,
          apiKey: activeProvider.apiKey,
          baseUrl: activeProvider.baseUrl,
          chatProtocol: activeProvider.chatProtocol,
          reasoningProtocol: activeProvider.reasoningProtocol,
          imageProtocol: activeProvider.imageProtocol,
        },
        { signal: controller.signal }
      );
    } finally {
      if (agentAbortControllerRef.current === controller) {
        agentAbortControllerRef.current = null;
      }
    }

    const rawOutput = String(response.output || '').trim();
    try {
      return extractJsonObject(rawOutput);
    } catch {
      return {
        reply: rawOutput || '模型没有返回有效内容。',
        actions: [],
      };
    }
  }, [activeProvider, attachments, canvasState, chatModelId]);

  const runAgentLoop = useCallback(async (
    userText: string,
    conversation: AgentMessage[],
    seedResults: CanvasToolResult[] = []
  ) => {
    let toolResults = [...seedResults];

    for (let step = seedResults.length > 0 ? 2 : 1; step <= MAX_AGENT_STEPS; step += 1) {
      if (stopRequestedRef.current) return;
      const parsed = await callAgentModel({
        userText,
        conversation,
        toolResults,
        step,
      });
      const reply = String(parsed?.reply || '').trim();
      const actions = normalizeCanvasActions(parsed);

      if (stopRequestedRef.current) return;

      if (reply) {
        appendMessage({ role: 'assistant', content: reply });
      }

      if (actions.length === 0) {
        return;
      }

      if (shouldConfirmActions(actions, parsed, userText)) {
        setPendingRequest({
          actions,
          reason: String(parsed?.reason || actions.find((action) => action.reason)?.reason || `将执行 ${actions.length} 个画布动作。`),
          userText,
          conversation,
          previousResults: toolResults,
        });
        appendMessage({ role: 'assistant', content: '这些动作需要确认。回复“执行”或点击确认按钮后我再动手。' });
        return;
      }

      const stepResults = await executeCanvasActions(actions);
      if (stopRequestedRef.current) return;
      toolResults = [...toolResults, ...stepResults];
      appendMessage({
        role: 'assistant',
        content: summarizeToolResultsForUser(stepResults),
      });
    }

    appendMessage({ role: 'assistant', content: '我已经完成最多 4 轮画布工具调用，先停在这里避免误操作。' });
  }, [appendMessage, callAgentModel, executeCanvasActions, shouldConfirmActions]);

  const confirmPendingActions = useCallback(async () => {
    if (!pendingRequest || isThinking) return;
    stopRequestedRef.current = false;
    setIsThinking(true);
    try {
      const stepResults = await executeCanvasActions(pendingRequest.actions);
      setPendingRequest(null);
      appendMessage({
        role: 'assistant',
        content: summarizeToolResultsForUser(stepResults),
      });
      await runAgentLoop(
        pendingRequest.userText,
        pendingRequest.conversation,
        [...pendingRequest.previousResults, ...stepResults]
      );
    } catch (error: any) {
      if (stopRequestedRef.current) {
        appendMessage({ role: 'assistant', content: '已暂停。' });
      } else {
        appendMessage({ role: 'assistant', content: `画布动作执行失败：${error?.message || error}` });
        pushNotice('error', '画布动作执行失败');
      }
    } finally {
      setIsThinking(false);
    }
  }, [appendMessage, executeCanvasActions, isThinking, pendingRequest, pushNotice, runAgentLoop]);

  const sendMessage = useCallback(async (raw?: string) => {
    const text = String(raw ?? input).trim();
    if (!text || isThinking) return;

    stopRequestedRef.current = false;
    setInput('');
    const userMessage = appendMessage({ role: 'user', content: text });
    const conversation = [...messages, userMessage];
    setIsThinking(true);

    try {
      if (pendingRequest && confirmsPendingAction(text)) {
        const stepResults = await executeCanvasActions(pendingRequest.actions);
        setPendingRequest(null);
        appendMessage({
          role: 'assistant',
          content: summarizeToolResultsForUser(stepResults),
        });
        await runAgentLoop(
          pendingRequest.userText,
          pendingRequest.conversation,
          [...pendingRequest.previousResults, ...stepResults]
        );
        return;
      }

      if (pendingRequest) {
        setPendingRequest(null);
      }

      await runAgentLoop(text, conversation);
    } catch (error: any) {
      if (stopRequestedRef.current) {
        appendMessage({ role: 'assistant', content: '已暂停。' });
      } else {
        appendMessage({ role: 'assistant', content: `画布智能体调用失败：${error?.message || error}` });
        pushNotice('error', '画布智能体调用失败');
      }
    } finally {
      setIsThinking(false);
    }
  }, [
    appendMessage,
    executeCanvasActions,
    input,
    isThinking,
    messages,
    pendingRequest,
    pushNotice,
    runAgentLoop,
  ]);

  const hasModelConfig = Boolean(activeProvider?.apiKey && activeProvider?.baseUrl && chatModelId);
  const agentStatus = isThinking || isWorkflowRunning
    ? '运行中'
    : pendingRequest
      ? '等待确认'
      : hasModelConfig
        ? '就绪'
        : '待配置';
  const agentStatusClass = isThinking || isWorkflowRunning
    ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100'
    : pendingRequest
      ? 'border-amber-400/25 bg-amber-400/10 text-amber-100'
      : hasModelConfig
        ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
        : 'border-rose-400/25 bg-rose-400/10 text-rose-100';
  const selectedFacts = selectedNode
    ? [
      selectedNode.data.config?.modelId || '未设模型',
      selectedNode.data.config?.aspectRatio || '未设比例',
      selectedNode.data.config?.imageSize || '未设尺寸',
    ]
    : ['未选中节点'];
  const quickPrompts = [
    selectedNode ? '解释当前选中节点和它的上下游' : '解释当前画布结构',
    selectedNode ? '把选中节点改成 46:19、2K、中等质量' : '创建一个新的图像生成节点',
    attachments.length > 0 ? '先读取附件并整理可执行任务' : '搭一个表格批量生图流程',
  ];
  const showQuickPrompts = messages.length <= 1 && !pendingRequest && !isThinking;

  if (!isOpen) return null;

  return (
    <aside className="absolute right-4 top-16 bottom-16 z-30 flex w-[540px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border theme-border-subtle theme-bg-overlay theme-shadow-panel backdrop-blur-xl">
      <div className="flex items-center justify-between border-b theme-border-subtle theme-bg-secondary px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border theme-border-subtle theme-bg-tertiary text-cyan-500">
            <Bot size={17} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[13px] font-semibold theme-text-primary">画布智能体</h2>
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${agentStatusClass}`}>
                {agentStatus}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10px] theme-text-muted">
              {selectedNode ? selectedNode.data.label : '当前没有选中节点'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 1 && (
            <button
              type="button"
              onClick={() => setMessages((prev) => prev.slice(0, 1))}
              className="rounded-lg p-2 theme-text-muted transition hover:theme-bg-tertiary hover:theme-text-primary"
              title="清空对话"
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 theme-text-muted transition hover:theme-bg-tertiary hover:theme-text-primary"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="border-b theme-border-subtle px-4 py-2.5">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="shrink-0 rounded-md border theme-border-subtle theme-bg-tertiary px-2 py-1 text-[10px] font-semibold theme-text-primary">
            {selectedNode ? selectedNode.data.type : 'NO SELECTION'}
          </span>
          {selectedFacts.map((fact, index) => (
            <span key={`${fact}-${index}`} className="min-w-0 truncate rounded-md theme-bg-secondary px-2 py-1 text-[10px] theme-text-muted">
              {fact}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 scrollbar-hide">
        {!hasModelConfig && (
          <div className="mb-4 flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.08] p-3 text-[11px] leading-relaxed text-amber-100">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>缺少对话模型或 API 配置。配置好后，智能体才能把自然语言转成画布工具调用。</span>
          </div>
        )}

        <div className="space-y-5">
          {messages.map((message) => {
            const isUser = message.role === 'user';
            return (
              <article key={message.id} className="flex gap-3">
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                  isUser
                    ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100'
                    : 'border-white/10 bg-white/[0.04] theme-text-primary'
                }`}>
                  {isUser ? <MessageSquare size={14} /> : <Bot size={14} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[11px] font-semibold theme-text-primary">{isUser ? '你' : 'Canvas Agent'}</span>
                    {!isUser && <span className="text-[9px] theme-text-muted">workspace</span>}
                  </div>
                  <div className={`rounded-lg border px-3.5 py-3 ${
                    isUser
                      ? 'border-cyan-300/15 bg-cyan-300/[0.08]'
                      : 'border-white/10 bg-white/[0.035]'
                  }`}>
                    {renderMessage(message.content)}
                  </div>
                </div>
              </article>
            );
          })}

          {pendingRequest && (
            <section className="ml-10 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Check size={14} className="text-amber-200" />
                    <p className="text-[12px] font-semibold text-amber-100">等待你确认</p>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed theme-text-primary">
                    {pendingRequest.reason || `将执行 ${pendingRequest.actions.length} 个画布动作。`}
                  </p>
                </div>
                <span className="shrink-0 rounded-md bg-black/20 px-2 py-1 text-[9px] font-semibold text-amber-100">
                  {pendingRequest.actions.length} actions
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                {pendingRequest.actions.map((action, index) => {
                  const Icon = actionIcon(action.type);
                  return (
                    <div key={`${action.type}-${index}`} className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2 text-[10px] theme-text-primary">
                      <Icon size={13} className="shrink-0 text-amber-200" />
                      <span className="min-w-0 truncate">{summarizeAction(action)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void confirmPendingActions()}
                  disabled={isThinking}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-300 px-3 py-2 text-[11px] font-semibold text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check size={13} />
                  确认执行
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRequest(null)}
                  disabled={isThinking}
                  className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-[11px] font-semibold theme-text-primary transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  取消
                </button>
              </div>
            </section>
          )}

          {isThinking && (
            <div className="ml-10 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.06] px-3.5 py-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-cyan-100">
                <Loader2 size={14} className="animate-spin" />
                正在推理并调用画布工具
              </div>
              <div className="mt-2 space-y-1">
                {['理解指令', '检查画布状态', '准备工具动作'].map((label, index) => (
                  <div key={label} className="flex items-center gap-2 text-[10px] theme-text-muted">
                    <Wrench size={11} className={index === 0 ? 'text-cyan-300' : 'theme-text-muted'} />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t theme-border-subtle theme-bg-primary p-3.5">
        {showQuickPrompts && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void sendMessage(prompt)}
                disabled={isThinking}
                className="rounded-md border border-white/10 bg-white/[0.035] px-2.5 py-1.5 text-[10px] theme-text-primary transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.06] hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto pr-1">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex max-w-full items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.035] px-2 py-1.5 text-[10px] theme-text-primary"
                title={attachment.name}
              >
                {attachment.kind === 'xlsx' ? <FileText size={12} className="shrink-0 text-emerald-300" /> : <FileUp size={12} className="shrink-0 text-cyan-300" />}
                <span className="shrink-0 theme-text-muted">{getAttachmentKindLabel(attachment.kind)}</span>
                <span className="max-w-[230px] truncate">{attachment.name}</span>
                <span className="shrink-0 theme-text-muted">{formatFileSize(attachment.size)}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  className="shrink-0 rounded p-0.5 theme-text-muted transition hover:bg-white/10 hover:text-rose-300"
                  title="移除附件"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border theme-border-subtle theme-bg-secondary p-2 theme-shadow-soft focus-within:border-cyan-300/35">
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            onChange={(event) => void handleAttachmentChange(event)}
            className="hidden"
          />
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={handleComposerPaste}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void sendMessage();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setInput('');
              }
            }}
            rows={2}
            placeholder="让智能体读取、改画布、连节点或运行流程..."
            className="max-h-32 min-h-14 w-full resize-none bg-transparent px-2 py-1.5 text-[12px] leading-relaxed theme-text-primary outline-none theme-placeholder-muted"
          />
          <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={isThinking || isReadingFiles}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md theme-text-secondary transition hover:bg-white/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="添加附件"
              >
                {isReadingFiles ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
              </button>
              <span className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] theme-text-muted">
                {nodes.length} 节点 · {edges.length} 连线
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {(isThinking || isWorkflowRunning) && (
                <button
                  type="button"
                  onClick={() => pauseAll(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-rose-500 px-3 text-[11px] font-semibold text-white transition hover:bg-rose-400"
                  title="暂停"
                >
                  <Square size={13} />
                  停止
                </button>
              )}
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={isThinking || isWorkflowRunning || !input.trim()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-cyan-300 px-3 text-[11px] font-semibold text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45"
                title="发送"
              >
                <Send size={13} />
                发送
                <CornerDownLeft size={12} className="opacity-60" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
