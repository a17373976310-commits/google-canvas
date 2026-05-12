import React, { useCallback, useMemo, useState } from 'react';
import { NodeProps } from 'reactflow';
import { Image as ImageIcon, Layers, Sparkles, ZoomIn } from 'lucide-react';
import { NodeData } from '../../types';
import { BaseNode } from '../BaseNode';
import { ImageLightbox } from '../../components/ImageLightbox';
import { normalizeImageSrc } from '../../utils/normalizeImageSrc';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';

export const ImageNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const edgeState = useStore(useShallow((state) => ({
    prompt: state.edges.some((edge) => edge.target === id && edge.targetHandle === 'prompt'),
    image: state.edges.some((edge) => edge.target === id && edge.targetHandle === 'image'),
    batch: state.edges.some((edge) => edge.target === id && edge.targetHandle === 'batch'),
  })));
  const isBatchTemplate = !!(edgeState.batch || data.meta?.batchTemplate || data.meta?.templateOnly);
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
  const openPreview = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setLightboxOpen(true);
  }, []);

  return (
    <BaseNode id={id} data={data} icon={ImageIcon} color="bg-purple-500" selected={selected}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${edgeState.prompt ? 'border-blue-500/25 bg-blue-500/10 text-blue-300' : 'theme-border-subtle theme-text-muted'}`}>
            <Sparkles size={10} />
            提示词
          </span>
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${edgeState.image ? 'border-orange-500/25 bg-orange-500/10 text-orange-300' : 'theme-border-subtle theme-text-muted'}`}>
            <ImageIcon size={10} />
            参考图
          </span>
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${isBatchTemplate || isExpandedTaskNode ? 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300' : 'theme-border-subtle theme-text-muted'}`}>
            <Layers size={10} />
            {isExpandedTaskNode ? `任务 #${taskIndex || '-'}` : '批量'}
          </span>
        </div>

        {isExpandedTaskNode && (
          <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.04] px-3 py-2 text-[10px] text-cyan-200">
            当前节点对应拆分任务 #{taskIndex || '-'}
          </div>
        )}

        {previewImage ? (
          <div
            className="canvas-image-preview-surface nodrag nopan nowheel group relative min-h-0 flex-1 cursor-zoom-in overflow-hidden rounded-xl border theme-border-medium theme-bg-input shadow-inner"
            data-node-interactive="true"
            onClick={openPreview}
            onDoubleClick={openPreview}
            title="预览图片"
          >
            <img
              src={previewImage}
              alt="Generated"
              className="canvas-image-preview-img h-full w-full object-cover"
              draggable={false}
            />
            {generatedImages.length > 1 && (
              <div className="absolute left-3 top-3 rounded-lg border border-cyan-500/20 bg-cyan-500/15 px-2 py-1 text-[9px] font-semibold text-cyan-300">
                共 {generatedImages.length} 张
              </div>
            )}
            <div className="canvas-image-preview-hover" aria-hidden="true">
              <span className="canvas-image-preview-corner is-top-left" />
              <span className="canvas-image-preview-corner is-top-right" />
              <span className="canvas-image-preview-corner is-bottom-left" />
              <span className="canvas-image-preview-corner is-bottom-right" />
              <div className="canvas-image-preview-icon">
                <ZoomIn size={15} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[120px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed theme-border-medium theme-bg-input p-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/10">
              <ImageIcon size={22} className={data.status === 'running' ? 'animate-pulse text-purple-300' : 'theme-text-disabled'} />
            </div>
            <span className="text-[10px] font-semibold theme-text-muted">
              {data.status === 'running'
                ? `${isBatchTemplate ? '展开任务中' : '生成中'} ${Math.max(1, Math.min(99, Math.floor(data.progress || 1)))}%`
                : (isBatchTemplate ? '作为批量模板使用' : (edgeState.prompt ? '准备出图' : '等待图像生成'))}
            </span>
          </div>
        )}
      </div>

      {lightboxOpen && previewImage && (
        <ImageLightbox src={previewImage} onClose={() => setLightboxOpen(false)} />
      )}
    </BaseNode>
  );
};
