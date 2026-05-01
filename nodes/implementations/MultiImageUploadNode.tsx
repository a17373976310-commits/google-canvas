
import React, { useCallback, useRef } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { NodeData } from '../../types';
import { useStore } from '../../store';
import { BaseNode } from '../BaseNode';
import { Images, X, Plus, Image as ImageIcon } from 'lucide-react';
import { fileToOptimizedImageDataUrl } from '../../utils/imageCompression';

export const MultiImageUploadNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const updateNodeData = useStore((state) => state.updateNodeData);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // data.output is string[] (array of Base64 Data URLs)
    const images: string[] = Array.isArray(data.output) ? data.output : [];

    const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const readers: Promise<string>[] = [];
        for (let i = 0; i < files.length; i++) {
            readers.push(fileToOptimizedImageDataUrl(files[i]));
        }

        Promise.all(readers).then((results) => {
            const currentImages: string[] = Array.isArray(data.output) ? data.output : [];
            const newImages = [...currentImages, ...results];
            updateNodeData(id, {
                output: newImages,
                status: 'success'
            });
        });

        // Reset input so the same file can be selected again
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [id, data.output, updateNodeData]);

    const removeImage = useCallback((index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const currentImages: string[] = Array.isArray(data.output) ? data.output : [];
        const newImages = currentImages.filter((_, i) => i !== index);
        updateNodeData(id, {
            output: newImages.length > 0 ? newImages : null,
            status: newImages.length > 0 ? 'success' : 'idle'
        });
    }, [id, data.output, updateNodeData]);

    const clearAll = useCallback(() => {
        updateNodeData(id, { output: null, status: 'idle' });
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [id, updateNodeData]);

    return (
        <BaseNode id={id} data={data} icon={Images} color="bg-amber-500" selected={selected}>
            <div className="p-4 flex-1 flex flex-col gap-3 min-h-[180px]">
                {/* Header stats */}
                {images.length > 0 && (
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black text-amber-400 uppercase tracking-wider bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">
                            {images.length} 张图片
                        </span>
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="p-1.5 bg-[#1e1e2d] hover:bg-amber-500/20 text-gray-500 hover:text-amber-400 rounded-lg transition-all"
                                title="添加更多"
                            >
                                <Plus size={12} />
                            </button>
                            <button
                                onClick={clearAll}
                                className="p-1.5 bg-[#1e1e2d] hover:bg-rose-500/20 text-gray-500 hover:text-rose-400 rounded-lg transition-all"
                                title="清空全部"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Image Grid */}
                {images.length > 0 ? (
                    <div className="grid grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
                        {images.map((img, index) => (
                            <div
                                key={index}
                                className="group relative aspect-square rounded-lg overflow-hidden border border-[#2a2a3a] bg-black shadow-inner"
                            >
                                <img
                                    src={img}
                                    alt={`Image ${index + 1}`}
                                    className="w-full h-full object-cover transition-transform group-hover:scale-110 duration-300"
                                />
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <button
                                        onClick={(e) => removeImage(index, e)}
                                        className="p-1 bg-rose-500/80 hover:bg-rose-500 rounded-full text-white shadow-lg scale-75 group-hover:scale-100 transition-all"
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                                <span className="absolute bottom-0.5 right-1 text-[7px] font-black text-white/60 bg-black/60 px-1 rounded">
                                    {index + 1}
                                </span>
                            </div>
                        ))}
                    </div>
                ) : (
                    /* Empty State - Upload Zone */
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 border-2 border-dashed border-[#2a2a3a] hover:border-amber-500/50 rounded-xl flex flex-col items-center justify-center gap-3 bg-[#0b0b0f] cursor-pointer group transition-all"
                    >
                        <div className="w-12 h-12 bg-[#161621] rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-inner">
                            <Images size={24} className="text-gray-600 group-hover:text-amber-500 transition-colors" />
                        </div>
                        <div className="text-center">
                            <span className="block text-[10px] text-gray-400 font-bold uppercase tracking-tight">点击批量上传图片</span>
                            <span className="block text-[8px] text-gray-600 mt-1">支持多选 • PNG, JPG, WEBP</span>
                            <span className="block text-[8px] text-indigo-400/70 mt-1">选中节点后可 Ctrl+V 追加</span>
                        </div>
                    </div>
                )}

                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/*"
                    multiple
                    className="hidden"
                />
            </div>

            {/* Typed Source Port */}
            <div className="absolute -right-[3px] top-1/2 -translate-y-1/2 group/out">
                <Handle
                    type="source"
                    position={Position.Right}
                    id="output"
                    className="!w-3 !h-3 !bg-amber-500 !border-2 !border-[#0b0b0f] !static translate-y-0"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-black text-amber-400 uppercase tracking-widest opacity-0 group-hover/out:opacity-100 transition-opacity whitespace-nowrap bg-[#0b0b0f] px-1 rounded pointer-events-none">批量图像</span>
            </div>
        </BaseNode>
    );
};
