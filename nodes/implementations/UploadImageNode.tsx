import React, { useCallback, useRef, useState } from 'react';
import { NodeProps } from 'reactflow';
import { Image as ImageIcon, Upload, X } from 'lucide-react';
import { NodeData } from '../../types';
import { useStore } from '../../store';
import { BaseNode } from '../BaseNode';
import { fileToOptimizedImageDataUrl } from '../../utils/imageCompression';
import { ImageLightbox } from '../../components/ImageLightbox';

export const UploadImageNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const updateNodeData = useStore((state) => state.updateNodeData);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void fileToOptimizedImageDataUrl(file).then((imageDataUrl) => {
      updateNodeData(id, {
        output: imageDataUrl,
        status: 'success',
      });
    });
  }, [id, updateNodeData]);

  const clearImage = useCallback(() => {
    updateNodeData(id, {
      output: null,
      status: 'idle',
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [id, updateNodeData]);

  const openPreview = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setLightboxOpen(true);
  }, []);

  return (
    <BaseNode id={id} data={data} icon={Upload} color="bg-orange-500" selected={selected}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {data.output ? (
          <div
            className="canvas-image-preview-surface nodrag nopan nowheel group relative min-h-0 flex-1 cursor-zoom-in overflow-hidden rounded-xl border theme-border-medium bg-black shadow-inner"
            data-node-interactive="true"
            onClick={openPreview}
            onDoubleClick={openPreview}
            title="预览图片"
          >
            <img src={data.output} alt="Uploaded" className="canvas-image-preview-img h-full w-full object-cover" draggable={false} />
            <div className="canvas-image-preview-hover" aria-hidden="true">
              <span className="canvas-image-preview-corner is-top-left" />
              <span className="canvas-image-preview-corner is-top-right" />
              <span className="canvas-image-preview-corner is-bottom-left" />
              <span className="canvas-image-preview-corner is-bottom-right" />
              <div className="canvas-image-preview-icon">
                <ImageIcon size={15} />
              </div>
            </div>
            <div className="absolute right-2 top-2 z-20 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  clearImage();
                }}
                className="rounded-full bg-black/55 p-2 text-white shadow-lg ring-1 ring-white/10 backdrop-blur transition-all hover:bg-rose-500"
                title="清除图片"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="nodrag nopan group flex min-h-[130px] flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed theme-border-medium theme-bg-input transition-all hover:border-orange-500/50"
            data-node-interactive="true"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl theme-bg-secondary shadow-inner transition-transform group-hover:scale-105">
              <ImageIcon size={20} className="theme-text-muted group-hover:text-orange-500" />
            </div>
            <div className="text-center">
              <span className="block text-[10px] font-semibold theme-text-secondary">点击上传图片</span>
              <span className="mt-1 block text-[9px] theme-text-muted">PNG / JPG / WEBP</span>
              <span className="mt-1 block text-[9px] text-indigo-400/70">选中节点后可 Ctrl+V 粘贴</span>
            </div>
          </div>
        )}
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
      </div>
      {lightboxOpen && typeof data.output === 'string' && (
        <ImageLightbox src={data.output} onClose={() => setLightboxOpen(false)} />
      )}
    </BaseNode>
  );
};
