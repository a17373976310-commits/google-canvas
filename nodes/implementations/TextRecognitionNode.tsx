import React from 'react';
import { NodeProps } from 'reactflow';
import { ImageIcon, Layers3, Type } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { NodeData, TextRecognitionOutput } from '../../types';
import { useStore } from '../../store';
import { BaseNode } from '../BaseNode';

const toOutput = (value: unknown): TextRecognitionOutput | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TextRecognitionOutput>;
  return candidate.kind === 'text-recognition' && Array.isArray(candidate.layers)
    ? candidate as TextRecognitionOutput
    : null;
};

const getLayerPreview = (output: TextRecognitionOutput | null) => {
  const layers = output?.layers || [];
  if (layers.length === 0) return [];
  return layers.slice(0, 4).map((layer, index) => ({
    id: layer.id || `${index}`,
    text: String(layer.text || '').replace(/\s+/g, ' ').trim() || '未命名文字',
    meta: `${Math.round(layer.fontSize || 0)}px · ${Math.round(layer.x || 0)},${Math.round(layer.y || 0)}`,
  }));
};

export const TextRecognitionNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const updateNodeData = useStore((state) => state.updateNodeData);
  const edgeState = useStore(useShallow((state) => ({
    image: state.edges.some((edge) => edge.target === id && edge.targetHandle === 'image'),
    prompt: state.edges.some((edge) => edge.target === id && edge.targetHandle === 'prompt'),
  })));

  const output = React.useMemo(() => toOutput(data.output), [data.output]);
  const layerPreview = React.useMemo(() => getLayerPreview(output), [output]);
  const boardWidth = Number(data.config.boardWidth || output?.boardWidth || 1080);
  const boardHeight = Number(data.config.boardHeight || output?.boardHeight || 1350);

  const setConfig = (patch: Record<string, any>) => {
    updateNodeData(id, { config: { ...data.config, ...patch } });
  };

  return (
    <BaseNode id={id} data={data} icon={Type} color="bg-violet-500" selected={selected}>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
        <div className="flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${edgeState.image ? 'border-orange-500/25 bg-orange-500/10 text-orange-300' : 'theme-border-subtle theme-text-muted'}`}>
            <ImageIcon size={10} />
            原图
          </span>
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${edgeState.prompt ? 'border-blue-500/25 bg-blue-500/10 text-blue-300' : 'theme-border-subtle theme-text-muted'}`}>
            <Type size={10} />
            要求
          </span>
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${output ? 'border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-300' : 'theme-border-subtle theme-text-muted'}`}>
            <Layers3 size={10} />
            {output ? `${output.layers.length} 层` : '待识别'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 nodrag nopan" data-node-interactive="true">
          <label className="flex flex-col gap-1 text-[9px] font-semibold theme-text-muted">
            画板宽
            <input
              className="rounded-lg border px-2 py-1.5 text-[10px] outline-none theme-border-subtle theme-bg-input theme-text-primary focus:border-violet-500/50"
              type="number"
              min={320}
              max={4096}
              value={boardWidth}
              onChange={(event) => setConfig({ boardWidth: Number(event.target.value) || 1080 })}
            />
          </label>
          <label className="flex flex-col gap-1 text-[9px] font-semibold theme-text-muted">
            画板高
            <input
              className="rounded-lg border px-2 py-1.5 text-[10px] outline-none theme-border-subtle theme-bg-input theme-text-primary focus:border-violet-500/50"
              type="number"
              min={320}
              max={4096}
              value={boardHeight}
              onChange={(event) => setConfig({ boardHeight: Number(event.target.value) || 1350 })}
            />
          </label>
        </div>

        {!edgeState.prompt && (
          <textarea
            data-node-interactive="true"
            className="nodrag nopan min-h-[58px] resize-none rounded-xl border p-2.5 text-[10px] leading-relaxed outline-none theme-border-medium theme-bg-input theme-text-primary focus:border-violet-500/50"
            placeholder="可选：补充字体、已知文案或识别要求。"
            value={String(data.config.prompt || '')}
            onChange={(event) => setConfig({ prompt: event.target.value })}
          />
        )}

        {output ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="max-h-24 overflow-y-auto rounded-xl border p-2 theme-border-subtle theme-bg-input custom-scrollbar">
              {layerPreview.map((layer) => (
                <div key={layer.id} className="flex items-center justify-between gap-2 border-b py-1 last:border-b-0 theme-border-subtle">
                  <span className="min-w-0 truncate text-[10px] font-semibold theme-text-primary">{layer.text}</span>
                  <span className="shrink-0 text-[9px] theme-text-muted">{layer.meta}</span>
                </div>
              ))}
            </div>
            <textarea
              readOnly
              data-node-interactive="true"
              className="nodrag nopan min-h-0 flex-1 resize-none rounded-xl border p-2 font-mono text-[9px] leading-relaxed outline-none theme-border-subtle theme-bg-input theme-text-secondary custom-scrollbar"
              value={JSON.stringify({ layers: output.layers }, null, 2)}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed p-4 text-center text-[10px] leading-relaxed theme-border-subtle theme-text-muted">
            连接图片后运行，输出会变成可接到设计画板的文字图层。
          </div>
        )}
      </div>
    </BaseNode>
  );
};
