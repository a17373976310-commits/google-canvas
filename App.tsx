
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  MiniMap,
  Panel,
  ReactFlowProvider,
  BackgroundVariant,
  ConnectionMode,
  SelectionMode,
  useReactFlow // Added useReactFlow for onDrop fix
} from 'reactflow';

import { useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ApiSettingsModal } from './components/ApiSettingsModal';
import { TerminalOutput } from './components/TerminalOutput';
import { WorkflowManager } from './components/WorkflowManager';
import { ImageLightbox } from './components/ImageLightbox';
import { NoticeStack } from './components/NoticeStack';
import { HistoryDrawer } from './components/HistoryDrawer';
import { QuickNodeMenu } from './components/QuickNodeMenu';
import { CanvasAgentPanel } from './components/CanvasAgentPanel';
import { SoftEdge } from './components/SoftEdge';
import { ModelHub } from './components/ModelHub';
import { LicenseGate } from './components/LicenseGate';
import { InputNode, OutputNode, ChatNode, ImageNode, AudioNode, VideoNode, UploadImageNode, MultiImageUploadNode, GroupNode, FileUploadNode, TableParseNode, TaskSelectNode, BatchExecuteNode, ProductImageMatchNode } from './nodes';
import { NodeType } from './types';
import { fileToOptimizedImageDataUrl } from './utils/imageCompression';
import { useTheme } from './hooks/useTheme';
import { useCanvasMediaObserver } from './hooks/useCanvasMediaObserver';

import {
  Maximize2,
  Trash2,
  Play,
  Square,
  Copy,
  Download,
  Upload,
  Database, // Added Database icon
  Layout, // Added Layout icon
  Eye,
  RotateCcw,
  Layers,
  History,
  Bot,
  Settings2,
  Moon,
  Sun,
  X
} from 'lucide-react';

type RightDockTab = 'properties' | 'agent';

const requestedAppEdition = (import.meta.env.VITE_APP_EDITION || '').toLowerCase();
const shouldLoadLicenseAdmin = requestedAppEdition === 'admin' || (!requestedAppEdition && import.meta.env.DEV);
const LicenseAdminPanel = shouldLoadLicenseAdmin
  ? React.lazy(() => import('@/components/LicenseAdminPanel').then((module) => ({ default: module.LicenseAdminPanel })))
  : null;

