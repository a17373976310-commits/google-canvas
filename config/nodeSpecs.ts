import { NodeType } from '../types';

export type NodePortSide = 'left' | 'right' | 'top' | 'bottom';
export type NodePortKind = 'target' | 'source';
export type NodePortColor =
  | 'blue'
  | 'cyan'
  | 'emerald'
  | 'fuchsia'
  | 'indigo'
  | 'orange'
  | 'purple'
  | 'rose'
  | 'sky'
  | 'teal'
  | 'violet'
  | 'amber';

export interface NodeHandleSpec {
  id?: string;
  kind: NodePortKind;
  side: NodePortSide;
  label: string;
  color: NodePortColor;
}

export interface NodeSpec {
  type: NodeType;
  handles: NodeHandleSpec[];
}

const source = (id: string | undefined, label: string, color: NodePortColor): NodeHandleSpec => ({
  id,
  kind: 'source',
  side: 'right',
  label,
  color,
});

const target = (id: string | undefined, label: string, color: NodePortColor): NodeHandleSpec => ({
  id,
  kind: 'target',
  side: 'left',
  label,
  color,
});

export const NODE_SPECS: Record<NodeType, NodeSpec> = {
  [NodeType.INPUT]: {
    type: NodeType.INPUT,
    handles: [source('output', '文本流', 'blue')],
  },
  [NodeType.IMAGE_UPLOAD]: {
    type: NodeType.IMAGE_UPLOAD,
    handles: [source('output', '源图像', 'orange')],
  },
  [NodeType.MULTI_IMAGE_UPLOAD]: {
    type: NodeType.MULTI_IMAGE_UPLOAD,
    handles: [source('output', '批量图像', 'amber')],
  },
  [NodeType.FILE_UPLOAD]: {
    type: NodeType.FILE_UPLOAD,
    handles: [source('output', '文件数据', 'fuchsia')],
  },
  [NodeType.TABLE_PARSE]: {
    type: NodeType.TABLE_PARSE,
    handles: [
      target('file', '表格文件', 'fuchsia'),
      source('output', '任务数据', 'emerald'),
    ],
  },
  [NodeType.TASK_SELECT]: {
    type: NodeType.TASK_SELECT,
    handles: [
      target('tasks', '任务列表', 'emerald'),
      source('prompt', '提示词', 'blue'),
      source('image', '参考图', 'orange'),
      source('task', '任务对象', 'teal'),
    ],
  },
  [NodeType.BATCH_EXECUTE]: {
    type: NodeType.BATCH_EXECUTE,
    handles: [
      target('tasks', '任务列表', 'emerald'),
      source('batch', '生图模板', 'cyan'),
    ],
  },
  [NodeType.STYLE_GUIDE]: {
    type: NodeType.STYLE_GUIDE,
    handles: [
      target('task', '任务输入', 'emerald'),
      target('image', '风格参考', 'orange'),
      source('style', '风格约束', 'violet'),
      source('prompt', '提示词片段', 'fuchsia'),
    ],
  },
  [NodeType.PRODUCT_IMAGE_MATCH]: {
    type: NodeType.PRODUCT_IMAGE_MATCH,
    handles: [
      target('task', '任务对象', 'teal'),
      target('prompt', '提示词', 'blue'),
      target('image', '候选产品图', 'amber'),
      source('image', '已选图片', 'amber'),
      source('report', '匹配报告', 'sky'),
    ],
  },
  [NodeType.AI_CHAT]: {
    type: NodeType.AI_CHAT,
    handles: [
      target('prompt', '提示词', 'blue'),
      target('image', '视觉参考', 'orange'),
      target('style', '风格约束', 'violet'),
      source(undefined, '结果输出', 'indigo'),
    ],
  },
  [NodeType.AI_IMAGE]: {
    type: NodeType.AI_IMAGE,
    handles: [
      target('prompt', '提示词', 'blue'),
      target('image', '参考图', 'orange'),
      target('template', '任务映射', 'cyan'),
      target('batch', '批量模板', 'cyan'),
      source(undefined, '图像输出', 'purple'),
    ],
  },
  [NodeType.AI_AUDIO]: {
    type: NodeType.AI_AUDIO,
    handles: [
      target('prompt', '语音提示词', 'blue'),
      source(undefined, '音频输出', 'cyan'),
    ],
  },
  [NodeType.AI_VIDEO]: {
    type: NodeType.AI_VIDEO,
    handles: [
      target('prompt', '视频提示词', 'blue'),
      target('image', '首尾帧/参考图', 'orange'),
      source(undefined, '视频输出', 'rose'),
    ],
  },
  [NodeType.OUTPUT]: {
    type: NodeType.OUTPUT,
    handles: [target(undefined, '最终结果', 'emerald')],
  },
  [NodeType.GROUP]: {
    type: NodeType.GROUP,
    handles: [],
  },
};

