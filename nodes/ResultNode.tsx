
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { NodeData } from '../types';
import { BaseNode } from './BaseNode';
import { Play, Rocket, Sparkles } from 'lucide-react';

export const ResultNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  return (
    <BaseNode id={id} data={data} icon={Play} color="bg-emerald-500" selected={selected}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-[#0b0b0f]" />

      {data.output ? (
        <div className="space-y-4 flex-1 flex flex-col justify-center">
          <div className="p-6 bg-emerald-500/10 rounded-2xl border border-emerald-500/30 text-emerald-400 font-black text-center flex flex-col items-center gap-3 animate-in zoom-in-95 duration-500">
            <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              <Rocket size={24} className="animate-bounce" />
            </div>
            <div className="space-y-1">
              <span className="block text-[11px] tracking-[0.2em]">任务已完成</span>
              <span className="block text-xs opacity-70">生成结果已就绪</span>
            </div>
          </div>
          <button className="w-full py-3 px-4 bg-[#161621] hover:bg-[#1c1c2b] border border-[#2a2a3a] rounded-xl text-[10px] font-bold text-gray-400 flex items-center justify-center gap-2 transition-all">
            <Sparkles size={14} />
            查看生成结果
          </button>
        </div>
      ) : (
        <div className="flex-1 bg-[#0b0b0f] rounded-xl border border-dashed border-[#2a2a3a] flex flex-col items-center justify-center gap-2 opacity-40">
          <Play size={24} className="text-gray-800" />
          <p className="text-[10px] text-gray-700 font-bold uppercase text-center max-w-[120px]">
            工作流的最终输出节点
          </p>
        </div>
      )}
    </BaseNode>
  );
};