const Flow = () => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useReactFlow();
  const [isApiSettingsOpen, setIsApiSettingsOpen] = useState(false);
  const [showWorkflowManager, setShowWorkflowManager] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showCanvasAgent, setShowCanvasAgent] = useState(false);
  const [showModelHub, setShowModelHub] = useState(false);
  const [showLicenseAdmin, setShowLicenseAdmin] = useState(false);
  const [rightDockTab, setRightDockTab] = useState<RightDockTab>('properties');
  const [quickNodeMenu, setQuickNodeMenu] = useState<{ open: boolean; x: number; y: number; clientX: number; clientY: number }>({
    open: false,
    x: 0,
    y: 0,
    clientX: 0,
    clientY: 0,
  });
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [isNodeDragging, setIsNodeDragging] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState('1');
  const interactionTimerRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);
  const { resolvedTheme, toggleTheme, reactFlowTheme } = useTheme();

  // Expose lightbox globally for node previews
  (window as any).openLightbox = (src: string) => setLightboxImage(src);

  const nodeTypesMemo = useMemo(() => ({
    [NodeType.INPUT]: InputNode,
    [NodeType.IMAGE_UPLOAD]: UploadImageNode,
    [NodeType.MULTI_IMAGE_UPLOAD]: MultiImageUploadNode,
    [NodeType.FILE_UPLOAD]: FileUploadNode,
    [NodeType.TABLE_PARSE]: TableParseNode,
    [NodeType.TASK_SELECT]: TaskSelectNode,
    [NodeType.BATCH_EXECUTE]: BatchExecuteNode,
    [NodeType.PRODUCT_IMAGE_MATCH]: ProductImageMatchNode,
    [NodeType.AI_CHAT]: ChatNode,
    [NodeType.AI_IMAGE]: ImageNode,
    [NodeType.AI_AUDIO]: AudioNode,
    [NodeType.AI_VIDEO]: VideoNode,
    [NodeType.OUTPUT]: OutputNode,
    [NodeType.GROUP]: GroupNode,
  }), []);

  const edgeTypesMemo = useMemo(() => ({
    soft: SoftEdge,
  }), []);

  // Memoize defaultEdgeOptions
  const defaultEdgeOptionsMemo = useMemo(() => ({
    type: 'soft',
    animated: false,
    style: { strokeWidth: 1.5, stroke: reactFlowTheme.edge }
  }), [reactFlowTheme.edge]);

  // ModelHub still uses this to jump into provider configuration.
  (window as any).openApiSettings = () => setIsApiSettingsOpen(true);
  const {
    nodes,
    edges,
    selectedNodeId,
    onNodesChange,
    onEdgesChange,
    onConnect,
    removeEdge,
    onSelectionChange,
    addNode,
    updateNodeData,
    executeWorkflow,
    maxWorkflowConcurrency,
    tidyUp,
    importWorkflow,
    clearCanvas,
    saveWorkflow,
    pushNotice,
    isWorkflowRunning,
    requestStopWorkflow,
    requestStopConcurrent,
    hydrateImageHistory,
    duplicateSelectionInCanvas,
    toggleSkipForSelection,
    clearAllSkipped
  } = useStore();

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const hasSelectedNode = Boolean(selectedNode);
  const isRightDockOpen = showCanvasAgent || hasSelectedNode;
  const activeRightDockTab: RightDockTab = rightDockTab === 'properties' && !hasSelectedNode && showCanvasAgent
    ? 'agent'
    : rightDockTab;

  const renderedEdges = useMemo(() => {
    return edges.map((edge) => ({
      ...edge,
      type: 'soft',
      animated: false,
      style: {
        ...edge.style,
        stroke: reactFlowTheme.edge,
        strokeWidth: 1.5,
      },
    }));
  }, [edges, reactFlowTheme.edge]);

  const isAutoPerformanceMode = nodes.length >= 45 || edges.length >= 70;
  const shouldShowMiniMap = showMiniMap && !isNodeDragging && !isAutoPerformanceMode;
  const mediaObserverScanKey = `${nodes.length}:${isInteracting ? 'interacting' : 'idle'}`;

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedNode && !showCanvasAgent) {
      setRightDockTab('properties');
    }
  }, [selectedNode?.id, showCanvasAgent]);

  const openAgentDock = useCallback(() => {
    setShowCanvasAgent(true);
    setRightDockTab('agent');
  }, []);

  const toggleAgentDock = useCallback(() => {
    setShowCanvasAgent((current) => {
      const next = !current;
      setRightDockTab(next ? 'agent' : 'properties');
      return next;
    });
  }, []);

  const closeRightDock = useCallback(() => {
    if (activeRightDockTab === 'agent') {
      setShowCanvasAgent(false);
      if (hasSelectedNode) {
        setRightDockTab('properties');
      }
      return;
    }
    onSelectionChange(null);
  }, [activeRightDockTab, hasSelectedNode, onSelectionChange]);

  const endInteractionSoon = useCallback(() => {
    if (interactionTimerRef.current !== null) {
      window.clearTimeout(interactionTimerRef.current);
    }
    interactionTimerRef.current = window.setTimeout(() => {
      isInteractingRef.current = false;
      setIsInteracting(false);
      interactionTimerRef.current = null;
    }, 180);
  }, []);

  const beginInteraction = useCallback(() => {
    if (interactionTimerRef.current !== null) {
      window.clearTimeout(interactionTimerRef.current);
    }
    if (!isInteractingRef.current) {
      isInteractingRef.current = true;
      setIsInteracting(true);
    }
    endInteractionSoon();
  }, [endInteractionSoon]);

  const handleCanvasMove = useCallback(() => {
    beginInteraction();
  }, [beginInteraction]);

  useCanvasMediaObserver({
    enabled: nodes.length > 8,
    rootRef: reactFlowWrapper,
    scanKey: mediaObserverScanKey,
  });

  useEffect(() => {
    return () => {
      if (interactionTimerRef.current !== null) {
        window.clearTimeout(interactionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void hydrateImageHistory();
  }, [hydrateImageHistory]);

  useEffect(() => {
    const hideSplash = (window as any).__AI_CANVAS_HIDE_SPLASH__;
    if (typeof hideSplash !== 'function') return;

    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => hideSplash());
    });

    return () => window.cancelAnimationFrame(firstFrame);
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) {
          return;
        }
      }

      const items = event.clipboardData?.items;
      if (!items || items.length === 0) return;

      const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'));
      if (imageItems.length === 0) return;

      const selectedNode = nodes.find((node) => node.id === selectedNodeId);
      if (!selectedNode || (selectedNode.type !== NodeType.IMAGE_UPLOAD && selectedNode.type !== NodeType.MULTI_IMAGE_UPLOAD)) {
        pushNotice('warn', '请先选中上传节点（UPLOAD / 多图UPLOAD）再粘贴图片');
        return;
      }

      event.preventDefault();

      const readPromises = imageItems
        .map((item) => item.getAsFile())
        .filter((f): f is File => !!f)
        .slice(0, 10)
        .map((file) => fileToOptimizedImageDataUrl(file));

      if (readPromises.length === 0) {
        pushNotice('warn', '剪贴板图片读取失败');
        return;
      }

      void Promise.all(readPromises)
        .then((images) => {
          if (selectedNode.type === NodeType.IMAGE_UPLOAD) {
            updateNodeData(selectedNode.id, {
              output: images[0],
              status: 'success'
            });
            pushNotice('success', '已粘贴图片到上传节点');
            return;
          }

          const current = Array.isArray(selectedNode.data.output) ? selectedNode.data.output : [];
          updateNodeData(selectedNode.id, {
            output: [...current, ...images],
            status: 'success'
          });
          pushNotice('success', `已追加 ${images.length} 张图片到多图节点`);
        })
        .catch(() => {
          pushNotice('error', '读取剪贴板图片失败');
        });
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [nodes, pushNotice, selectedNodeId, updateNodeData]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const isTyping = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        executeWorkflow();
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveWorkflow(`快速保存 ${new Date().toLocaleString()}`);
      }

      if (!isTyping && !event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        toggleSkipForSelection();
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        clearAllSkipped();
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelectionInCanvas(1, { keepUploadData: false });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearAllSkipped, duplicateSelectionInCanvas, executeWorkflow, saveWorkflow, toggleSkipForSelection]);

  const handleExport = useCallback(() => {
    const data = JSON.stringify({ nodes, edges }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ai-canvas-workflow-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [nodes, edges]);

  const handleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        if (data.nodes && data.edges) {
          importWorkflow(data.nodes, data.edges);
          pushNotice('success', '工作流导入成功');
        } else {
          pushNotice('error', '导入失败：无效的工作流文件格式');
        }
      } catch (err) {
        console.error('Import error:', err);
        pushNotice('error', '导入失败：文件解析错误');
      }
    };
    reader.readAsText(file);
    // Reset input
    if (event.target) event.target.value = '';
  }, [importWorkflow, pushNotice]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow') as NodeType;
      if (typeof type === 'undefined' || !type) return;

      // Fix: Use reactFlowInstance.project to get correct coordinates
      const position = reactFlowInstance.project({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(type, position);
    },
    [addNode, reactFlowInstance] // Added reactFlowInstance to dependencies
  );

  const onNodeClick = useCallback((_: any, node: any) => {
    setQuickNodeMenu((prev) => ({ ...prev, open: false }));
    setShowModelHub(false);
    onSelectionChange(node.id);
  }, [onSelectionChange]);

  const onPaneClick = useCallback(() => {
    setQuickNodeMenu((prev) => ({ ...prev, open: false }));
    onSelectionChange(null);
  }, [onSelectionChange]);

  const openQuickNodeMenu = useCallback((clientX: number, clientY: number) => {
    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    if (!bounds) return;

    const menuWidth = window.innerWidth < 768 ? 320 : 360;
    const menuHeight = 420;
    const pad = 10;
    const relX = clientX - bounds.left;
    const relY = clientY - bounds.top;
    const x = Math.max(pad, Math.min(relX, Math.max(pad, bounds.width - menuWidth - pad)));
    const y = Math.max(pad, Math.min(relY, Math.max(pad, bounds.height - menuHeight - pad)));

    setQuickNodeMenu({ open: true, x, y, clientX, clientY });
  }, []);

  const onPaneDoubleClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!target.closest('.react-flow__pane')) return;
    event.preventDefault();
    openQuickNodeMenu(event.clientX, event.clientY);
  }, [openQuickNodeMenu]);

  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    openQuickNodeMenu(event.clientX, event.clientY);
  }, [openQuickNodeMenu]);

  const handleQuickNodePick = useCallback((type: NodeType) => {
    const selectedNode = nodes.find((node) => node.id === selectedNodeId);
    const canAutoConnect = !!selectedNode && selectedNode.type !== NodeType.GROUP;

    const projected = reactFlowInstance.project({
      x: quickNodeMenu.clientX,
      y: quickNodeMenu.clientY,
    });

    addNode(type, projected, canAutoConnect && selectedNode ? selectedNode.id : undefined);
    setQuickNodeMenu((prev) => ({ ...prev, open: false }));
  }, [addNode, nodes, quickNodeMenu.clientX, quickNodeMenu.clientY, reactFlowInstance, selectedNodeId]);

  return (
    <div className={`flex h-full w-full theme-bg-canvas theme-text-primary selection:bg-indigo-500/30 overflow-hidden canvas-app-shell ${isAutoPerformanceMode ? 'perf-mode' : ''} ${isInteracting ? 'interacting' : ''} ${isConnecting ? 'is-connecting' : ''} ${isRightDockOpen ? 'has-right-dock' : ''}`}>
      <Sidebar
        isModelHubOpen={showModelHub}
        isLicenseAdminOpen={showLicenseAdmin}
        showLicenseAdmin={shouldLoadLicenseAdmin}
        onToggleModelHub={() => setShowModelHub((prev) => !prev)}
        onToggleLicenseAdmin={() => setShowLicenseAdmin((prev) => !prev)}
        onOpenApiSettings={() => setIsApiSettingsOpen(true)}
      />

      <div className="flex-1 relative overflow-hidden h-full" ref={reactFlowWrapper} onDoubleClick={onPaneDoubleClick}>
        <div className="canvas-toolbar absolute top-4 right-4 md:top-8 md:right-8 z-20 flex items-center gap-2 md:gap-3 max-w-[calc(100vw-96px)] flex-wrap justify-end">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImport}
            accept=".json"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="hidden"
          >
            <Upload size={16} className="group-hover:-translate-y-0.5 transition-transform" />
            <span className="hidden sm:inline">导入流程</span>
          </button>
          <button
            onClick={handleExport}
            className="hidden"
          >
            <Download size={16} className="group-hover:translate-y-0.5 transition-transform" />
            <span className="hidden sm:inline">导出流程</span>
          </button>
          <button
            onClick={() => setShowWorkflowManager(!showWorkflowManager)}
            className={`flex items-center gap-2 border px-3 md:px-5 py-2.5 md:py-3 rounded-2xl font-bold text-xs transition-all theme-shadow-soft group ${showWorkflowManager ? 'text-blue-400 border-blue-500/50 bg-blue-500/5' : 'theme-bg-secondary theme-text-secondary theme-border-subtle hover:theme-text-primary hover:theme-border-strong'}`}
          >
            <Database size={16} className={showWorkflowManager ? 'animate-pulse' : 'group-hover:scale-110 transition-transform'} />
            <span className="hidden sm:inline">工作流管理</span>
          </button>
          <button
            onClick={() => setShowHistoryDrawer((prev) => !prev)}
            className={`flex items-center gap-2 border px-3 md:px-5 py-2.5 md:py-3 rounded-2xl font-bold text-xs transition-all theme-shadow-soft ${showHistoryDrawer ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-300' : 'theme-bg-secondary theme-border-subtle theme-text-secondary hover:theme-text-primary hover:theme-border-strong'}`}
          >
            <History size={16} />
            <span className="hidden sm:inline">图像历史</span>
          </button>
          <button
            onClick={toggleAgentDock}
            className={`flex items-center gap-2 border px-3 md:px-5 py-2.5 md:py-3 rounded-2xl font-bold text-xs transition-all theme-shadow-soft ${showCanvasAgent && activeRightDockTab === 'agent' ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-200' : 'theme-bg-secondary theme-border-subtle theme-text-secondary hover:theme-text-primary hover:theme-border-strong'}`}
          >
            <Bot size={16} />
            <span className="hidden sm:inline">画布智能体</span>
          </button>
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2 theme-bg-secondary border theme-border-subtle theme-text-secondary px-3 md:px-4 py-2.5 md:py-3 rounded-2xl font-bold text-xs transition-all theme-shadow-soft hover:theme-text-primary hover:theme-border-strong"
            title={resolvedTheme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
          >
            {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            <span className="hidden sm:inline">{resolvedTheme === 'dark' ? '亮色' : '暗色'}</span>
          </button>
          <button
            onClick={() => reactFlowInstance.fitView({ duration: 500, padding: 0.2 })}
            className="flex items-center gap-2 theme-bg-elevated theme-text-primary border theme-border-subtle font-black text-xs px-3 md:px-6 py-2.5 md:py-3 rounded-2xl hover:bg-indigo-500 hover:text-white transition-all theme-shadow-soft group"
          >
            <Maximize2 size={16} className="group-hover:rotate-12 transition-transform" />
            <span className="hidden sm:inline">聚焦全图</span>
          </button>
          <button
            onClick={() => setShowMiniMap((prev) => !prev)}
            className={`flex items-center gap-2 border px-3 md:px-5 py-2.5 md:py-3 rounded-2xl font-bold text-xs transition-all theme-shadow-soft ${showMiniMap ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'theme-bg-secondary theme-border-subtle theme-text-muted hover:theme-text-secondary hover:theme-border-strong'}`}
          >
            <Eye size={16} />
            <span className="hidden sm:inline">{showMiniMap ? '隐藏地图' : '显示地图'}</span>
          </button>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={renderedEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={() => setIsConnecting(true)}
          onConnectEnd={() => setIsConnecting(false)}
          onNodeDragStart={() => {
            setIsNodeDragging(true);
            beginInteraction();
          }}
          onNodeDragStop={() => {
            setIsNodeDragging(false);
            endInteractionSoon();
          }}
          onMoveStart={beginInteraction}
          onMove={handleCanvasMove}
          onMoveEnd={endInteractionSoon}
          onEdgeDoubleClick={(_, edge) => {
            removeEdge(edge.id);
            pushNotice('info', '连线已断开');
          }}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onPaneContextMenu={onPaneContextMenu}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypesMemo}
          edgeTypes={edgeTypesMemo}
          fitView
          defaultEdgeOptions={defaultEdgeOptionsMemo}
          onlyRenderVisibleElements
          minZoom={0.2}
          maxZoom={2.5}
          nodesDraggable
          autoPanOnNodeDrag
          nodeDragThreshold={1}
          elevateNodesOnSelect
          selectionOnDrag
          selectNodesOnDrag
          selectionMode={SelectionMode.Partial}
          selectionKeyCode={['Shift', 'Control', 'Meta']}
          connectionMode={ConnectionMode.Strict}
          snapToGrid={false}
          zoomOnDoubleClick={false}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color={reactFlowTheme.background}
          />
          {shouldShowMiniMap && (
            <MiniMap
              pannable
              zoomable
              className="canvas-minimap !rounded-2xl !bottom-28 md:!bottom-32 !right-4 md:!right-8"
              nodeStrokeColor={reactFlowTheme.minimapStroke}
              nodeColor={reactFlowTheme.minimapNode}
              maskColor={reactFlowTheme.minimapMask}
            />
          )}
          <Panel position="bottom-left" className="canvas-command-panel theme-bg-secondary border theme-border-subtle mb-8 ml-8 theme-shadow-panel backdrop-blur-xl">
            <div className="canvas-command-group">
              <button
                type="button"
                onClick={() => executeWorkflow()}
                disabled={isWorkflowRunning}
                className="canvas-command-button is-primary"
                title="运行工作流"
                aria-label="运行工作流"
              >
                <Play size={18} fill="currentColor" />
              </button>
              <button
                type="button"
                onClick={() => requestStopWorkflow()}
                disabled={!isWorkflowRunning}
                className="canvas-command-button is-danger"
                title="停止执行"
                aria-label="停止执行"
              >
                <Square size={15} fill="currentColor" />
              </button>
              <button
                type="button"
                onClick={() => requestStopConcurrent()}
                disabled={!isWorkflowRunning}
                className="canvas-command-button is-warning"
                title={`停止并发队列，上限 ${maxWorkflowConcurrency}`}
                aria-label="停止并发队列"
              >
                <Layers size={16} />
              </button>
            </div>

            <div className="canvas-command-divider" />

            <div className="canvas-duplicate-control">
              <input
                type="number"
                min={1}
                max={30}
                value={duplicateCount}
                onChange={(e) => setDuplicateCount(e.target.value)}
                className="canvas-duplicate-input"
                title="复制份数"
                aria-label="复制份数"
              />
              <button
                type="button"
                onClick={() => {
                  const parsed = Number.parseInt(duplicateCount, 10);
                  const count = Number.isFinite(parsed) ? Math.max(1, Math.min(30, parsed)) : 1;
                  duplicateSelectionInCanvas(count, { keepUploadData: false });
                }}
                className="canvas-command-button is-accent"
                title="复制选中节点组 (Ctrl/Cmd + D)"
                aria-label="复制选中节点组"
              >
                <Copy size={16} />
              </button>
            </div>

            <div className="canvas-command-divider" />

            <div className="canvas-command-group">
              <button
                type="button"
                onClick={() => toggleSkipForSelection()}
                className="canvas-command-button is-skip"
                title="跳过/恢复选中节点 (S)"
                aria-label="跳过或恢复选中节点"
              >
                <span>S</span>
              </button>
              <button
                type="button"
                onClick={() => clearAllSkipped()}
                className="canvas-command-button is-restore"
                title="恢复全部跳过节点 (Ctrl/Cmd+Shift+R)"
                aria-label="恢复全部跳过节点"
              >
                <RotateCcw size={16} />
              </button>
              <button
                type="button"
                onClick={() => tidyUp()}
                className="canvas-command-button"
                title="自动对齐整理"
                aria-label="自动对齐整理"
              >
                <Layout size={17} />
              </button>
            </div>

            <div className="canvas-command-divider" />

            <button
              type="button"
              onClick={() => {
                clearCanvas();
                pushNotice('warn', '画布已清空');
              }}
              className="canvas-command-button is-muted-danger"
              title="清空画布"
              aria-label="清空画布"
            >
              <Trash2 size={17} />
            </button>
          </Panel>

        </ReactFlow>
        {/* Modal Overlay / Panels */}
        {showWorkflowManager && (
          <WorkflowManager onClose={() => setShowWorkflowManager(false)} />
        )}

        <HistoryDrawer
          isOpen={showHistoryDrawer}
          onClose={() => setShowHistoryDrawer(false)}
        />

        {isRightDockOpen && (
          <aside className="canvas-right-dock">
            <div className="canvas-right-dock-tabs">
              {hasSelectedNode && (
                <button
                  type="button"
                  onClick={() => setRightDockTab('properties')}
                  className={`canvas-right-dock-tab ${activeRightDockTab === 'properties' ? 'is-active' : ''}`}
                >
                  <Settings2 size={14} />
                  节点属性
                </button>
              )}
              <button
                type="button"
                onClick={openAgentDock}
                className={`canvas-right-dock-tab ${activeRightDockTab === 'agent' ? 'is-active' : ''}`}
              >
                <Bot size={14} />
                画布智能体
              </button>
              <button
                type="button"
                onClick={closeRightDock}
                className="canvas-right-dock-close"
                title="关闭右侧面板"
                aria-label="关闭右侧面板"
              >
                <X size={15} />
              </button>
            </div>

            <div className="canvas-right-dock-body">
              {hasSelectedNode && (
                <div className={`canvas-right-dock-pane ${activeRightDockTab === 'properties' ? 'is-active' : ''}`}>
                  <PropertiesPanel dockMode onClose={() => onSelectionChange(null)} />
                </div>
              )}
              <div className={`canvas-right-dock-pane ${activeRightDockTab === 'agent' ? 'is-active' : ''}`}>
                <CanvasAgentPanel
                  isOpen={activeRightDockTab === 'agent'}
                  onClose={() => {
                    setShowCanvasAgent(false);
                    if (hasSelectedNode) {
                      setRightDockTab('properties');
                    }
                  }}
                  dockMode
                />
              </div>
            </div>
          </aside>
        )}

        {shouldLoadLicenseAdmin && showLicenseAdmin && LicenseAdminPanel && (
          <React.Suspense fallback={<div className="license-admin-drawer" />}>
            <LicenseAdminPanel onClose={() => setShowLicenseAdmin(false)} />
          </React.Suspense>
        )}

        {showModelHub && (
          <div className="canvas-model-drawer">
            <div className="canvas-floating-panel-header">
              <div>
                <h2 className="text-sm font-black theme-text-primary">模型枢纽</h2>
                <p className="text-[10px] theme-text-muted">拖动模型到节点，或点击批量应用</p>
              </div>
              <button
                type="button"
                onClick={() => setShowModelHub(false)}
                className="canvas-floating-panel-close"
                title="关闭模型枢纽"
              >
                <X size={16} />
              </button>
            </div>
            <ModelHub />
          </div>
        )}

        <QuickNodeMenu
          isOpen={quickNodeMenu.open}
          x={quickNodeMenu.x}
          y={quickNodeMenu.y}
          onClose={() => setQuickNodeMenu((prev) => ({ ...prev, open: false }))}
          onPick={handleQuickNodePick}
        />

        <TerminalOutput />
        <NoticeStack />

        {lightboxImage && (
          <ImageLightbox
            src={lightboxImage}
            onClose={() => setLightboxImage(null)}
          />
        )}
      </div>

      <ApiSettingsModal isOpen={isApiSettingsOpen} onClose={() => setIsApiSettingsOpen(false)} />
    </div>
  );
};

export default function App() {
  return (
    <LicenseGate>
      <ReactFlowProvider>
        <Flow />
      </ReactFlowProvider>
    </LicenseGate>
  );
}
