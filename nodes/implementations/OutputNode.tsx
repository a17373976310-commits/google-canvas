
import React, { useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { NodeData } from '../../types';
import { BaseNode } from '../BaseNode';
import { Play, Rocket, Sparkles, ChevronRight, ZoomIn } from 'lucide-react';
import { ImageLightbox } from '../../components/ImageLightbox';
import { useStore } from '../../store';

export const OutputNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const clearExecutionResults = useStore((state) => state.clearExecutionResults);

    // Detect if output is an image URL
    const isImageOutput = data.output && (
        typeof data.output === 'string' && (
            data.output.startsWith('http') && /\.(jpg|jpeg|png|gif|webp|svg)/i.test(data.output) ||
            data.output.startsWith('data:image') ||
            data.output.includes('blob:')
        )
    );

    return (
        <BaseNode id={id} data={data} icon={Play} color="bg-emerald-500" selected={selected}>
            {/* Target Sockets */}
            <div className="flex flex-col py-2">
                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        className="!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] !bg-emerald-500"
                    />
                    <div className="flex items-center gap-2 opacity-60">
                        <ChevronRight size={10} className="text-emerald-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">最终结果 (Result)</span>
                    </div>
                </div>
            </div>

            <div className="px-4 pb-4 flex-1 flex flex-col justify-center min-h-[140px]">
                {data.output ? (
                    <div className="space-y-4 animate-in zoom-in-95 duration-500">
                        {isImageOutput ? (
                            // Image Output Display
                            <div
                                className="group relative rounded-xl overflow-hidden border border-emerald-500/30 bg-[#0b0b0f] cursor-pointer"
                                style={{ maxHeight: 250 }}
                                onClick={() => setLightboxOpen(true)}
                            >
                                <img
                                    src={data.output}
                                    alt="Final output"
                                    className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-500"
                                    style={{ maxHeight: 250 }}
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-emerald-900/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                                    <div className="flex items-center gap-2 bg-emerald-500/20 backdrop-blur-sm px-3 py-1.5 rounded-full border border-emerald-500/30">
                                        <ZoomIn size={12} className="text-emerald-400" />
                                        <span className="text-[9px] font-bold text-emerald-300 uppercase tracking-wider">点击放大</span>
                                    </div>
                                </div>
                                {/* Success Badge */}
                                <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-emerald-500/20 backdrop-blur-sm px-2 py-1 rounded-lg border border-emerald-500/30">
                                    <Rocket size={10} className="text-emerald-400" />
                                    <span className="text-[8px] font-black text-emerald-400 uppercase tracking-wider">完成</span>
                                </div>
                            </div>
                        ) : (
                            // Text Output Display
                            <div className="p-6 bg-emerald-500/10 rounded-2xl border border-emerald-500/30 text-emerald-400 font-black text-center flex flex-col items-center gap-3">
                                <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                                    <Rocket size={24} className="animate-bounce" />
                                </div>
                                <div className="space-y-1">
                                    <span className="block text-[11px] tracking-[0.2em]">流转结束</span>
                                    <span className="block text-xs opacity-70">结果已成功输出</span>
                                </div>
                            </div>
                        )}
                        <button
                            onClick={() => clearExecutionResults()}
                            className="w-full py-3 px-4 bg-[#161621] hover:bg-[#1c1c2b] border border-[#2a2a3a] rounded-xl text-[10px] font-bold text-gray-400 flex items-center justify-center gap-2 transition-all"
                        >
                            <Sparkles size={14} />
                            完成并重置
                        </button>
                    </div>
                ) : (
                    <div className="flex-1 bg-[#0b0b0f] rounded-xl border border-dashed border-[#2a2a3a] flex flex-col items-center justify-center gap-2 opacity-40 p-4">
                        <Play size={24} className="text-gray-800" />
                        <p className="text-[10px] text-gray-700 font-bold uppercase text-center max-w-[120px]">
                            工作流的最终节点
                        </p>
                    </div>
                )}
            </div>

            {/* Lightbox */}
            {lightboxOpen && isImageOutput && typeof data.output === 'string' && (
                <ImageLightbox src={data.output} onClose={() => setLightboxOpen(false)} />
            )}
        </BaseNode>
    );
};
