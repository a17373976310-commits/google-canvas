
import React, { useCallback, useRef } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { NodeData } from '../../types';
import { useStore } from '../../store';
import { BaseNode } from '../BaseNode';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import { fileToOptimizedImageDataUrl } from '../../utils/imageCompression';

export const UploadImageNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const updateNodeData = useStore((state) => state.updateNodeData);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            void fileToOptimizedImageDataUrl(file).then((imageDataUrl) => {
                updateNodeData(id, {
                    output: imageDataUrl,
                    status: 'success'
                });
            });
        }
    }, [id, updateNodeData]);

    const clearImage = useCallback(() => {
        updateNodeData(id, {
            output: null,
            status: 'idle'
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [id, updateNodeData]);

    return (
        <BaseNode id={id} data={data} icon={Upload} color="bg-orange-500" selected={selected}>
            <div className="p-4 flex-1 flex flex-col gap-3 min-h-[160px]">
                {data.output ? (
                    <div className="group relative flex-1 rounded-xl overflow-hidden border border-[#2a2a3a] bg-black shadow-inner">
                        <img src={data.output} alt="Uploaded" className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-500" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                                onClick={clearImage}
                                className="p-2 bg-rose-500/80 hover:bg-rose-500 rounded-full text-white shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                ) : (
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 border-2 border-dashed border-[#2a2a3a] hover:border-orange-500/50 rounded-xl flex flex-col items-center justify-center gap-3 bg-[#0b0b0f] cursor-pointer group transition-all"
                    >
                        <div className="w-10 h-10 bg-[#161621] rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-inner">
                            <ImageIcon size={20} className="text-gray-600 group-hover:text-orange-500" />
                        </div>
                        <div className="text-center">
                            <span className="block text-[10px] text-gray-400 font-bold uppercase tracking-tight">点击上传图片</span>
                            <span className="block text-[8px] text-gray-600 mt-1">PNG, JPG, WEBP</span>
                            <span className="block text-[8px] text-indigo-400/70 mt-1">选中节点后可 Ctrl+V 粘贴</span>
                        </div>
                    </div>
                )}
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
            </div>

            {/* Typed Source Port */}
            <div className="absolute -right-[3px] top-1/2 -translate-y-1/2 group/out">
                <Handle
                    type="source"
                    position={Position.Right}
                    id="output"
                    className="!w-3 !h-3 !bg-orange-500 !border-2 !border-[#0b0b0f] !static translate-y-0"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-black text-orange-400 uppercase tracking-widest opacity-0 group-hover/out:opacity-100 transition-opacity whitespace-nowrap bg-[#0b0b0f] px-1 rounded pointer-events-none">源图像</span>
            </div>
        </BaseNode>
    );
};
