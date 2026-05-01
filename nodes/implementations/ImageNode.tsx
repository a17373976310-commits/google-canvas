import React, { useMemo, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Image as ImageIcon, Layers, Sparkles, ZoomIn } from 'lucide-react';
import { NodeData } from '../../types';
import { BaseNode } from '../BaseNode';
import { ImageLightbox } from '../../components/ImageLightbox';
import { normalizeImageSrc } from '../../utils/normalizeImageSrc';
import { useStore } from '../../store';

export const ImageNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const hasPromptEdge = useStore((state) => state.edges.some((edge) => edge.target === id && edge.targetHandle === 'prompt'));
    const hasImageEdge = useStore((state) => state.edges.some((edge) => edge.target === id && edge.targetHandle === 'image'));
    const hasBatchEdge = useStore((state) => state.edges.some((edge) => edge.target === id && edge.targetHandle === 'batch'));
    const isPromptConnected = hasPromptEdge;
    const isImageConnected = hasImageEdge;
    const isBatchTemplate = !!(hasBatchEdge || data.meta?.batchTemplate || data.meta?.templateOnly);
    const isExpandedTaskNode = !!data.meta?.batchExpansion;
    const taskIndex = data.meta?.batchExpansion?.selectedIndex ?? data.meta?.selectedIndex;
    const [lightboxOpen, setLightboxOpen] = useState(false);

    const generatedImages = useMemo(() => {
        if (Array.isArray(data.output)) {
            return data.output
                .map((item) => normalizeImageSrc(item))
                .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        }

        const single = normalizeImageSrc(data.output);
        return single ? [single] : [];
    }, [data.output]);

    const previewImage = generatedImages[0] || null;

    return (
        <BaseNode id={id} data={data} icon={ImageIcon} color="bg-purple-500" selected={selected}>
            <div className="flex flex-col py-2 gap-1">
                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="prompt"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${isPromptConnected ? '!bg-blue-500' : '!bg-[#2a2a3a] group-hover/row:!bg-blue-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <Sparkles size={10} className="text-blue-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">提示词</span>
                    </div>
                    {isPromptConnected && (
                        <div className="ml-auto animate-pulse flex items-center gap-1">
                            <span className="text-[7px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20 font-black uppercase tracking-widest">已连接</span>
                        </div>
                    )}
                </div>

                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="image"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${isImageConnected ? '!bg-orange-500' : '!bg-[#2a2a3a] group-hover/row:!bg-orange-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <ImageIcon size={10} className="text-orange-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">参考图</span>
                    </div>
                    {isImageConnected && (
                        <div className="ml-auto animate-pulse flex items-center gap-1">
                            <span className="text-[7px] bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded border border-orange-500/20 font-black uppercase tracking-widest">已连接</span>
                        </div>
                    )}
                </div>

                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="template"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${isExpandedTaskNode ? '!bg-cyan-400' : '!bg-[#2a2a3a] group-hover/row:!bg-cyan-300'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <Layers size={10} className="text-cyan-300" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">任务映射</span>
                    </div>
                    {isExpandedTaskNode && (
                        <div className="ml-auto flex items-center gap-1">
                            <span className="text-[7px] bg-cyan-500/10 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/20 font-black uppercase tracking-widest">
                                #{taskIndex}
                            </span>
                        </div>
                    )}
                </div>

                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="batch"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${isBatchTemplate ? '!bg-cyan-500' : '!bg-[#2a2a3a] group-hover/row:!bg-cyan-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <Layers size={10} className="text-cyan-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">批量模板</span>
                    </div>
                    {isBatchTemplate && (
                        <div className="ml-auto animate-pulse flex items-center gap-1">
                            <span className="text-[7px] bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded border border-cyan-500/20 font-black uppercase tracking-widest">模板</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="px-4 pb-4 flex-1 flex flex-col gap-4 min-h-0 overflow-hidden">
                {isExpandedTaskNode && (
                    <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.04] px-3 py-2 text-[10px] text-cyan-200">
                        当前节点对应拆分任务 #{taskIndex || '-'}
                    </div>
                )}
                {previewImage ? (
                    <div
                        className="group relative rounded-xl overflow-hidden border border-[#2a2a3a] bg-[#0b0b0f] shadow-2xl cursor-pointer flex-1 min-h-[120px]"
                        onClick={() => setLightboxOpen(true)}
                    >
                        <img
                            src={previewImage}
                            alt="Generated"
                            className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-500"
                        />
                        {generatedImages.length > 1 && (
                            <div className="absolute left-3 top-3 px-2 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/20 text-[9px] font-black tracking-wider">
                                共 {generatedImages.length} 张
                            </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-4">
                            <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm px-4 py-2 rounded-full border border-white/20">
                                <ZoomIn size={14} className="text-white" />
                                <span className="text-[10px] font-bold text-white uppercase tracking-wider">查看预览</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 bg-[#0b0b0f] rounded-xl border border-dashed border-[#2a2a3a] flex flex-col items-center justify-center gap-3 opacity-40 p-4 min-h-[120px]">
                        <ImageIcon size={24} className="text-gray-800" />
                        <span className="text-[10px] text-gray-700 font-bold uppercase text-center">
                            {data.status === 'running'
                                ? `${isBatchTemplate ? '展开任务中' : '生成中'} ${Math.max(1, Math.min(99, Math.floor(data.progress || 1)))}%`
                                : (isBatchTemplate ? '当前节点作为批量模板使用' : (isPromptConnected ? '准备出图...' : '等待图像生成...'))}
                        </span>
                    </div>
                )}
            </div>

            <Handle
                type="source"
                position={Position.Right}
                className="!w-3 !h-3 !bg-purple-500 !border-2 !border-[#0b0b0f] !right-[-7px]"
            />

            {lightboxOpen && previewImage && (
                <ImageLightbox src={previewImage} onClose={() => setLightboxOpen(false)} />
            )}
        </BaseNode>
    );
};
