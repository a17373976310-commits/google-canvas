
import React, { useState } from 'react';
import { useStore } from '../store';
import { useReactFlow } from 'reactflow';
import {
    X,
    Save,
    Copy,
    Trash2,
    Clock,
    Maximize,
    RotateCcw,
    Eraser,
    FolderOpen
} from 'lucide-react';

interface WorkflowManagerProps {
    onClose: () => void;
}

export const WorkflowManager: React.FC<WorkflowManagerProps> = ({ onClose }) => {
    const {
        savedWorkflows,
        saveWorkflow,
        loadWorkflow,
        cloneWorkflow,
        deleteWorkflow,
        clearCanvas,
        pushNotice
    } = useStore();

    const [newWorkflowName, setNewWorkflowName] = useState('');
    const [copyCount, setCopyCount] = useState('1');
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [pendingClear, setPendingClear] = useState(false);

    const { fitView } = useReactFlow();

    const handleSave = () => {
        if (!newWorkflowName.trim()) {
            pushNotice('warn', '请输入工作流名称');
            return;
        }
        saveWorkflow(newWorkflowName.trim());
        setNewWorkflowName('');
        pushNotice('success', '工作流已保存');
    };

    const handleClear = () => {
        if (!pendingClear) {
            setPendingClear(true);
            pushNotice('warn', '再次点击“清空画布”确认操作');
            return;
        }

        setPendingClear(false);
        clearCanvas();
        pushNotice('warn', '画布已清空');
    };

    const handleDeleteWorkflow = (id: string) => {
        if (pendingDeleteId !== id) {
            setPendingDeleteId(id);
            pushNotice('warn', '再次点击删除按钮确认操作');
            return;
        }

        deleteWorkflow(id);
        setPendingDeleteId(null);
        pushNotice('info', '工作流已删除');
    };

    const handleCloneWorkflow = async (id: string) => {
        const parsed = Number.parseInt(copyCount, 10);
        const count = Number.isFinite(parsed) ? parsed : 1;
        await cloneWorkflow(id, Math.max(1, Math.min(50, count)));
    };

    const handleLoadWorkflow = (id: string) => {
        loadWorkflow(id);
        setPendingDeleteId(null);
        setPendingClear(false);
        pushNotice('success', '工作流已加载');
    };

    const clearPendingStates = () => {
        if (pendingClear) {
            setPendingClear(false);
        }
        if (pendingDeleteId) {
            setPendingDeleteId(null);
        }
    };

    React.useEffect(() => {
        if (!pendingClear && !pendingDeleteId) return;
        const timer = setTimeout(() => {
            setPendingClear(false);
            setPendingDeleteId(null);
        }, 3500);
        return () => clearTimeout(timer);
    }, [pendingClear, pendingDeleteId]);

    const handleClose = () => {
        clearPendingStates();
        onClose();
    };

    const handleFitView = () => {
        fitView({ duration: 800 });
        pushNotice('info', '视口已复位');
    };

    return (
        <div className="absolute top-24 right-8 w-80 bg-[#161621] border border-[#1e1e2d] rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="p-4 border-b border-[#1e1e2d] flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                    <h3 className="font-black text-xs uppercase tracking-widest text-gray-300">配置注册表管理</h3>
                </div>
                <button
                    onClick={handleClose}
                    className="p-1 hover:bg-[#1e1e2d] rounded-lg text-gray-500 hover:text-white transition-colors"
                >
                    <X size={14} />
                </button>
            </div>

            {/* Input Section */}
            <div className="p-4 flex gap-2">
                <div className="flex-1 bg-[#0b0b0f] border border-[#1e1e2d] rounded-xl px-3 py-2 flex items-center shadow-inner">
                    <input
                        type="text"
                        value={newWorkflowName}
                        onChange={(e) => setNewWorkflowName(e.target.value)}
                        placeholder="输入工作流名称..."
                        className="w-full bg-transparent border-none outline-none text-xs text-gray-300 placeholder:text-gray-700"
                        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    />
                </div>
                <button
                    onClick={handleSave}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-black text-xs px-4 py-2 rounded-xl transition-all shadow-lg active:scale-95 whitespace-nowrap"
                >
                    保存
                </button>
            </div>

            <div className="px-4 pb-3 flex items-center gap-2">
                <div className="text-[9px] text-gray-600 font-black uppercase tracking-widest whitespace-nowrap">复制份数</div>
                <input
                    type="number"
                    min={1}
                    max={50}
                    value={copyCount}
                    onChange={(e) => setCopyCount(e.target.value)}
                    className="w-20 bg-[#0b0b0f] border border-[#1e1e2d] rounded-lg px-2 py-1.5 text-[11px] text-gray-300 outline-none focus:border-indigo-500/40"
                />
                <span className="text-[9px] text-gray-700">(1-50)</span>
            </div>

            {/* List Section */}
            <div className="px-4 py-2 max-h-64 overflow-y-auto custom-scrollbar">
                {savedWorkflows.length === 0 ? (
                    <div className="py-8 text-center text-gray-700">
                        <FolderOpen size={32} className="mx-auto mb-2 opacity-20" />
                        <p className="text-[10px] uppercase font-bold tracking-tighter italic">暂无保存记录</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {savedWorkflows.map((wf, index) => (
                            <div
                                key={wf.id}
                                className="group p-3 bg-[#0b0b0f]/50 hover:bg-[#1e1e2d] border border-transparent hover:border-[#2a2a3a] rounded-xl transition-all cursor-pointer flex items-center gap-3 relative overflow-hidden"
                                onClick={() => handleLoadWorkflow(wf.id)}
                            >
                                <span className="text-lg font-black text-gray-800 group-hover:text-blue-500/30 transition-colors">
                                    {index + 1}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-bold text-gray-400 group-hover:text-white transition-colors truncate">
                                        {wf.name}
                                    </p>
                                    <p className="text-[8px] text-gray-600 mt-0.5 flex items-center gap-1 font-mono uppercase">
                                        <Clock size={8} /> {wf.timestamp}
                                    </p>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void handleCloneWorkflow(wf.id);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-all bg-indigo-500/10 hover:bg-indigo-500 text-indigo-300 hover:text-white"
                                    title="复制工作流"
                                >
                                    <Copy size={10} />
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteWorkflow(wf.id);
                                    }}
                                    className={`opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-all ${pendingDeleteId === wf.id ? 'opacity-100 bg-rose-500 text-white' : 'bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white'}`}
                                >
                                    <Trash2 size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-[#1e1e2d] bg-[#0b0b0f]/30 flex gap-2">
                <button
                    onClick={handleFitView}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[#1e1e2d] hover:bg-[#2a2a3a] text-gray-400 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border border-transparent hover:border-[#3a3a4a]"
                    title="视口复位"
                >
                    <RotateCcw size={12} />
                    <span>视口复位</span>
                </button>
                <button
                    onClick={handleClear}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${pendingClear ? 'bg-rose-500 text-white border-rose-500/60' : 'bg-[#1e1e2d] hover:bg-rose-500/10 text-gray-400 hover:text-rose-500 border-transparent hover:border-rose-500/20'}`}
                    title="清空画布"
                >
                    <Eraser size={12} />
                    <span>{pendingClear ? '再次确认' : '清空画布'}</span>
                </button>
            </div>
        </div>
    );
};
