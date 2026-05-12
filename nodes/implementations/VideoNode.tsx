import React from 'react';
import { NodeProps } from 'reactflow';
import { Image as ImageIcon, Sparkles, Video } from 'lucide-react';
import { NodeData } from '../../types';
import { BaseNode } from '../BaseNode';

export const VideoNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const isPromptConnected = !!data.inputs?.prompt;
  const isImageConnected = !!data.inputs?.image;

  return (
    <BaseNode id={id} data={data} icon={Video} color="bg-rose-500" selected={selected}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${isPromptConnected ? 'border-blue-500/25 bg-blue-500/10 text-blue-300' : 'theme-border-subtle theme-text-muted'}`}>
            <Sparkles size={10} />
            提示词
          </span>
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${isImageConnected ? 'border-orange-500/25 bg-orange-500/10 text-orange-300' : 'theme-border-subtle theme-text-muted'}`}>
            <ImageIcon size={10} />
            首尾帧
          </span>
        </div>

        {data.output && typeof data.output === 'string' ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border theme-border-medium theme-bg-input shadow-inner">
            <video
              src={data.output}
              controls
              className="max-h-full max-w-full object-contain"
              muted
              loop
            />
          </div>
        ) : (
          <div className={`flex min-h-[130px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border p-4 text-center ${data.status === 'running' ? 'border-rose-500/30 theme-bg-input' : 'border-dashed theme-border-medium theme-bg-input'}`}>
            <Video size={24} className={data.status === 'running' ? 'animate-pulse text-rose-400' : 'theme-text-disabled'} />
            <span className="text-[10px] font-semibold theme-text-muted">
              {data.status === 'running'
                ? '视频生成中，通常需要 1~3 分钟'
                : (isPromptConnected ? '准备就绪，等待生成' : '等待视频生成')}
            </span>
            {data.status === 'running' && (
              <div className="mt-1 w-full space-y-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full theme-bg-secondary">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-rose-500 to-pink-500 transition-[width] duration-1000"
                    style={{ width: `${Math.max(5, Math.min(95, data.progress || 10))}%` }}
                  />
                </div>
                <p className="text-center text-[9px] font-mono text-rose-400/70">
                  {Math.max(1, Math.min(99, Math.floor(data.progress || 5)))}%
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </BaseNode>
  );
};
