
import React from 'react';
import { useStore } from '../store';
import { NodeData, NODE_MODALITIES, NodeType, NODE_CAPABILITIES, NodeCapability } from '../types';
import {
  CheckCircle,
  AlertCircle,
  Loader2,
  Trash2,
  GripHorizontal,
  Lock,
  Unlock,
  Play,
  SkipForward
} from 'lucide-react';
import { NodeResizer, useUpdateNodeInternals } from 'reactflow';

interface BaseNodeProps {
  children: React.ReactNode;
  data: NodeData;
  id: string;
  icon: React.ElementType;
  color: string;
  selected?: boolean;
}

import { useShallow } from 'zustand/react/shallow';

const ModelSelector = ({ nodeId, type, currentModel }: { nodeId: string; type: NodeType; currentModel?: string }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const getModels = useStore(useShallow(state => state.getModelsForNode));
  const updateNodeData = useStore(useShallow(state => state.updateNodeData));
  const models = getModels(type);

  if (models.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className="flex items-center gap-2 px-3 py-1 bg-white/5 hover:bg-indigo-500/20 border border-white/10 hover:border-indigo-500/50 rounded-full transition-all group/model"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
        <span className="text-[9px] font-black text-indigo-300 uppercase tracking-widest">{currentModel || '点击选择模型'}</span>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full right-0 mt-2 w-48 bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl shadow-2xl z-[70] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="px-3 py-2 border-b border-[#2a2a3a] bg-white/[0.02]">
              <span className="text-[9px] font-black text-gray-500 uppercase tracking-[0.2em]">可用模型清单</span>
            </div>
            <div className="max-h-60 overflow-y-auto py-1 scrollbar-hide">
              {models.map(m => (
                <button
                  key={m}
                  className={`w-full px-4 py-2.5 text-left text-[11px] font-bold transition-all hover:bg-indigo-500/10 ${m === currentModel ? 'text-indigo-400 bg-indigo-500/5' : 'text-gray-400 hover:text-white'}`}
                  onClick={() => {
                    updateNodeData(nodeId, { config: { modelId: m } });
                    setIsOpen(false);
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export const BaseNode: React.FC<BaseNodeProps> = ({ children, data, id, icon: Icon, color, selected }) => {
  const { onNodesChange, updateNodeData, executeSingleNode, draggedModel, setDraggedModel, isDevMode, unlockedNodeIds } = useStore(useShallow((state) => ({
    onNodesChange: state.onNodesChange,
    updateNodeData: state.updateNodeData,
    executeSingleNode: state.executeSingleNode,
    draggedModel: state.draggedModel,
    setDraggedModel: state.setDraggedModel,
    isDevMode: state.isDevMode,
    unlockedNodeIds: state.unlockedNodeIds
  })));
  const updateNodeInternals = useUpdateNodeInternals();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const rafRef = React.useRef<number | null>(null);

  const isLocked = data.security?.isLocked;
  const isAuthorized = isDevMode || unlockedNodeIds.has(id);

  const handleDelete = () => onNodesChange([{ type: 'remove', id }]);
  const modality = NODE_MODALITIES[data.type];
  const capability = NODE_CAPABILITIES[data.type];
  const canRunIndividually = modality === 'ai'
    || data.type === NodeType.TABLE_PARSE
    || data.type === NodeType.TASK_SELECT
    || data.type === NodeType.BATCH_EXECUTE;

  // Neural Handshake Logic
  const isCompatible = draggedModel && draggedModel.capability === capability;
  const isMismatched = draggedModel && draggedModel.capability !== capability && capability !== NodeCapability.UTILITY;
  const [isHoveredWithCompatible, setIsHoveredWithCompatible] = React.useState(false);

  const scheduleInternalsRefresh = React.useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      updateNodeInternals(id);
      rafRef.current = null;
    });
  }, [id, updateNodeInternals]);

  React.useLayoutEffect(() => {
    scheduleInternalsRefresh();
  }, [
    scheduleInternalsRefresh,
    selected,
    data.status,
    data.progress,
    data.error,
    data.isSkipped,
    data.output,
    data.inputs,
  ]);

  React.useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      scheduleInternalsRefresh();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [scheduleInternalsRefresh]);

  React.useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    if (isCompatible && draggedModel) {
      e.preventDefault();
      updateNodeData(id, { config: { ...data.config, modelId: draggedModel.id } });
      setIsHoveredWithCompatible(false);
      setDraggedModel(null);
    }
  };

  const handleInteractivePointerCapture = (e: React.PointerEvent | React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (target.closest('input, textarea, select, button, label, [data-node-interactive="true"]')) {
      e.stopPropagation();
    }
  };

  return (
    <div
      ref={rootRef}
      onPointerDownCapture={handleInteractivePointerCapture}
      onMouseDownCapture={handleInteractivePointerCapture}
      onDragOver={(e) => {
        if (isCompatible) {
          e.preventDefault();
          setIsHoveredWithCompatible(true);
        }
      }}
      onDragLeave={() => setIsHoveredWithCompatible(false)}
      onDrop={handleDrop}
      className={`h-full min-w-[200px] relative group/node flex flex-col transition-all duration-300 ${isHoveredWithCompatible ? 'scale-105 z-[100]' :
        isMismatched ? 'opacity-20 grayscale brightness-50' :
          data.isSkipped ? 'opacity-60 saturate-50' :
            data.status === 'running' ? 'scale-[1.01]' : ''
        }`}
    >
      {/* Node Resizer - Outside Overflow Container to be visible */}
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={100}
        lineStyle={{ borderStyle: 'dashed', borderWidth: 1 }}
        lineClassName="!border-indigo-500/30"
        handleClassName="!h-2.5 !w-2.5 !bg-[#1a1a24] !border-[1.5px] !border-indigo-500 !rounded-full !shadow-[0_0_10px_rgba(99,102,241,0.5)] transition-transform hover:scale-125"
      />

      {/* Main Content Container - Handles Overflow & Styling */}
      <div className={`absolute inset-0 flex flex-col overflow-visible rounded-2xl shadow-2xl bg-[#1a1a24] border-2 ${isHoveredWithCompatible ? 'border-green-500 ring-8 ring-green-500/20' :
        isMismatched ? 'border-[#2a2a3a]' :
          data.status === 'running' ? 'border-indigo-500 ring-4 ring-indigo-500/10' :
            data.isSkipped ? 'border-amber-500/40 border-dashed' :
              data.status === 'success' ? 'border-emerald-500/30' :
                data.status === 'error' ? 'border-rose-500/50' : 'border-[#2a2a3a]'
        }`}>

        {isHoveredWithCompatible && (
          <div className="absolute inset-0 bg-green-500/10 pointer-events-none flex items-center justify-center z-[110] border-4 border-green-500 rounded-2xl">
            <div className="bg-green-500 text-black px-4 py-2 rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-2xl animate-bounce">
              准备就绪 (可投放)
            </div>
          </div>
        )}

        {/* Running Glow Effect */}
        {data.status === 'running' && (
          <div className="absolute top-0 left-0 w-full h-1 overflow-hidden z-20 rounded-t-2xl">
            <div className="w-full h-full bg-indigo-500 animate-[loading_1.5s_infinite_linear]" />
          </div>
        )}

        {data.isSkipped && (
          <div className="absolute top-0 left-0 z-20 px-2 py-0.5 rounded-br-lg bg-amber-500/20 border-r border-b border-amber-500/30">
            <span className="text-[8px] font-black text-amber-300 uppercase tracking-widest">Skip</span>
          </div>
        )}

        {data.status === 'running' && (data.type === NodeType.AI_IMAGE || data.type === NodeType.AI_VIDEO) && (
          <div className="px-4 py-2 border-b border-indigo-500/15 bg-indigo-500/[0.04]">
            <div className="flex items-center justify-between text-[9px] font-bold tracking-wider uppercase">
              <span className="text-indigo-300">异步任务处理中</span>
              <span className="text-indigo-200">{Math.max(1, Math.min(99, Math.floor(data.progress || 1)))}%</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-[#0b0b0f] border border-indigo-500/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-indigo-500 transition-[width] duration-500"
                style={{ width: `${Math.max(1, Math.min(99, Math.floor(data.progress || 1)))}%` }}
              />
            </div>
          </div>
        )}

        {/* Header */}
        <div className={`px-4 py-2 flex items-center justify-between ${color} bg-opacity-[0.03] border-b border-[#2a2a3a]/50 backdrop-blur-md shrink-0 rounded-t-2xl`}>
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg ${color.replace('text-', 'bg-')} bg-opacity-10 shadow-inner flex items-center justify-center`}>
              {isLocked ? (isAuthorized ? <Unlock size={12} className="text-orange-400" /> : <Lock size={12} className="text-rose-500" />) : <Icon size={12} className={color.replace('bg-', 'text-')} />}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-[11px] text-white/90 block leading-tight">{data.label}</span>
                {isLocked && (
                  <div className={`px-1 py-0.5 rounded text-[6px] font-black uppercase tracking-tighter ${isAuthorized ? 'bg-orange-500/20 text-orange-400 border border-orange-500/20' : 'bg-rose-500/20 text-rose-500 border border-rose-500/20'}`}>
                    Vault
                  </div>
                )}
              </div>
              <span className="font-medium text-[7px] text-gray-600 uppercase tracking-widest block leading-none mt-0.5 opacity-50">{modality === 'ai' ? 'AI 节点引擎' : '工作流工具插件'}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Single Node Execution Trigger - Only for AI Nodes */}
            {canRunIndividually && (
              <button
                onClick={(e) => { e.stopPropagation(); executeSingleNode(id); }}
                disabled={data.status === 'running' || !!data.isSkipped || (isLocked && !isAuthorized)}
                className={`p-1.5 rounded-lg transition-all ${data.status === 'running' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg shadow-indigo-500/20 active:scale-90 disabled:opacity-30 disabled:grayscale disabled:pointer-events-none'}`}
                title="独立运行此节点"
              >
                <Play size={10} fill="currentColor" />
              </button>
            )}

            <button
              onClick={(e) => { e.stopPropagation(); updateNodeData(id, { isSkipped: !data.isSkipped, status: 'idle', error: undefined, progress: undefined }); }}
              className={`p-1.5 rounded-lg transition-all ${data.isSkipped ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-gray-500 hover:text-amber-300 hover:bg-amber-500/10'}`}
              title={data.isSkipped ? '恢复节点 (S)' : '跳过节点 (S)'}
            >
              <SkipForward size={10} />
            </button>

            {modality === 'ai' && <ModelSelector nodeId={id} type={data.type} currentModel={data.config.modelId} />}
            {data.status === 'running' && <Loader2 size={12} className="animate-spin text-indigo-400" />}
            {data.status === 'success' && <CheckCircle size={12} className="text-emerald-400" />}
            {data.status === 'error' && <AlertCircle size={12} className="text-rose-400" />}
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              className="p-1 rounded text-gray-600 hover:text-rose-400 hover:bg-rose-400/10 transition-all opacity-0 group-hover/node:opacity-100"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="nodrag nopan nowheel flex-1 flex flex-col relative overflow-hidden bg-[#0b0b0f]/50">
          {children}
        </div>

        {/* Error Message */}
        {data.error && (
          <div className="px-5 py-3 bg-rose-500/5 text-rose-400 text-[10px] border-t border-rose-500/10 font-medium leading-relaxed italic shrink-0 break-all whitespace-pre-wrap max-h-24 overflow-y-auto">
            错误：{data.error}
          </div>
        )}
      </div>

      <style>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};
