import React from 'react';
import { createPortal } from 'react-dom';
import { Handle, NodeResizer, Position, useStoreApi, useUpdateNodeInternals } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import {
  AlertCircle,
  CheckCircle,
  GripHorizontal,
  Loader2,
  Lock,
  MoreHorizontal,
  Play,
  SkipForward,
  Trash2,
  Unlock,
} from 'lucide-react';
import { getNodeSpec, NodeHandleSpec } from '../config/nodeSpecs';
import { useStore } from '../store';
import { NodeCapability, NODE_CAPABILITIES, NODE_MODALITIES, NodeData, NodeType } from '../types';

interface BaseNodeProps {
  children: React.ReactNode;
  data: NodeData;
  id: string;
  icon: React.ElementType;
  color: string;
  selected?: boolean;
}

type PortStyle = React.CSSProperties & Record<'--port-color' | '--port-muted' | '--port-text', string>;

const positionMap: Record<NodeHandleSpec['side'], Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

const getHandleOffset = (index: number, count: number) => {
  if (count <= 1) return 50;
  return ((index + 1) / (count + 1)) * 100;
};

const getPortStyle = (
  handle: NodeHandleSpec,
  offset: number
): PortStyle => {
  const style: PortStyle = {
    '--port-color': `var(--node-${handle.color}-solid)`,
    '--port-muted': `var(--node-${handle.color}-muted)`,
    '--port-text': `var(--node-${handle.color}-text)`,
  };

  if (handle.side === 'left' || handle.side === 'right') {
    style.top = `${offset}%`;
  } else {
    style.left = `${offset}%`;
  }

  return style;
};

const isMatchingHandle = (edgeHandle: string | null | undefined, specHandle: string | undefined) => {
  return (edgeHandle || null) === (specHandle || null);
};

