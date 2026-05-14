
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
import { InputNode, OutputNode, ChatNode, ImageNode, AudioNode, VideoNode, UploadImageNode, MultiImageUploadNode, GroupNode, FileUploadNode, TableParseNode, TaskSelectNode, BatchExecuteNode, ProductImageMatchNode, TextRecognitionNode, DesignBoardNode } from './nodes';
import { APIProvider, ModelModality, NodeType } from './types';
import { fileToOptimizedImageDataUrl } from './utils/imageCompression';
import { useTheme } from './hooks/useTheme';
import { useCanvasMediaObserver } from './hooks/useCanvasMediaObserver';
import { checkClientModelHealth } from './services/licenseClientApi';
import {
  findBestRouteSuggestion,
  findLocalProviderForRoute,
  formatRouteSuccessRate,
  getRouteDisplayName,
  MODEL_FIELD_BY_MODALITY,
  selectActiveProviderForModality,
  splitProviderModels,
} from './services/routeRecommendation';

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

const ROUTE_MODALITIES: ModelModality[] = ['chat', 'image', 'audio', 'video'];
const ROUTE_MODALITY_LABELS: Record<ModelModality, string> = {
  chat: '对话',
  image: '图像',
  audio: '音频',
  video: '视频',
};

const requestedAppEdition = (import.meta.env.VITE_APP_EDITION || '').toLowerCase();
const shouldLoadLicenseAdmin = requestedAppEdition === 'admin' || (!requestedAppEdition && import.meta.env.DEV);
const canManageApiProviders = shouldLoadLicenseAdmin;
const LicenseAdminPanel = shouldLoadLicenseAdmin
  ? React.lazy(() => import('@/components/LicenseAdminPanel').then((module) => ({ default: module.LicenseAdminPanel })))
  : null;
