
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { LogEntry, LogLevel } from '../types';
import {
    Terminal,
    Trash2,
    ChevronDown,
    ChevronUp,
    Activity,
    ShieldCheck,
    Clock,
    ExternalLink
} from 'lucide-react';

export const TerminalOutput = () => {
    const { logs, clearLogs } = useStore();
    const [activeTab, setActiveTab] = useState<LogLevel | 'all'>('all');
    const [isExpanded, setIsExpanded] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs, isExpanded, activeTab]);

    const filteredLogs = useMemo(() => {
        if (activeTab === 'all') return logs;
        return logs.filter(log => log.level === activeTab);
    }, [logs, activeTab]);

    const levelStyles: Record<LogLevel, string> = {
        info: 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]',
        success: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]',
        warn: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]',
        error: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]',
        api: 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]'
    };

    const levelLabels: Record<LogLevel | 'all', string> = {
        all: 'ALL',
        info: 'INFO',
        success: 'SUCCESS',
        warn: 'WARN',
        error: 'ERROR',
        api: 'API'
    };

    return (
        <div className={`fixed bottom-4 md:bottom-8 left-1/2 -translate-x-1/2 z-[100] transition-all duration-500 ease-out w-[calc(100vw-24px)] ${isExpanded ? 'max-w-[900px]' : 'max-w-[440px]'}`}>
            <div className="bg-[#0b0b0f]/95 border border-[#1e1e2d] rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl overflow-hidden flex flex-col">
                {/* Header */}
                <div
                    className="p-4 flex items-center justify-between cursor-pointer select-none border-b border-[#1e1e2d]"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="flex items-center gap-3">
                        <div className={`p-1.5 rounded-lg ${logs.some(l => l.level === 'error') ? 'bg-rose-500/10 text-rose-500' : 'bg-indigo-500/10 text-indigo-400'}`}>
                            <Terminal size={14} />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-white tracking-widest uppercase italic">工作流实时日志 (REAL-TIME LOGS)</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="text-[8px] text-gray-500 font-bold uppercase tracking-tight">System Monitor Active • {logs.length} Entries</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={(e) => { e.stopPropagation(); clearLogs(); }}
                            className="p-2 hover:bg-rose-500/10 text-gray-600 hover:text-rose-400 transition-all rounded-xl"
                            title="清空日志"
                        >
                            <Trash2 size={14} />
                        </button>
                        <div className="p-2 text-gray-500">
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </div>
                    </div>
                </div>

                {/* Console Content */}
                {isExpanded && (
                    <div className="animate-in slide-in-from-bottom-2 duration-300">
                        {/* Tabs */}
                        <div className="flex items-center gap-1 px-4 py-2 bg-black/40 border-b border-[#1e1e2d]">
                            {(['all', 'info', 'success', 'warn', 'error', 'api'] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black tracking-tight transition-all uppercase ${activeTab === tab
                                        ? 'bg-white/5 text-white border border-white/10'
                                        : 'text-gray-600 hover:text-gray-400'
                                        }`}
                                >
                                    {levelLabels[tab]}
                                </button>
                            ))}
                        </div>

                        {/* List */}
                        <div
                            ref={scrollRef}
                            className="h-[260px] md:h-[300px] overflow-y-auto p-4 pb-8 font-mono text-[11px] leading-6 custom-scrollbar space-y-2 bg-black/20"
                        >
                            {filteredLogs.length > 0 ? (
                                filteredLogs.map((log) => (
                                    <div key={log.id} className="group flex items-start gap-4 hover:bg-white/[0.02] -mx-4 px-4 py-1.5 transition-colors border-l-2 border-transparent hover:border-indigo-500/30">
                                        <span className="shrink-0 text-gray-700 text-[9px] w-14 font-bold tabular-nums mt-0.5">{log.timestamp}</span>
                                        <div className="flex items-start gap-3 flex-1 overflow-hidden">
                                            {/* Colored Dot Indicator */}
                                            <div className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${levelStyles[log.level]}`} />

                                            <div className="flex-1 space-y-1 overflow-hidden">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {log.nodeLabel && (
                                                        <span className="shrink-0 bg-indigo-500/10 border border-indigo-500/20 text-[8px] text-indigo-400 px-2 py-0.5 rounded font-black uppercase tracking-tighter shadow-sm">
                                                            {log.nodeLabel}
                                                        </span>
                                                    )}
                                                    <span className={`break-all leading-relaxed ${log.level === 'error' ? 'text-rose-400' : log.level === 'success' ? 'text-emerald-400' : 'text-gray-300'}`}>
                                                        {log.message.split('->').map((part, i) => (
                                                            <React.Fragment key={i}>
                                                                {i > 0 && <span className="text-gray-600 mx-1">→</span>}
                                                                {part.includes('http') ? <span className="text-indigo-400/80 italic underline decoration-indigo-400/20 underline-offset-4">{part}</span> : part}
                                                            </React.Fragment>
                                                        ))}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center opacity-10 gap-3">
                                    <Activity size={32} />
                                    <span className="text-[10px] font-bold uppercase tracking-[0.3em]">No Log Data</span>
                                </div>
                            )}
                        </div>

                        {/* Footer Status */}
                        <div className="p-3 px-6 bg-[#0b0b0f] border-t border-[#1e1e2d] flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <ShieldCheck size={10} className="text-emerald-500" />
                                    <span className="text-[8px] font-black text-gray-700 tracking-widest uppercase">Encrypted Connection</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Clock size={10} className="text-gray-700" />
                                    <span className="text-[8px] font-black text-gray-700 tracking-widest uppercase">Lat: 24ms</span>
                                </div>
                            </div>
                            <span className="text-[8px] font-black text-gray-800 tracking-[0.2em] uppercase italic underline underline-offset-4 cursor-pointer hover:text-indigo-400 transition-colors">Core Engine v2.5-Flash</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
