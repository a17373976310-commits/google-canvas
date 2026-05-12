import React from 'react';
import { NodeProps } from 'reactflow';
import { FileText } from 'lucide-react';
import { NodeData } from '../../types';
import { useStore } from '../../store';
import { BaseNode } from '../BaseNode';

export const InputNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const updateNodeData = useStore((state) => state.updateNodeData);

  return (
    <BaseNode id={id} data={data} icon={FileText} color="bg-blue-500" selected={selected}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold theme-text-muted">文本内容</span>
          <span className="rounded-md border border-blue-500/15 bg-blue-500/10 px-2 py-0.5 text-[9px] font-semibold text-blue-300">
            输出到右侧
          </span>
        </div>
        <textarea
          className="min-h-0 flex-1 resize-none rounded-xl border theme-border-medium theme-bg-input p-3 text-[11px] leading-relaxed theme-text-primary shadow-inner outline-none transition-all focus:border-blue-500/50"
          placeholder="在此输入您的内容..."
          value={data.config.prompt || ''}
          onChange={(event) => updateNodeData(id, { config: { ...data.config, prompt: event.target.value } })}
        />
      </div>
    </BaseNode>
  );
};