const ApiSettingsModal = canManageApiProviders
  ? React.lazy(() => import('@/components/ApiSettingsModal').then((module) => ({ default: module.ApiSettingsModal })))
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
  const draftSaveTimerRef = useRef<number | null>(null);
  const draftViewportAppliedRef = useRef(false);
  const isInteractingRef = useRef(false);
  const routeHintShownRef = useRef(false);
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
    [NodeType.TEXT_RECOGNITION]: TextRecognitionNode,
    [NodeType.AI_CHAT]: ChatNode,
    [NodeType.AI_IMAGE]: ImageNode,
    [NodeType.AI_AUDIO]: AudioNode,
    [NodeType.AI_VIDEO]: VideoNode,
    [NodeType.DESIGN_BOARD]: DesignBoardNode,
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
    workspaceDraftHydrated,
    workspaceDraftViewport,
    hydrateWorkspaceDraft,
    persistWorkspaceDraft,
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

  const scheduleWorkspaceDraftSave = useCallback(() => {
    if (!workspaceDraftHydrated) return;
    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = window.setTimeout(() => {
      draftSaveTimerRef.current = null;
      void persistWorkspaceDraft({ viewport: reactFlowInstance.getViewport() });
    }, 1000);
  }, [persistWorkspaceDraft, reactFlowInstance, workspaceDraftHydrated]);

  useEffect(() => {
    if (canManageApiProviders) {
      (window as any).openApiSettings = () => setIsApiSettingsOpen(true);
    } else {
      delete (window as any).openApiSettings;
    }
    (window as any).openModelHub = () => setShowModelHub(true);
    return () => {
      delete (window as any).openApiSettings;
      delete (window as any).openModelHub;
    };
  }, []);

  useEffect(() => {
    if (routeHintShownRef.current) return;
    routeHintShownRef.current = true;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const summary = await checkClientModelHealth();
          const state = useStore.getState();

          for (const modality of ROUTE_MODALITIES) {
            const provider = selectActiveProviderForModality(
              state.apiProviders,
              state.activeProviderIds,
              state.activeProviderId,
              modality,
            );
            if (!provider) continue;

            const field = MODEL_FIELD_BY_MODALITY[modality];
            const modelId = state.globalActiveModels[modality]
              || splitProviderModels(String(provider[field] || ''))[0]
              || '';
            if (!modelId) continue;

            const suggestion = findBestRouteSuggestion({
              summary,
              modality,
              modelId,
              providerName: provider.name,
              providerBaseUrl: provider.baseUrl,
              apiProviders: state.apiProviders,
              mode: 'startup',
            });
            if (!suggestion) continue;

            const canSwitch = canManageApiProviders && Boolean(findLocalProviderForRoute(state.apiProviders, suggestion.route));
            pushNotice(
              'info',
              `发现更稳的${ROUTE_MODALITY_LABELS[modality]}线路：${getRouteDisplayName(suggestion.route)}（${formatRouteSuccessRate(suggestion.route)}）。`,
              10000,
              {
                label: canSwitch ? '切换线路' : '查看线路',
                onClick: () => {
                  if (!canManageApiProviders) {
                    setShowModelHub(true);
                    return;
                  }
                  const latest = useStore.getState();
                  const localProvider = findLocalProviderForRoute(latest.apiProviders, suggestion.route);
                  if (!localProvider) {
                    setShowModelHub(true);
                    return;
                  }

                  const routeField = MODEL_FIELD_BY_MODALITY[modality];
                  const models = splitProviderModels(String(localProvider[routeField] || ''));
                  if (!models.includes(suggestion.route.model_id)) {
                    latest.updateProvider(localProvider.id, { [routeField]: [...models, suggestion.route.model_id].join(', ') } as Partial<APIProvider>);
                  }
                  latest.setActiveProviderForModality(modality, localProvider.id);
                  latest.applyModelToNodesByModality(modality, suggestion.route.model_id, 'modality');
                  latest.pushNotice('success', `已切换到 ${getRouteDisplayName(suggestion.route)} · ${suggestion.route.model_id}`);
                },
              },
            );
            break;
          }
        } catch {
          // Line health is optional; a missing local license server should not interrupt startup.
        }
      })();
    }, 1400);

    return () => window.clearTimeout(timer);
  }, [pushNotice]);

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
      if (draftSaveTimerRef.current !== null) {
        window.clearTimeout(draftSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void hydrateWorkspaceDraft();
  }, [hydrateWorkspaceDraft]);


  useEffect(() => {
    if (!workspaceDraftHydrated) return;
    scheduleWorkspaceDraftSave();
  }, [edges, nodes, scheduleWorkspaceDraftSave, selectedNodeId, workspaceDraftHydrated]);

  useEffect(() => {
    if (!workspaceDraftHydrated || draftViewportAppliedRef.current || !workspaceDraftViewport) return;
    draftViewportAppliedRef.current = true;

    const frame = window.requestAnimationFrame(() => {
      reactFlowInstance.setViewport(workspaceDraftViewport, { duration: 0 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [reactFlowInstance, workspaceDraftHydrated, workspaceDraftViewport]);

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
        pushNotice('warn', '鐠囧嘲鍘涢柅澶夎厬娑撳﹣绱堕懞鍌滃仯閿涘湶PLOAD / 婢舵艾娴楿PLOAD閿涘鍟€缁鍒涢崶鍓у');
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
          pushNotice('success', `已追加 ${images.length} 张图片到多图上传节点`);
        })
        .catch(() => {
          pushNotice('error', '处理剪贴板图片失败');
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
        saveWorkflow(`韫囶偊鈧喍绻氱€?${new Date().toLocaleString()}`);
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
    <div className={`flex h-full w-full theme-bg-canvas theme-text-primary selection:bg-indigo-500/30 overflow-hidden canvas-app-shell ${shouldLoadLicenseAdmin ? 'edition-admin' : 'edition-client'} ${isAutoPerformanceMode ? 'perf-mode' : ''} ${isInteracting ? 'interacting' : ''} ${isConnecting ? 'is-connecting' : ''} ${isRightDockOpen ? 'has-right-dock' : ''}`}>
      <Sidebar
        isModelHubOpen={showModelHub}
        isLicenseAdminOpen={showLicenseAdmin}
        showLicenseAdmin={shouldLoadLicenseAdmin}
        showApiSettings={canManageApiProviders}
        onToggleModelHub={() => setShowModelHub((prev) => !prev)}
        onToggleLicenseAdmin={() => setShowLicenseAdmin((prev) => !prev)}
        onOpenApiSettings={canManageApiProviders ? () => setIsApiSettingsOpen(true) : undefined}
      />

      <div className="flex-1 relative overflow-hidden h-full" ref={reactFlowWrapper} onDoubleClick={onPaneDoubleClick}>
        <div className="canvas-toolbar">
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
            <span className="hidden sm:inline">导入配置</span>
          </button>
          <button
            onClick={handleExport}
            className="hidden"
          >
            <Download size={16} className="group-hover:translate-y-0.5 transition-transform" />
            <span className="hidden sm:inline">导出配置</span>
          </button>
          <div className="canvas-toolbar-group">
            <button
              onClick={() => setShowWorkflowManager(!showWorkflowManager)}
              className={`canvas-toolbar-button ${showWorkflowManager ? 'is-active is-blue' : ''}`}
            >
              <Database size={15} className={showWorkflowManager ? 'animate-pulse' : ''} />
              <span>工作流管理</span>
            </button>
            <button
              onClick={() => setShowHistoryDrawer((prev) => !prev)}
              className={`canvas-toolbar-button ${showHistoryDrawer ? 'is-active' : ''}`}
            >
              <History size={15} />
              <span>历史记录</span>
            </button>
          </div>

          <div className="canvas-toolbar-group is-agent">
            <button
              onClick={toggleAgentDock}
              className={`canvas-toolbar-button ${showCanvasAgent && activeRightDockTab === 'agent' ? 'is-active is-agent' : ''}`}
            >
              <Bot size={15} />
              <span>画布智能体</span>
            </button>
          </div>

          <div className="canvas-toolbar-group">
            <button
              onClick={toggleTheme}
              className="canvas-toolbar-button"
              title={resolvedTheme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
            >
              {resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              <span>{resolvedTheme === 'dark' ? '亮色' : '暗色'}</span>
            </button>
            <button
              onClick={() => reactFlowInstance.fitView({ duration: 500, padding: 0.2 })}
              className="canvas-toolbar-button is-strong"
            >
              <Maximize2 size={15} />
              <span>聚焦全图</span>
            </button>
            <button
              onClick={() => setShowMiniMap((prev) => !prev)}
              className={`canvas-toolbar-button ${showMiniMap ? 'is-active is-success' : ''}`}
            >
              <Eye size={15} />
              <span>{showMiniMap ? '隐藏地图' : '显示地图'}</span>
            </button>
          </div>
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
          onMoveEnd={() => {
            endInteractionSoon();
            scheduleWorkspaceDraftSave();
          }}
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
                <p className="text-[10px] theme-text-muted">拖动模型到节点，或点击批量应用。</p>
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

      {canManageApiProviders && ApiSettingsModal && (
        <React.Suspense fallback={null}>
          <ApiSettingsModal isOpen={isApiSettingsOpen} onClose={() => setIsApiSettingsOpen(false)} />
        </React.Suspense>
      )}
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
