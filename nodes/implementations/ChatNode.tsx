import React from 'react';
import { NodeProps } from 'reactflow';
import { ImageIcon, MessageSquare, Palette, Type } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { NodeData } from '../../types';
import { useStore } from '../../store';
import { BaseNode } from '../BaseNode';

const stringifyInput = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const stripJsonFence = (value: string) => value
  .replace(/^```(?:json)?\s*/i, '')
  .replace(/\s*```$/i, '')
  .trim();

const tryParseJson = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(stripJsonFence(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const pickReadableField = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  const preferredKeys = [
    'prompt',
    'final_prompt',
    'stylePrompt',
    'style_prompt',
    'text',
    'content',
    'requirement',
    'requirementZh',
    'summary',
  ];

  for (const key of preferredKeys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  for (const candidate of Object.values(record)) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const nested = pickReadableField(candidate);
      if (nested) return nested;
    }
  }

  return '';
};

const buildInputPreview = (value: unknown) => {
  const full = stringifyInput(value).trim();
  if (!full) {
    return {
      kind: '空输入',
      meta: '0 字符',
      preview: '上游节点尚未提供可用内容。',
      full,
    };
  }

  const parsed = tryParseJson(full);
  const readable = parsed ? pickReadableField(parsed) : '';
  const compact = (readable || full).replace(/\s+/g, ' ');
  const fieldCount = parsed ? Object.keys(parsed).length : 0;

  return {
    kind: parsed ? '结构化提示词' : '文本提示词',
    meta: parsed
      ? `${fieldCount} 字段 · ${full.length.toLocaleString()} 字符`
      : `${full.length.toLocaleString()} 字符`,
    preview: compact.length > 150 ? `${compact.slice(0, 150)}...` : compact,
    full,
  };
};

export const ChatNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const updateNodeData = useStore((state) => state.updateNodeData);
  const edgeState = useStore(useShallow((state) => ({
    prompt: state.edges.some((edge) => edge.target === id && edge.targetHandle === 'prompt'),
    image: state.edges.some((edge) => edge.target === id && edge.targetHandle === 'image'),
    style: state.edges.some((edge) => edge.target === id && edge.targetHandle === 'style'),
  })));

  const promptValue = edgeState.prompt ? stringifyInput(data.inputs?.prompt) : String(data.config.prompt || '');
  const promptPreview = React.useMemo(() => buildInputPreview(data.inputs?.prompt), [data.inputs?.prompt]);
  const shouldShowPromptPreview = edgeState.prompt && promptPreview.full.length > 0;

  return (
    <BaseNode id={id} data={data} icon={MessageSquare} color="bg-indigo-500" selected={selected}>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
        <div className="flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${edgeState.prompt ? 'border-blue-500/25 bg-blue-500/10 text-blue-300' : 'theme-border-subtle theme-text-muted'}`}>
            <Type size={10} />
            文本
          </span>
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${edgeState.image ? 'border-orange-500/25 bg-orange-500/10 text-orange-300' : 'theme-border-subtle theme-text-muted'}`}>
            <ImageIcon size={10} />
            视觉
          </span>
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${edgeState.style ? 'border-violet-500/25 bg-violet-500/10 text-violet-300' : 'theme-border-subtle theme-text-muted'}`}>
            <Palette size={10} />
            风格
          </span>
        </div>

        {shouldShowPromptPreview ? (
          <div className="canvas-chat-prompt-preview" title={promptPreview.full}>
            <div className="canvas-chat-prompt-preview-head">
              <span>输入概览</span>
              <span>{promptPreview.kind} · {promptPreview.meta}</span>
            </div>
            <p>{promptPreview.preview}</p>
          </div>
        ) : !edgeState.prompt ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <label className="text-[10px] font-semibold theme-text-muted">手动提示词</label>
            <textarea
              className="min-h-[84px] flex-1 resize-none rounded-xl border p-3 text-[11px] leading-relaxed shadow-inner outline-none transition-all theme-border-medium theme-bg-input theme-text-primary focus:border-indigo-500/50"
              placeholder="输入对话指令，连线后会自动使用上游内容..."
              value={promptValue}
              onChange={(event) => updateNodeData(id, { config: { ...data.config, prompt: event.target.value } })}
            />
          </div>
        ) : null}

        {data.output && (
          <div className="max-h-28 overflow-y-auto rounded-xl border border-indigo-500/10 bg-indigo-500/[0.04] p-3 text-[10px] leading-relaxed theme-text-secondary custom-scrollbar">
            {String(data.output)}
          </div>
        )}
      </div>
    </BaseNode>
  );
};
