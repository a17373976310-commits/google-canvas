import React, { useCallback, useState } from 'react';
import { NodeProps } from 'reactflow';
import { Play, Rocket, Sparkles, ZoomIn } from 'lucide-react';
import { NodeData } from '../../types';
import { BaseNode } from '../BaseNode';
import { ImageLightbox } from '../../components/ImageLightbox';
import { useStore } from '../../store';

export const OutputNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const clearExecutionResults = useStore((state) => state.clearExecutionResults);
  const openPreview = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setLightboxOpen(true);
  }, []);

  const isImageOutput = data.output && (
    typeof data.output === 'string' && (
      (data.output.startsWith('http') && /\.(jpg|jpeg|png|gif|webp|svg)/i.test(data.output))
      || data.output.startsWith('data:image')
      || data.output.includes('blob:')
    )
  );

  return (
    <BaseNode id={id} data={data} icon={Play} color="bg-emerald-500" selected={selected}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {data.output ? (
          <>
            {isImageOutput ? (
              <div
                className="canvas-image-preview-surface nodrag nopan nowheel group relative min-h-0 flex-1 cursor-zoom-in overflow-hidden rounded-xl border border-emerald-500/30 theme-bg-input"
                data-node-interactive="true"
                onClick={openPreview}
                onDoubleClick={openPreview}
                title="预览图片"
              >
                <img
                  src={data.output}
                  alt="Final output"
                  className="canvas-image-preview-img h-full w-full object-cover"
                  draggable={false}
                />
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
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-5 text-center text-emerald-300">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20">
                  <Rocket size={24} />
                </div>
                <div>
                  <span className="block text-[11px] font-semibold">流转结束</span>
                  <span className="mt-1 block text-xs opacity-70">结果已成功输出</span>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => clearExecutionResults()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border theme-border-medium theme-bg-secondary px-4 py-3 text-[10px] font-semibold theme-text-secondary transition-all hover:theme-bg-tertiary"
            >
              <Sparkles size={14} />
              完成并重置
            </button>
          </>
        ) : (
          <div className="flex min-h-[130px] flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed theme-border-medium theme-bg-input p-4 text-center">
            <Play size={24} className="theme-text-disabled" />
            <p className="max-w-[150px] text-[10px] font-semibold theme-text-muted">
              工作流的最终节点
            </p>
          </div>
        )}
      </div>

      {lightboxOpen && isImageOutput && typeof data.output === 'string' && (
        <ImageLightbox src={data.output} onClose={() => setLightboxOpen(false)} />
      )}
    </BaseNode>
  );
};
