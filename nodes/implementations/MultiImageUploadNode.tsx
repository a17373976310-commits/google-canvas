import React, { useCallback, useRef, useState } from 'react';
import { NodeProps } from 'reactflow';
import { Image as ImageIcon, Images, Plus, X } from 'lucide-react';
import { NodeData } from '../../types';
import { useStore } from '../../store';
import { BaseNode } from '../BaseNode';
import { fileToOptimizedImageDataUrl } from '../../utils/imageCompression';
import { ImageLightbox } from '../../components/ImageLightbox';

const isRenderableImageReference = (value: string) => /^https?:\/\//i.test(value) || /^data:image\//i.test(value);

export const MultiImageUploadNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const updateNodeData = useStore((state) => state.updateNodeData);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const rawImages: string[] = Array.isArray(data.output) ? data.output : [];
  const images = rawImages.filter((item) => typeof item === 'string' && isRenderableImageReference(item.trim()));
  const previewClassName = images.length === 1
    ? 'canvas-multi-image-preview is-single'
    : images.length === 2
      ? 'canvas-multi-image-preview is-pair'
      : 'canvas-multi-image-preview is-grid custom-scrollbar';

  React.useEffect(() => {
    if (rawImages.length === images.length) return;
    updateNodeData(id, {
      output: images.length > 0 ? images : null,
      status: images.length > 0 ? 'success' : 'error',
      error: images.length > 0
        ? '已移除无效图片引用：图片节点只能接收真实 URL 或 data:image 数据。'
        : '图片引用无效：请重新上传真实图片，不要使用占位文字。',
    });
  }, [id, images, rawImages.length, updateNodeData]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const readers = Array.from(files).map((file: File) => fileToOptimizedImageDataUrl(file));
    void Promise.all(readers).then((results) => {
      const currentImages: string[] = Array.isArray(data.output) ? data.output : [];
      updateNodeData(id, {
        output: [...currentImages, ...results],
        status: 'success',
      });
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [id, data.output, updateNodeData]);

  const removeImage = useCallback((index: number, event: React.MouseEvent) => {
    event.stopPropagation();
    const currentImages: string[] = Array.isArray(data.output) ? data.output : [];
    const newImages = currentImages.filter((_, currentIndex) => currentIndex !== index);
    updateNodeData(id, {
      output: newImages.length > 0 ? newImages : null,
      status: newImages.length > 0 ? 'success' : 'idle',
    });
  }, [id, data.output, updateNodeData]);

  const clearAll = useCallback(() => {
    updateNodeData(id, { output: null, status: 'idle' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [id, updateNodeData]);

  const openPreview = useCallback((image: string, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setPreviewImage(image);
  }, []);

  return (
    <BaseNode id={id} data={data} icon={Images} color="bg-amber-500" selected={selected}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {images.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[9px] font-semibold text-amber-300">
              {images.length} 张图片
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg p-1.5 theme-bg-tertiary theme-text-muted transition-all hover:bg-amber-500/20 hover:text-amber-400"
                title="添加更多"
              >
                <Plus size={12} />
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="rounded-lg p-1.5 theme-bg-tertiary theme-text-muted transition-all hover:bg-rose-500/20 hover:text-rose-400"
                title="清空全部"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {images.length > 0 ? (
          <div className={previewClassName}>
            {images.map((img, index) => (
              <div
                key={`${img}-${index}`}
                className="canvas-image-preview-surface canvas-multi-image-item nodrag nopan nowheel group cursor-zoom-in"
                data-node-interactive="true"
                onClick={(event) => openPreview(img, event)}
                onDoubleClick={(event) => openPreview(img, event)}
                title="预览图片"
              >
                <img
                  src={img}
                  alt={`Image ${index + 1}`}
                  className="canvas-image-preview-img"
                  draggable={false}
                />
                <div className="canvas-multi-image-overlay">
                  <button
                    type="button"
                    onClick={(event) => removeImage(index, event)}
                    className="scale-75 rounded-full bg-rose-500/80 p-1 text-white shadow-lg transition-all hover:bg-rose-500 group-hover:scale-100"
                    title="删除图片"
                  >
                    <X size={10} />
                  </button>
                </div>
                <span className="canvas-multi-image-index">
                  {index + 1}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="nodrag nopan group flex min-h-[150px] flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed theme-border-medium theme-bg-input transition-all hover:border-amber-500/50"
            data-node-interactive="true"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl theme-bg-secondary shadow-inner transition-transform group-hover:scale-105">
              <ImageIcon size={24} className="theme-text-muted transition-colors group-hover:text-amber-500" />
            </div>
            <div className="text-center">
              <span className="block text-[10px] font-semibold theme-text-secondary">点击批量上传图片</span>
              <span className="mt-1 block text-[9px] theme-text-muted">支持多选，PNG / JPG / WEBP</span>
              <span className="mt-1 block text-[9px] text-indigo-400/70">选中节点后可 Ctrl+V 追加</span>
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
      {previewImage && (
        <ImageLightbox src={previewImage} onClose={() => setPreviewImage(null)} />
      )}
    </BaseNode>
  );
};
