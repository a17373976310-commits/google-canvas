
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { NodeData } from '../types';
import { BaseNode } from './BaseNode';
import { Cpu } from 'lucide-react';

export const GeminiNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  return (
    <BaseNode id={id} data={data} icon={Cpu} color="bg-indigo-500" selected={selected}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-indigo-500 !border-2 theme-handle-border" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-indigo-500 !border-2 theme-handle-border" />

      <div className="space-y-3 flex-1 flex flex-col">
        <div className="flex items-center justify-between shrink-0">
          <span className="text-[10px] font-bold theme-text-muted uppercase">处理模式</span>
          <span className="text-[10px] font-mono text-indigo-400 bg-indigo-400/10 px-2 py-0.5 rounded">GEMINI-3-FLASH</span>
        </div>

        {data.output ? (
          <div className="p-3 theme-bg-input rounded-xl border theme-border-medium flex-1 overflow-y-auto text-[11px] leading-relaxed theme-text-primary scrollbar-hide font-serif whitespace-pre-wrap">
            {data.output}
          </div>
        ) : (
          <div className="border border-dashed theme-border-medium rounded-xl flex-1 flex items-center justify-center italic theme-text-muted text-[10px]">
            等待输入内容...
          </div>
        )}
      </div>
    </BaseNode>
  );
};
