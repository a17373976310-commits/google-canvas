
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
        <div className={`canvas-terminal fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 transition-all duration-300 ease-out max-w-[calc(100vw-128px)] ${isExpanded ? 'w-[720px]' : 'w-[340px]'}`}>
            <div className="theme-bg-elevated border theme-border-subtle rounded-xl theme-shadow-panel backdrop-blur-xl overflow-hidden flex flex-col">
                {/* Header */}
                <div
                    className={`px-3 py-2 flex min-h-10 items-center justify-between cursor-pointer select-none ${isExpanded ? 'border-b theme-border-subtle' : ''}`}
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="flex min-w-0 items-center gap-2.5">
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${logs.some(l => l.level === 'error') ? 'bg-rose-500/10 text-rose-500' : 'bg-indigo-500/10 text-indigo-500'}`}>
                            <Terminal size={13} />
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="text-[11px] font-semibold theme-text-primary">运行日志</span>
                            <div className="flex items-center gap-1.5">
                                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                <span className="text-[10px] theme-text-muted">{logs.length} 条</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={(e) => { e.stopPropagation(); clearLogs(); }}
                            className="rounded-lg p-1.5 theme-text-muted transition-all hover:bg-rose-500/10 hover:text-rose-400"
                            title="清空日志"
                        >
                            <Trash2 size={13} />
                        </button>
                        <div className="p-1.5 theme-text-muted">
                            {isExpanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                        </div>
                    </div>
                </div>

                {/* Console Content */}
                {isExpanded && (
                    <div className="animate-in slide-in-from-bottom-2 duration-300">
                        {/* Tabs */}
                        <div className="flex items-center gap-1 border-b theme-border-subtle theme-bg-secondary px-3 py-2">
                            {(['all', 'info', 'success', 'warn', 'error', 'api'] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`rounded-md px-2.5 py-1.5 text-[9px] font-semibold transition-all ${activeTab === tab
                                        ? 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20'
                                        : 'theme-text-muted hover:theme-text-secondary'
                                        }`}
                                >
                                    {levelLabels[tab]}
                                </button>
                            ))}
                        </div>

                        {/* List */}
                        <div
                            ref={scrollRef}
                            className="h-[240px] overflow-y-auto p-3 pb-6 font-mono text-[11px] leading-6 custom-scrollbar space-y-1 theme-bg-primary"
                        >
                            {filteredLogs.length > 0 ? (
                                filteredLogs.map((log) => (
                                    <div key={log.id} className="group flex items-start gap-4 hover:bg-white/[0.02] -mx-4 px-4 py-1.5 transition-colors border-l-2 border-transparent hover:border-indigo-500/30">
                                        <span className="shrink-0 theme-text-disabled text-[9px] w-14 font-bold tabular-nums mt-0.5">{log.timestamp}</span>
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
                                                    <span className={`break-all leading-relaxed ${log.level === 'error' ? 'text-rose-400' : log.level === 'success' ? 'text-emerald-400' : 'theme-text-primary'}`}>
                                                        {log.message.split('->').map((part, i) => (
                                                            <React.Fragment key={i}>
                                                                {i > 0 && <span className="theme-text-muted mx-1">→</span>}
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
                        <div className="border-t theme-border-subtle theme-bg-secondary px-4 py-2.5 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <ShieldCheck size={10} className="text-emerald-500" />
                                    <span className="text-[8px] font-black theme-text-disabled tracking-widest uppercase">Encrypted Connection</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Clock size={10} className="theme-text-disabled" />
                                    <span className="text-[8px] font-black theme-text-disabled tracking-widest uppercase">Lat: 24ms</span>
                                </div>
                            </div>
                            <span className="text-[8px] font-black theme-text-disabled tracking-[0.2em] uppercase italic underline underline-offset-4 cursor-pointer hover:text-indigo-400 transition-colors">Core Engine v2.5-Flash</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
