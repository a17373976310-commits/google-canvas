
import React, { useRef, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { NodeData } from '../types';
import { BaseNode } from './BaseNode';
import { Volume2, Pause, PlayCircle, Music } from 'lucide-react';

export const AudioNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<AudioBufferSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playPCM = async () => {
    if (!data.output) return;
    if (isPlaying) {
      audioRef.current?.stop();
      setIsPlaying(false);
      return;
    }

    try {
      const base64Data = data.output.split(',')[1];
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = ctx;

      const dataInt16 = new Int16Array(bytes.buffer);
      const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
      const channelData = buffer.getChannelData(0);
      for (let i = 0; i < dataInt16.length; i++) {
        channelData[i] = dataInt16[i] / 32768.0;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => setIsPlaying(false);
      source.start();
      audioRef.current = source;
      setIsPlaying(true);
    } catch (e) {
      console.error('Audio playback failed', e);
    }
  };

  return (
    <BaseNode id={id} data={data} icon={Volume2} color="bg-cyan-500" selected={selected}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-cyan-500 !border-2 theme-handle-border" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-cyan-500 !border-2 theme-handle-border" />

      {data.output ? (
        <div className="space-y-4 flex-1 flex flex-col justify-center">
          <div className="flex items-center gap-3 p-3 bg-cyan-500/10 rounded-xl border border-cyan-500/20">
            <div className="w-10 h-10 bg-cyan-500/20 rounded-lg flex items-center justify-center">
              <Music size={20} className="text-cyan-400" />
            </div>
            <div>
              <span className="block text-[10px] font-bold text-cyan-400 uppercase leading-none mb-1">已生成的音频 (PCM)</span>
              <span className="block text-xs theme-text-secondary font-mono italic">24kHz 单声道 16位</span>
            </div>
          </div>
          <button
            onClick={playPCM}
            className={`w-full flex items-center justify-center gap-3 p-4 rounded-xl border transition-all duration-300 transform active:scale-95 ${isPlaying ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.2)]' : 'theme-bg-input theme-border-medium theme-text-muted hover:theme-text-primary hover:theme-border-strong hover:bg-gray-500/5'
              }`}
          >
            {isPlaying ? <Pause size={20} className="animate-pulse" /> : <PlayCircle size={20} />}
            <span className="text-xs font-black uppercase tracking-widest">{isPlaying ? '正在运行' : '试听音频'}</span>
          </button>
        </div>
      ) : (
        <div className="flex-1 border border-dashed theme-border-medium rounded-xl flex flex-col items-center justify-center gap-3 opacity-50">
          <Volume2 size={32} className="theme-text-disabled" />
          <span className="text-[10px] theme-text-disabled font-bold uppercase">已准备好合成语音</span>
        </div>
      )}
    </BaseNode>
  );
};