export const getNodeSpec = (type?: NodeType | string | null): NodeSpec => {
  return NODE_SPECS[type as NodeType] || { type: NodeType.GROUP, handles: [] };
};

const isUploadNodeType = (type?: NodeType | string) => (
  type === NodeType.IMAGE_UPLOAD
  || type === NodeType.MULTI_IMAGE_UPLOAD
  || type === NodeType.FILE_UPLOAD
);

export const inferConnectionHandles = (
  sourceType?: NodeType | string,
  targetType?: NodeType | string
): { sourceHandle?: string | null; targetHandle?: string | null } => {
  let targetHandle: string | undefined;

  if (targetType === NodeType.TABLE_PARSE) targetHandle = 'file';
  else if (targetType === NodeType.TASK_SELECT || targetType === NodeType.BATCH_EXECUTE) targetHandle = 'tasks';
  else if (targetType === NodeType.STYLE_GUIDE) targetHandle = isUploadNodeType(sourceType) ? 'image' : 'task';
  else if (targetType === NodeType.PRODUCT_IMAGE_MATCH) {
    if (isUploadNodeType(sourceType) || sourceType === NodeType.AI_IMAGE) targetHandle = 'image';
    else if (sourceType === NodeType.INPUT || sourceType === NodeType.AI_CHAT || sourceType === NodeType.STYLE_GUIDE) targetHandle = 'prompt';
    else targetHandle = 'task';
  } else if (targetType === NodeType.AI_IMAGE) {
    if (isUploadNodeType(sourceType) || sourceType === NodeType.PRODUCT_IMAGE_MATCH || sourceType === NodeType.AI_IMAGE) targetHandle = 'image';
    else if (sourceType === NodeType.BATCH_EXECUTE) targetHandle = 'batch';
    else targetHandle = 'prompt';
  } else if (targetType === NodeType.AI_CHAT) {
    if (isUploadNodeType(sourceType) || sourceType === NodeType.AI_IMAGE || sourceType === NodeType.PRODUCT_IMAGE_MATCH) targetHandle = 'image';
    else if (sourceType === NodeType.STYLE_GUIDE) targetHandle = 'style';
    else targetHandle = 'prompt';
  } else if (targetType === NodeType.AI_VIDEO) {
    if (isUploadNodeType(sourceType) || sourceType === NodeType.AI_IMAGE) targetHandle = 'image';
    else targetHandle = 'prompt';
  } else if (targetType === NodeType.AI_AUDIO) {
    targetHandle = 'prompt';
  }

  let sourceHandle: string | undefined;
  if (sourceType === NodeType.TASK_SELECT) {
    sourceHandle = targetHandle === 'image' ? 'image' : targetHandle === 'task' ? 'task' : 'prompt';
  } else if (sourceType === NodeType.STYLE_GUIDE) {
    sourceHandle = targetHandle === 'style' ? 'style' : 'prompt';
  } else if (sourceType === NodeType.PRODUCT_IMAGE_MATCH) {
    sourceHandle = targetHandle === 'prompt' ? 'report' : 'image';
  } else if (sourceType === NodeType.BATCH_EXECUTE) {
    sourceHandle = 'batch';
  } else if (sourceType === NodeType.TABLE_PARSE || sourceType === NodeType.INPUT || isUploadNodeType(sourceType)) {
    sourceHandle = 'output';
  }

  return {
    sourceHandle: sourceHandle || null,
    targetHandle: targetHandle || null,
  };
};
