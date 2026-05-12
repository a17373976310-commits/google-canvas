import React, { useRef, useState } from 'react';
import { NodeProps } from 'reactflow';
import { Music, Pause, PlayCircle, Type, Volume2 } from 'lucide-react';
import { NodeData } from '../../types';
import { BaseNode } from '../BaseNode';

export const AudioNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<AudioBufferSourceNode | HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const isPromptConnected = !!data.inputs?.prompt;

  const playPCM = async () => {
    if (!data.output) return;
    if (isPlaying) {
      if ('stop' in (audioRef.current as any)) {
        (audioRef.current as AudioBufferSourceNode).stop();
      } else if ('pause' in (audioRef.current as any)) {
        (audioRef.current as HTMLAudioElement).pause();
      }
      setIsPlaying(false);
      return;
    }

    try {
      if (typeof data.output === 'string' && data.output.startsWith('http')) {
        const audio = new Audio(data.output);
        audio.onended = () => setIsPlaying(false);
        await audio.play();
        audioRef.current = audio;
        setIsPlaying(true);
        return;
      }

      const base64Data = String(data.output).includes(',') ? String(data.output).split(',')[1] : String(data.output);
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let index = 0; index < binaryString.length; index += 1) {
        bytes[index] = binaryString.charCodeAt(index);
      }

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = ctx;

      const dataInt16 = new Int16Array(bytes.buffer);
      const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
      const channelData = buffer.getChannelData(0);
      for (let index = 0; index < dataInt16.length; index += 1) {
        channelData[index] = dataInt16[index] / 32768.0;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => setIsPlaying(false);
      source.start();
      audioRef.current = source;
      setIsPlaying(true);
    } catch (error) {
      console.error('Audio playback failed', error);
      setIsPlaying(false);
    }
  };

  return (
    <BaseNode id={id} data={data} icon={Volume2} color="bg-cyan-500" selected={selected}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <span className={`inline-flex w-fit items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${isPromptConnected ? 'border-blue-500/25 bg-blue-500/10 text-blue-300' : 'theme-border-subtle theme-text-muted'}`}>
          <Type size={10} />
          语音提示词
        </span>

        {data.output ? (
          <div className="flex flex-1 flex-col justify-center gap-4">
            <div className="flex items-center gap-3 rounded-xl border border-cyan-500/10 bg-cyan-500/5 p-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10">
                <Music size={18} className="text-cyan-400" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold text-cyan-300">音频已就绪</span>
                <span className="block text-[9px] theme-text-muted">
                  {typeof data.output === 'string' && data.output.startsWith('http') ? 'URL 媒体播放' : 'PCM 输出 24kHz'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={playPCM}
              className={`flex w-full items-center justify-center gap-3 rounded-xl border p-4 transition-all active:scale-[0.98] ${isPlaying
                ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-300'
                : 'theme-border-medium theme-bg-input theme-text-muted hover:theme-text-primary hover:theme-border-strong'
                }`}
            >
              {isPlaying ? <Pause size={18} className="animate-pulse" /> : <PlayCircle size={18} />}
              <span className="text-[10px] font-semibold">{isPlaying ? '播放中...' : '试听音频'}</span>
            </button>
          </div>
        ) : (
          <div className="flex min-h-[110px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed theme-border-medium theme-bg-input p-4 text-center">
            <Volume2 size={24} className="theme-text-disabled" />
            <span className="text-[10px] font-semibold theme-text-muted">
              {isPromptConnected ? '准备就绪，等待生成' : '等待语音合成'}
            </span>
          </div>
        )}
      </div>
    </BaseNode>
  );
};