const ModelSelector = ({ nodeId, type, currentModel }: { nodeId: string; type: NodeType; currentModel?: string }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [dropdownStyle, setDropdownStyle] = React.useState<React.CSSProperties>({});
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const getModels = useStore(useShallow((state) => state.getModelsForNode));
  const updateNodeData = useStore(useShallow((state) => state.updateNodeData));
  const models = getModels(type);
  const filteredModels = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return models;
    return models.filter((model) => model.toLowerCase().includes(normalizedQuery));
  }, [models, query]);
  const capabilityLabel = type === NodeType.AI_IMAGE
    ? '图像'
    : type === NodeType.AI_AUDIO
      ? '音频'
      : type === NodeType.AI_VIDEO
      ? '视频'
      : '文本';

  const updateDropdownPosition = React.useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const dropdownWidth = Math.min(280, window.innerWidth - 24);
    const left = Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - dropdownWidth - 12)
    );
    const preferredTop = rect.bottom + 8;
    const opensUp = preferredTop + 306 > window.innerHeight && rect.top > 320;

    setDropdownStyle({
      left,
      top: opensUp ? undefined : preferredTop,
      bottom: opensUp ? Math.max(12, window.innerHeight - rect.top + 8) : undefined,
      width: dropdownWidth,
    });
  }, []);

  React.useLayoutEffect(() => {
    if (!isOpen) return undefined;

    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);

    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [isOpen, updateDropdownPosition]);

  React.useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setQuery('');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (models.length === 0) return null;

  return (
    <div className="canvas-model-selector relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        data-node-interactive="true"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => {
          event.stopPropagation();
          setIsOpen((open) => !open);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        className="canvas-model-chip"
        title={currentModel || '选择模型'}
      >
        <span className="canvas-model-dot" />
        <span>{currentModel || '选择模型'}</span>
      </button>

      {isOpen && createPortal(
        <>
          <div
            className="canvas-model-dropdown-scrim nodrag nopan"
            onClick={() => {
              setIsOpen(false);
              setQuery('');
            }}
          />
          <div
            className="canvas-model-dropdown nodrag nopan"
            style={dropdownStyle}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="canvas-model-dropdown-header">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold theme-text-muted">可用模型</span>
                <span className="canvas-model-capability">{capabilityLabel}</span>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onPointerDown={(event) => event.stopPropagation()}
                placeholder="搜索模型..."
                className="canvas-model-search"
              />
            </div>
            <div className="canvas-model-option-list custom-scrollbar">
              {filteredModels.map((model) => (
                <button
                  key={model}
                  type="button"
                  className={`canvas-model-option ${model === currentModel ? 'is-selected' : ''}`}
                  title={model}
                  onClick={(event) => {
                    event.stopPropagation();
                    updateNodeData(nodeId, { config: { modelId: model } });
                    setIsOpen(false);
                    setQuery('');
                  }}
                >
                  <span>{model}</span>
                </button>
              ))}
              {filteredModels.length === 0 && (
                <div className="canvas-model-empty">没有匹配的模型</div>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

export const BaseNode: React.FC<BaseNodeProps> = ({ children, data, id, icon: Icon, color, selected }) => {
  const {
    onNodesChange,
    onSelectionChange,
    updateNodeData,
    executeSingleNode,
    draggedModel,
    setDraggedModel,
    isDevMode,
    unlockedNodeIds,
    edges,
    selectedNodeId,
  } = useStore(useShallow((state) => ({
    onNodesChange: state.onNodesChange,
    onSelectionChange: state.onSelectionChange,
    updateNodeData: state.updateNodeData,
    executeSingleNode: state.executeSingleNode,
    draggedModel: state.draggedModel,
    setDraggedModel: state.setDraggedModel,
    isDevMode: state.isDevMode,
    unlockedNodeIds: state.unlockedNodeIds,
    edges: state.edges,
    selectedNodeId: state.selectedNodeId,
  })));
  const reactFlowStore = useStoreApi();
  const updateNodeInternals = useUpdateNodeInternals();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const [isHoveredWithCompatible, setIsHoveredWithCompatible] = React.useState(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = React.useState(false);

  const spec = React.useMemo(() => getNodeSpec(data.type), [data.type]);
  const groupedHandles = React.useMemo(() => {
    const groups = new Map<string, NodeHandleSpec[]>();
    spec.handles.forEach((handle) => {
      const key = `${handle.kind}-${handle.side}`;
      groups.set(key, [...(groups.get(key) || []), handle]);
    });
    return groups;
  }, [spec.handles]);

  const isLocked = data.security?.isLocked;
  const isAuthorized = isDevMode || unlockedNodeIds.has(id);
  const modality = NODE_MODALITIES[data.type];
  const capability = NODE_CAPABILITIES[data.type];
  const canRunIndividually = modality === 'ai'
    || data.type === NodeType.TABLE_PARSE
    || data.type === NodeType.TASK_SELECT
    || data.type === NodeType.BATCH_EXECUTE
    || data.type === NodeType.STYLE_GUIDE
    || data.type === NodeType.DESIGN_BOARD;
  const isAdjacent = !!selectedNodeId && selectedNodeId !== id && edges.some((edge) => (
    (edge.source === selectedNodeId && edge.target === id)
    || (edge.target === selectedNodeId && edge.source === id)
  ));
  const isCompatible = draggedModel && draggedModel.capability === capability;
  const isMismatched = draggedModel && draggedModel.capability !== capability && capability !== NodeCapability.UTILITY;

  const scheduleInternalsRefresh = React.useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
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
    spec.handles,
  ]);

  React.useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    element
      .querySelectorAll('input, textarea, select, button, a, [contenteditable="true"], [data-node-interactive="true"]')
      .forEach((interactiveElement) => {
        interactiveElement.classList.add('nodrag', 'nopan');
      });
  });

  React.useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => scheduleInternalsRefresh());
    observer.observe(element);

    return () => observer.disconnect();
  }, [scheduleInternalsRefresh]);

  React.useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const selectNodeFromPointer = React.useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const state = reactFlowStore.getState();
    if (state.nodeInternals.has(id)) {
      state.addSelectedNodes([id]);
    }
    onSelectionChange(id);
  }, [id, onSelectionChange, reactFlowStore]);

  const isEditingTarget = (target: HTMLElement | null) => {
    if (!target) return false;
    return !!target.closest('input, textarea, select, button, a, [contenteditable="true"], [data-node-interactive="true"]');
  };

  const handlePointerDownCapture = (event: React.PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (isEditingTarget(target)) {
      event.stopPropagation();
      return;
    }
    selectNodeFromPointer(event);
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!isCompatible || !draggedModel) return;
    event.preventDefault();
    updateNodeData(id, { config: { ...data.config, modelId: draggedModel.id } });
    setIsHoveredWithCompatible(false);
    setDraggedModel(null);
  };

  const renderHandles = () => spec.handles.map((handle) => {
    const key = `${handle.kind}-${handle.side}`;
    const siblings = groupedHandles.get(key) || [];
    const index = siblings.findIndex((item) => item === handle);
    const offset = getHandleOffset(index, siblings.length);
    const style = getPortStyle(handle, offset);
    const connected = edges.some((edge) => handle.kind === 'source'
      ? edge.source === id && isMatchingHandle(edge.sourceHandle, handle.id)
      : edge.target === id && isMatchingHandle(edge.targetHandle, handle.id));

    return (
      <React.Fragment key={`${handle.kind}-${handle.id || 'default'}-${handle.side}`}>
        <Handle
          id={handle.id}
          type={handle.kind}
          position={positionMap[handle.side]}
          className={`canvas-node-port canvas-node-port-${handle.kind} canvas-node-port-${handle.side}`}
          data-connected={connected ? 'true' : 'false'}
          data-port-color={handle.color}
          style={style}
        />
        <div
          className={`canvas-node-port-label canvas-node-port-label-${handle.side}`}
          data-connected={connected ? 'true' : 'false'}
          style={style}
        >
          {handle.label}
        </div>
      </React.Fragment>
    );
  });

  const handleDelete = () => onNodesChange([{ type: 'remove', id }]);
  const iconClassName = color.replace('bg-', 'text-');

  return (
    <div
      ref={rootRef}
      data-node-id={id}
      data-node-type={data.type}
      data-node-status={data.status || 'idle'}
      data-adjacent={isAdjacent ? 'true' : 'false'}
      data-testid="canvas-node"
      onPointerDownCapture={handlePointerDownCapture}
      onDragOver={(event) => {
        if (!isCompatible) return;
        event.preventDefault();
        setIsHoveredWithCompatible(true);
      }}
      onDragLeave={() => setIsHoveredWithCompatible(false)}
      onDrop={handleDrop}
      className={`node-wrapper canvas-node relative flex h-full min-w-[220px] flex-col transition-all duration-150 ${isHoveredWithCompatible ? 'scale-[1.01] z-[100]' :
        isMismatched ? 'opacity-20 grayscale brightness-50' :
          data.isSkipped ? 'opacity-60 saturate-50' :
            data.status === 'running' ? 'scale-[1.005]' : ''
        }`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={120}
        lineStyle={{ borderStyle: 'dashed', borderWidth: 1 }}
        lineClassName="canvas-node-resizer-line"
        handleClassName="canvas-node-resizer-handle !h-2 !w-2 theme-bg-node !border-[1.5px] !rounded-full transition-transform hover:scale-125"
      />

      {renderHandles()}

      <div className={`canvas-node-card absolute inset-0 flex flex-col overflow-hidden rounded-lg border theme-bg-node theme-shadow-node ${isHoveredWithCompatible ? 'border-green-500 ring-4 ring-green-500/15' :
        isMismatched ? 'theme-border-node' :
          data.status === 'running' ? 'border-indigo-500 ring-2 ring-indigo-500/10' :
            data.isSkipped ? 'border-amber-500/40 border-dashed' :
              data.status === 'success' ? 'border-emerald-500/30' :
                data.status === 'error' ? 'border-rose-500/50' : 'theme-border-node'
        }`}>
        {isHoveredWithCompatible && (
          <div className="pointer-events-none absolute inset-0 z-[110] flex items-center justify-center rounded-lg border-2 border-green-500 bg-green-500/10">
            <div className="rounded-md bg-green-500 px-3 py-1.5 text-[10px] font-semibold text-black shadow-2xl">
              准备投放模型
            </div>
          </div>
        )}

        {data.status === 'running' && (
          <div className="absolute left-0 top-0 z-20 h-0.5 w-full overflow-hidden rounded-t-lg">
            <div className="canvas-node-running-bar h-full w-full animate-[loading_1.5s_infinite_linear]" />
          </div>
        )}

        <div className="canvas-node-toolbar">
          <div className="canvas-node-identity canvas-node-drag-handle" title="拖动节点">
            <div className={`canvas-node-icon ${color} flex items-center justify-center rounded-md bg-opacity-10 p-1.5`}>
              {isLocked
                ? (isAuthorized ? <Unlock size={12} className="text-orange-400" /> : <Lock size={12} className="text-rose-500" />)
                : <Icon size={12} className={iconClassName} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="canvas-node-title block truncate theme-text-primary">{data.label}</span>
                {isLocked && (
                  <div className={`canvas-node-lock-badge ${isAuthorized ? 'border border-orange-500/20 bg-orange-500/20 text-orange-400' : 'border border-rose-500/20 bg-rose-500/20 text-rose-500'}`}>
                    Vault
                  </div>
                )}
              </div>
            </div>
            <GripHorizontal size={12} className="canvas-node-grip theme-text-muted" />
          </div>

          <div className="canvas-node-action-strip nodrag nopan">
            {canRunIndividually && (
              <button
                type="button"
                data-node-interactive="true"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  if (data.status !== 'running' && !data.isSkipped && !(isLocked && !isAuthorized)) {
                    executeSingleNode(id);
                  }
                }}
                onClick={(event) => event.stopPropagation()}
                disabled={data.status === 'running' || !!data.isSkipped || (isLocked && !isAuthorized)}
                className="canvas-node-action canvas-node-run-action"
                title="独立运行此节点"
              >
                <Play size={10} fill="currentColor" />
              </button>
            )}

            {data.status === 'running' && <Loader2 size={12} className="animate-spin text-indigo-400" />}
            {data.status === 'success' && <CheckCircle size={12} className="text-emerald-400" />}
            {data.status === 'error' && <AlertCircle size={12} className="text-rose-400" />}

            <div className="relative">
              <button
                type="button"
                data-node-interactive="true"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  setIsActionMenuOpen((open) => !open);
                }}
                onClick={(event) => event.stopPropagation()}
                className="canvas-node-action"
                title="更多操作"
              >
                <MoreHorizontal size={12} />
              </button>
              {isActionMenuOpen && (
                <>
                  <div className="fixed inset-0 z-[60] nodrag nopan" onClick={() => setIsActionMenuOpen(false)} />
                  <div className="canvas-node-action-menu absolute right-0 top-full z-[70] mt-2 overflow-hidden rounded-lg border theme-border-medium theme-bg-elevated theme-shadow-panel nodrag nopan">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        updateNodeData(id, { isSkipped: !data.isSkipped, status: 'idle', error: undefined, progress: undefined });
                        setIsActionMenuOpen(false);
                      }}
                      className="canvas-node-menu-item"
                    >
                      <SkipForward size={13} />
                      <span>{data.isSkipped ? '恢复节点' : '跳过节点'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDelete();
                        setIsActionMenuOpen(false);
                      }}
                      className="canvas-node-menu-item text-rose-400 hover:bg-rose-500/10"
                    >
                      <Trash2 size={13} />
                      <span>删除节点</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {modality === 'ai' && (
          <div className="canvas-node-model-row nodrag nopan">
            <span className="canvas-node-model-label">模型</span>
            <ModelSelector nodeId={id} type={data.type} currentModel={data.config.modelId} />
          </div>
        )}

        {data.status === 'running' && (data.type === NodeType.AI_IMAGE || data.type === NodeType.AI_VIDEO || data.type === NodeType.TEXT_RECOGNITION || data.type === NodeType.DESIGN_BOARD) && (
          <div className="canvas-node-progress border-b px-4 py-2">
            <div className="flex items-center justify-between text-[9px] font-bold">
              <span>{data.meta?.progressLabel || '异步任务处理中'}</span>
              <span>{Math.max(1, Math.min(99, Math.floor(data.progress || 1)))}%</span>
            </div>
            <div className="canvas-node-progress-track mt-1 h-1.5 overflow-hidden rounded-full border theme-bg-input">
              <div
                className="canvas-node-progress-fill h-full rounded-full transition-[width] duration-500"
                style={{ width: `${Math.max(1, Math.min(99, Math.floor(data.progress || 1)))}%` }}
              />
            </div>
          </div>
        )}

        <div className="canvas-node-body nowheel relative flex min-h-0 flex-1 flex-col overflow-hidden theme-bg-node-content">
          {children}
        </div>

        {data.error && (
          <div className="canvas-node-error">
            <AlertCircle size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{data.error}</span>
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
