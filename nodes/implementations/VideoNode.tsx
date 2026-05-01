import React, { useRef, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { NodeData } from '../../types';
import { BaseNode } from '../BaseNode';
import { Video, Sparkles, Image as ImageIcon, Maximize2 } from 'lucide-react';

export const VideoNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const isPromptConnected = !!data.inputs?.prompt;
    const isImageConnected = !!data.inputs?.image;

    return (
        <BaseNode id={id} data={data} icon={Video} color="bg-rose-500" selected={selected}>
            <div className="flex flex-col py-2 gap-1">
                {/* Prompt Handle */}
                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="prompt"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${isPromptConnected ? '!bg-blue-500' : '!bg-[#2a2a3a] group-hover/row:!bg-blue-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <Sparkles size={10} className="text-blue-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">视频提示词 (Prompt)</span>
                    </div>
                </div>

                {/* Optional Image Handle (For Image-to-Video) */}
                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="image"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${isImageConnected ? '!bg-orange-500' : '!bg-[#2a2a3a] group-hover/row:!bg-orange-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <ImageIcon size={10} className="text-orange-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">首尾帧/参考图 (Image)</span>
                    </div>
                </div>
            </div>

            <div className="px-4 pb-4 flex-1 flex flex-col gap-4 min-h-0 overflow-hidden">
                {data.output && typeof data.output === 'string' ? (
                    <div className="group relative rounded-xl overflow-hidden border border-[#2a2a3a] bg-[#0b0b0f] shadow-2xl flex-1 min-h-[140px] flex items-center justify-center">
                        <video
                            src={data.output}
                            controls
                            className="max-w-full max-h-full object-contain"
                            muted
                            loop
                        />
                    </div>
                ) : (
                    <div className={`flex-1 bg-[#0b0b0f] rounded-xl border ${data.status === 'running' ? 'border-rose-500/30' : 'border-dashed border-[#2a2a3a]'} flex flex-col items-center justify-center gap-3 p-4 min-h-[140px] ${data.status === 'running' ? 'opacity-100' : 'opacity-40'}`}>
                        <Video size={24} className={data.status === 'running' ? 'text-rose-400 animate-pulse' : 'text-gray-800'} />
                        <span className="text-[10px] text-gray-700 font-bold uppercase text-center">
                            {data.status === 'running'
                                ? '视频生成中... 通常需要 1~3 分钟'
                                : (isPromptConnected ? '准备就绪，等待生成...' : '等待视频生成...')}
                        </span>
                        {data.status === 'running' && (
                            <div className="w-full mt-1 space-y-1">
                                <div className="w-full h-1.5 bg-[#1a1a2a] rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-rose-500 to-pink-500 rounded-full animate-pulse" style={{ width: `${Math.max(5, Math.min(95, data.progress || 10))}%`, transition: 'width 1s ease' }} />
                                </div>
                                <p className="text-[8px] text-rose-400/60 text-center font-mono">{Math.max(1, Math.min(99, Math.floor(data.progress || 5)))}%</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <Handle
                type="source"
                position={Position.Right}
                className="!w-3 !h-3 !bg-rose-500 !border-2 !border-[#0b0b0f] !right-[-7px]"
            />
        </BaseNode>
    );
};
