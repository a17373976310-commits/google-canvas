
import React, { useRef, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { NodeData } from '../../types';
import { BaseNode } from '../BaseNode';
import { Volume2, Pause, PlayCircle, Music, Type } from 'lucide-react';

export const AudioNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef<AudioBufferSourceNode | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const isPromptConnected = !!data.inputs?.prompt;

    const playPCM = async () => {
        if (!data.output) return;
        if (isPlaying) {
            // Stop logic handles both WebAudio and HTMLAudio elements
            if ((audioRef.current as any)?.stop) {
                (audioRef.current as any).stop();
            } else if ((audioRef.current as any)?.pause) {
                (audioRef.current as any).pause();
            }
            setIsPlaying(false);
            return;
        }

        try {
            // Check if output is a direct URL (Standard Audio API)
            if (typeof data.output === 'string' && data.output.startsWith('http')) {
                const audio = new Audio(data.output);
                audio.onended = () => setIsPlaying(false);
                audio.play().catch(e => {
                    console.error('HTML5 Audio playback failed:', e);
                    setIsPlaying(false);
                });
                audioRef.current = audio as any;
                setIsPlaying(true);
                return;
            }

            // Fallback for raw PCM base64 string
            const base64Data = data.output.includes(',') ? data.output.split(',')[1] : data.output;
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
            audioRef.current = source as any;
            setIsPlaying(true);
        } catch (e) {
            console.error('Audio playback failed', e);
            setIsPlaying(false);
        }
    };

    return (
        <BaseNode id={id} data={data} icon={Volume2} color="bg-cyan-500" selected={selected}>
            {/* Target Ports */}
            <div className="flex flex-col py-2">
                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="prompt"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${isPromptConnected ? '!bg-blue-500' : '!bg-[#2a2a3a] group-hover/row:!bg-blue-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <Type size={10} className="text-blue-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">语音提示词 (Prompt)</span>
                    </div>
                </div>
            </div>

            <div className="px-4 pb-4 flex-1 flex flex-col justify-center min-h-[140px]">
                {data.output ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 p-3 bg-cyan-500/5 rounded-xl border border-cyan-500/10">
                            <div className="w-10 h-10 bg-cyan-500/10 rounded-lg flex items-center justify-center">
                                <Music size={18} className="text-cyan-400" />
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <span className="block text-[9px] font-bold text-cyan-400 uppercase tracking-wider truncate">音频已就绪</span>
                                <span className="block text-[8px] text-gray-600 font-mono italic">
                                    {(typeof data.output === 'string' && data.output.startsWith('http')) ? 'URL 媒体播放' : 'PCM 输出 • 24kHz'}
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={playPCM}
                            className={`w-full flex items-center justify-center gap-3 p-4 rounded-xl border transition-all duration-300 transform active:scale-[0.98] ${isPlaying
                                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.1)]'
                                : 'bg-[#0b0b0f] border-[#2a2a3a] text-gray-500 hover:text-white hover:border-gray-500'
                                }`}
                        >
                            {isPlaying ? <Pause size={18} className="animate-pulse" /> : <PlayCircle size={18} />}
                            <span className="text-[10px] font-black uppercase tracking-widest">{isPlaying ? '播放中...' : '试听音频'}</span>
                        </button>
                    </div>
                ) : (
                    <div className="flex-1 bg-[#0b0b0f] rounded-xl border border-dashed border-[#2a2a3a] flex flex-col items-center justify-center gap-3 opacity-40 p-4">
                        <Volume2 size={24} className="text-gray-800" />
                        <span className="text-[10px] text-gray-700 font-bold uppercase text-center">
                            {isPromptConnected ? '准备加速，等待生成...' : '等待语音合成...'}
                        </span>
                    </div>
                )}
            </div>

            <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-cyan-500 !border-2 !border-[#0b0b0f] !right-[-7px]" />
        </BaseNode>
    );
};
