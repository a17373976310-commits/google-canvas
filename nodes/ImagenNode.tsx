
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { NodeData } from '../types';
import { BaseNode } from './BaseNode';
import { Image as ImageIcon, Maximize2 } from 'lucide-react';
import { normalizeImageSrc } from '../utils/normalizeImageSrc';

export const ImagenNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const imageSrc = normalizeImageSrc(data.output);
  return (
    <BaseNode id={id} data={data} icon={ImageIcon} color="bg-purple-500" selected={selected}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-purple-500 !border-2 theme-handle-border" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-purple-500 !border-2 theme-handle-border" />

      {imageSrc ? (
        <div className="group relative rounded-xl overflow-hidden border theme-border-medium theme-bg-input shadow-2xl">
          <img src={imageSrc} alt="Generated" className="w-full h-auto transform transition-transform group-hover:scale-110 duration-700" />
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-sm">
            <button
              onClick={() => window.open(imageSrc)}
              className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all transform scale-90 group-hover:scale-100"
            >
              <Maximize2 size={20} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 theme-bg-input rounded-xl border-2 border-dashed theme-border-medium flex flex-col items-center justify-center gap-2">
          <ImageIcon size={32} className="theme-text-disabled" />
          <span className="text-[10px] theme-text-disabled font-bold uppercase tracking-tighter">等待生成图片</span>
        </div>
      )}
    </BaseNode>
  );
};
