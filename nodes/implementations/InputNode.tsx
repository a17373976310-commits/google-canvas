
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { NodeData } from '../../types';
import { useStore } from '../../store';
import { BaseNode } from '../BaseNode';
import { FileText } from 'lucide-react';

export const InputNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const updateNodeData = useStore((state) => state.updateNodeData);
    return (
        <BaseNode id={id} data={data} icon={FileText} color="bg-blue-500" selected={selected}>
            <div className="p-4 space-y-2 flex-col">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] block mb-2">文本发射器 (Emitter)</label>
                <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                    <FileText size={10} className="text-blue-400" />
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">文本内容 (CONTENT)</span>
                </div>
                <textarea
                    className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl p-3 text-[11px] text-gray-300 focus:outline-none focus:border-blue-500 transition-all h-28 resize-none shadow-inner"
                    placeholder="在此输入您的内容..."
                    value={data.config.prompt || ''}
                    onChange={(e) => updateNodeData(id, { config: { ...data.config, prompt: e.target.value } })}
                />
            </div>

            {/* Typed Source Port */}
            <div className="absolute -right-[3px] top-1/2 -translate-y-1/2 group/out">
                <Handle
                    type="source"
                    position={Position.Right}
                    id="output"
                    className="!w-3 !h-3 !bg-blue-500 !border-2 !border-[#0b0b0f] !static translate-y-0"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-black text-blue-400 uppercase tracking-widest opacity-0 group-hover/out:opacity-100 transition-opacity whitespace-nowrap bg-[#0b0b0f] px-1 rounded pointer-events-none">文本流</span>
            </div>
        </BaseNode>
    );
};
