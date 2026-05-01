
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { NodeData } from '../../types';
import { useStore } from '../../store';
import { BaseNode } from '../BaseNode';
import { MessageSquare, Type, ImageIcon, Palette } from 'lucide-react';

export const ChatNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const updateNodeData = useStore((state) => state.updateNodeData);
    const hasPromptEdge = useStore((state) => state.edges.some((edge) => edge.target === id && edge.targetHandle === 'prompt'));
    const hasImageEdge = useStore((state) => state.edges.some((edge) => edge.target === id && edge.targetHandle === 'image'));
    const hasStyleEdge = useStore((state) => state.edges.some((edge) => edge.target === id && edge.targetHandle === 'style'));

    // Check if inputs are connected (based on store's inputs record)
    const isPromptConnected = hasPromptEdge;
    const isImageConnected = hasImageEdge;
    const isStyleConnected = hasStyleEdge;

    return (
        <BaseNode id={id} data={data} icon={MessageSquare} color="bg-indigo-500" selected={selected}>
            {/* Target Sockets - Structured Rows */}
            <div className="flex flex-col py-2">
                {/* Prompt Row */}
                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="prompt"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${isPromptConnected ? '!bg-blue-500' : '!bg-[#2a2a3a] group-hover/row:!bg-blue-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <Type size={10} className="text-blue-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">文本提示词 (Prompt)</span>
                    </div>
                    {isPromptConnected && (
                        <div className="ml-auto animate-pulse">
                            <span className="text-[7px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20 font-black uppercase">已串联</span>
                        </div>
                    )}
                </div>

                {/* Vision Row */}
                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="image"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${isImageConnected ? '!bg-orange-500' : '!bg-[#2a2a3a] group-hover/row:!bg-orange-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <ImageIcon size={10} className="text-orange-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">视觉参考 (Vision)</span>
                    </div>
                    {isImageConnected && (
                        <div className="ml-auto animate-pulse">
                            <span className="text-[7px] bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded border border-orange-500/20 font-black uppercase">已激活</span>
                        </div>
                    )}
                </div>

                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="style"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${isStyleConnected ? '!bg-violet-500' : '!bg-[#2a2a3a] group-hover/row:!bg-violet-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <Palette size={10} className="text-violet-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">风格约束 (Style)</span>
                    </div>
                    {isStyleConnected && (
                        <div className="ml-auto animate-pulse">
                            <span className="text-[7px] bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded border border-violet-500/20 font-black uppercase">已连接</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Internal Widgets (Disabled if connected) */}
            <div className="px-4 pb-4 space-y-3">
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="text-[8px] font-black text-gray-500 uppercase tracking-[0.1em]">
                            {isPromptConnected ? '外部输入内容 (只读)' : '手动输入提示词 (组件)'}
                        </label>
                        <span className="text-[9px] font-mono text-indigo-400 bg-indigo-400/5 px-1.5 py-0.5 rounded border border-indigo-400/10 italic">
                            {data.config.modelId || 'gpt-4o'}
                        </span>
                    </div>

                    <textarea
                        className={`w-full bg-[#0b0b0f] border rounded-xl p-3 text-[11px] leading-relaxed transition-all h-24 resize-none shadow-inner outline-none ${isPromptConnected
                            ? 'border-blue-500/20 text-blue-400/50 italic bg-blue-500/[0.02] cursor-not-allowed'
                            : 'border-[#2a2a3a] text-gray-300 focus:border-indigo-500/50'
                            }`}
                        placeholder={isPromptConnected ? "当前正在接收外部串联数据..." : "在此输入指令，插槽连线后将自动失效..."}
                        value={isPromptConnected ? (data.inputs?.prompt || '') : (data.config.prompt || '')}
                        disabled={isPromptConnected}
                        onChange={(e) => updateNodeData(id, { config: { ...data.config, prompt: e.target.value } })}
                    />
                </div>

                {/* Output Area */}
                {data.output && (
                    <div className="p-3 bg-indigo-500/[0.03] rounded-xl border border-indigo-500/10 text-[10px] text-gray-400 whitespace-pre-wrap font-serif leading-relaxed animate-in fade-in duration-500">
                        {data.output}
                    </div>
                )}
            </div>

            {/* Source Socket */}
            <div className="absolute -right-[3px] top-1/2 -translate-y-1/2 group/out">
                <Handle
                    type="source"
                    position={Position.Right}
                    className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-[#0b0b0f] !static translate-y-0"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-black text-indigo-400 uppercase tracking-widest opacity-0 group-hover/out:opacity-100 transition-opacity whitespace-nowrap bg-[#0b0b0f] px-1 rounded pointer-events-none">结果输出</span>
            </div>
        </BaseNode>
    );
};
