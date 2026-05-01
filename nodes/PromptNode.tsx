
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { NodeData } from '../types';
import { useStore } from '../store';
import { BaseNode } from './BaseNode';
import { FileText } from 'lucide-react';

export const PromptNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const updateNodeData = useStore((state) => state.updateNodeData);
  return (
    <BaseNode id={id} data={data} icon={FileText} color="bg-blue-500" selected={selected}>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-blue-500 !border-2 !border-[#0b0b0f]" />
      <div className="space-y-2 flex-1 flex flex-col">
        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">输入提示词</label>
        <textarea
          className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500 transition-all flex-1 resize-none placeholder:text-gray-700 shadow-inner"
          placeholder="在这里输入您的创意想法..."
          value={data.config.prompt || ''}
          onChange={(e) => updateNodeData(id, { config: { ...data.config, prompt: e.target.value } })}
        />
      </div>
    </BaseNode>
  );
};
