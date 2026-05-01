
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlowProvider,
  BackgroundVariant,
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
import { InputNode, OutputNode, ChatNode, ImageNode, AudioNode, VideoNode, UploadImageNode, MultiImageUploadNode, GroupNode, FileUploadNode, TableParseNode, TaskSelectNode, BatchExecuteNode, ProductImageMatchNode } from './nodes';
import { NodeType } from './types';
import { fileToOptimizedImageDataUrl } from './utils/imageCompression';

import {
  Search,
  Command,
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
  FileText,
  Image as ImageIcon,
  Volume2,
  Cpu,
  Layers,
  Sparkles,
  History,
  Video,
  UploadCloud,
  Bot
} from 'lucide-react';

import { NODE_CATALOG } from './config/nodeCatalog';

const Flow = () => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useReactFlow();
  const [isApiSettingsOpen, setIsApiSettingsOpen] = useState(false);
  const [showWorkflowManager, setShowWorkflowManager] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showCanvasAgent, setShowCanvasAgent] = useState(false);
  const [quickNodeMenu, setQuickNodeMenu] = useState<{ open: boolean; x: number; y: number; clientX: number; clientY: number }>({
    open: false,
    x: 0,
    y: 0,
    clientX: 0,
    clientY: 0,
  });
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [isNodeDragging, setIsNodeDragging] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState('1');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  // Memoize defaultEdgeOptions
  const defaultEdgeOptionsMemo = useMemo(() => ({
    animated: true,
    style: { strokeWidth: 4, stroke: '#4f46e5' }
  }), []);

  // Expose toggle globally for Sidebar access
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

  const renderedEdges = useMemo(() => {
    if (!isNodeDragging) return edges;
    return edges.map((edge) => (
      edge.animated
        ? { ...edge, animated: false }
        : edge
    ));
  }, [edges, isNodeDragging]);

  const shouldShowMiniMap = showMiniMap && !isNodeDragging;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const getViewportCenter = useCallback(() => {
    const wrapperBounds = reactFlowWrapper.current?.getBoundingClientRect();
    if (!wrapperBounds) return { x: 300, y: 300 };

    return reactFlowInstance.project({
      x: wrapperBounds.left + wrapperBounds.width / 2,
      y: wrapperBounds.top + wrapperBounds.height / 2,
    });
  }, [reactFlowInstance]);

  const addNodeToViewportCenter = useCallback((type: NodeType) => {
    const selectedNode = nodes.find((node) => node.id === selectedNodeId);
    const canAutoConnect = !!selectedNode && selectedNode.type !== NodeType.GROUP;

    if (canAutoConnect && selectedNode) {
      addNode(
        type,
        { x: selectedNode.position.x + 420, y: selectedNode.position.y },
        selectedNode.id
      );
    } else {
      const position = getViewportCenter();
      addNode(type, position);
    }
  }, [addNode, getViewportCenter, nodes, selectedNodeId]);

  const createStarterFlow = useCallback((preset: 'text' | 'image' | 'multi-image') => {
    const center = getViewportCenter();
    const startX = center.x - 420;
    const y = center.y - 40;

    if (preset === 'text') {
      const inputId = addNode(NodeType.INPUT, { x: startX, y });
      const chatId = addNode(NodeType.AI_CHAT, { x: startX + 420, y }, inputId);
      addNode(NodeType.OUTPUT, { x: startX + 840, y }, chatId);
    }

    if (preset === 'image') {
      const inputId = addNode(NodeType.INPUT, { x: startX, y });
      const imageId = addNode(NodeType.AI_IMAGE, { x: startX + 420, y }, inputId);
      addNode(NodeType.OUTPUT, { x: startX + 840, y }, imageId);
    }

    if (preset === 'multi-image') {
      const uploadId = addNode(NodeType.MULTI_IMAGE_UPLOAD, { x: startX, y });
      const imageId = addNode(NodeType.AI_IMAGE, { x: startX + 420, y }, uploadId);
      addNode(NodeType.OUTPUT, { x: startX + 840, y }, imageId);
    }

    setTimeout(() => {
      reactFlowInstance.fitView({ duration: 450, padding: 0.2 });
    }, 60);
  }, [addNode, getViewportCenter, reactFlowInstance]);

  const filteredSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return NODE_CATALOG.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.keywords.some(k => k.includes(q))
    );
  }, [searchQuery]);

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    void hydrateImageHistory();
  }, [hydrateImageHistory]);

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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }

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

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (filteredSuggestions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSuggestionIndex((prev) => (prev + 1) % filteredSuggestions.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSuggestionIndex((prev) => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const pick = filteredSuggestions[activeSuggestionIndex] || filteredSuggestions[0];
      if (pick) {
        addNodeToViewportCenter(pick.type);
        setSearchQuery('');
      }
      return;
    }

    if (event.key === 'Escape') {
      setSearchQuery('');
      searchInputRef.current?.blur();
    }
  };

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
    <div className="flex h-full w-full bg-[#0b0b0f] text-white selection:bg-indigo-500/30 overflow-hidden">
      <Sidebar />

      <div className="flex-1 relative overflow-hidden h-full" ref={reactFlowWrapper}>
        <div className="absolute top-4 left-4 md:top-8 md:left-8 z-20 flex items-center gap-4 max-w-[calc(100vw-32px)]">
          <div className="relative flex items-center gap-3 bg-[#161621] border border-[#1e1e2d] px-4 md:px-5 py-2.5 md:py-3 rounded-2xl shadow-2xl focus-within:border-indigo-500/50 transition-all w-full md:w-auto">
            <Search size={16} className="text-gray-500" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="搜索并回车添加节点..."
              className="bg-transparent border-none outline-none text-xs w-40 sm:w-56 text-gray-300 placeholder:text-gray-700"
            />
            <div className="flex items-center gap-1.5 bg-[#0b0b0f] px-2 py-1 rounded-lg border border-[#1e1e2d]">
              <Command size={10} className="text-gray-600" />
              <span className="text-[10px] font-bold text-gray-600 uppercase">K</span>
            </div>

            {filteredSuggestions.length > 0 && (
              <div className="absolute top-[calc(100%+10px)] left-0 right-0 bg-[#12121a] border border-[#1e1e2d] rounded-2xl p-2 shadow-2xl z-30 max-h-72 overflow-y-auto custom-scrollbar">
                {filteredSuggestions.map((item, index) => {
                  const Icon = item.icon;
                  const isActive = index === activeSuggestionIndex;
                  return (
                    <button
                      key={item.type}
                      onClick={() => {
                        addNodeToViewportCenter(item.type);
                        setSearchQuery('');
                      }}
                      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${isActive ? 'bg-indigo-500/15 border border-indigo-500/30' : 'hover:bg-white/5 border border-transparent'}`}
                    >
                      <div className={`p-2 rounded-lg ${isActive ? 'bg-indigo-500/20 text-indigo-300' : 'bg-black/30 text-gray-500'}`}>
                        <Icon size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className={`text-xs font-bold ${isActive ? 'text-white' : 'text-gray-300'}`}>{item.label}</p>
                        <p className="text-[9px] text-gray-600 mt-0.5">
                          {selectedNodeId ? '回车添加并自动连线' : '回车快速添加到画布中心'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="absolute top-4 right-4 md:top-8 md:right-8 z-20 flex items-center gap-2 md:gap-3 max-w-[calc(100vw-32px)] flex-wrap justify-end">
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
            className={`flex items-center gap-2 bg-[#161621] border px-3 md:px-5 py-2.5 md:py-3 rounded-2xl font-bold text-xs transition-all shadow-xl group ${showWorkflowManager ? 'text-blue-400 border-blue-500/50 bg-blue-500/5' : 'text-gray-400 border-[#1e1e2d] hover:text-white hover:border-gray-500'}`}
          >
            <Database size={16} className={showWorkflowManager ? 'animate-pulse' : 'group-hover:scale-110 transition-transform'} />
            <span className="hidden sm:inline">工作流管理</span>
          </button>
          <button
            onClick={() => setShowHistoryDrawer((prev) => !prev)}
            className={`flex items-center gap-2 border px-3 md:px-5 py-2.5 md:py-3 rounded-2xl font-bold text-xs transition-all shadow-xl ${showHistoryDrawer ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-300' : 'bg-[#161621] border-[#1e1e2d] text-gray-400 hover:text-white hover:border-gray-500'}`}
          >
            <History size={16} />
            <span className="hidden sm:inline">图像历史</span>
          </button>
          <button
            onClick={() => setShowCanvasAgent((prev) => !prev)}
            className={`flex items-center gap-2 border px-3 md:px-5 py-2.5 md:py-3 rounded-2xl font-bold text-xs transition-all shadow-xl ${showCanvasAgent ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-200' : 'bg-[#161621] border-[#1e1e2d] text-gray-400 hover:text-white hover:border-gray-500'}`}
          >
            <Bot size={16} />
            <span className="hidden sm:inline">画布智能体</span>
          </button>
          <button
            onClick={() => reactFlowInstance.fitView({ duration: 500, padding: 0.2 })}
            className="flex items-center gap-2 bg-white text-black font-black text-xs px-3 md:px-6 py-2.5 md:py-3 rounded-2xl hover:bg-indigo-500 hover:text-white transition-all shadow-[0_10px_30px_rgba(255,255,255,0.1)] group"
          >
            <Maximize2 size={16} className="group-hover:rotate-12 transition-transform" />
            <span className="hidden sm:inline">聚焦全图</span>
          </button>
          <button
            onClick={() => setShowMiniMap((prev) => !prev)}
            className={`flex items-center gap-2 border px-3 md:px-5 py-2.5 md:py-3 rounded-2xl font-bold text-xs transition-all shadow-xl ${showMiniMap ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-[#161621] border-[#1e1e2d] text-gray-500 hover:text-gray-300 hover:border-gray-500'}`}
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
          onNodeDragStart={() => setIsNodeDragging(true)}
          onNodeDragStop={() => setIsNodeDragging(false)}
          onEdgeDoubleClick={(_, edge) => {
            removeEdge(edge.id);
            pushNotice('info', '连线已断开');
          }}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onPaneDoubleClick={onPaneDoubleClick}
          onPaneContextMenu={onPaneContextMenu}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypesMemo}
          fitView
          snapToGrid
          snapGrid={[20, 20]}
          defaultEdgeOptions={defaultEdgeOptionsMemo}
          onlyRenderVisibleElements
        >
          <Background
            variant={BackgroundVariant.Lines}
            gap={40}
            size={1}
            color="#1a1a24"
          />
          {shouldShowMiniMap && (
            <MiniMap
              pannable
              zoomable
              className="!bg-[#111118] !border !border-[#1e1e2d] !rounded-2xl !shadow-2xl !bottom-28 md:!bottom-32 !right-4 md:!right-8"
              nodeStrokeColor="#4f46e5"
              nodeColor="#1f1f2d"
              maskColor="rgba(0, 0, 0, 0.4)"
            />
          )}
          <Controls className="!bg-[#161621] !border-[#1e1e2d] !shadow-2xl !rounded-xl overflow-hidden" />
          <Panel position="bottom-right" className="bg-[#161621] p-3 rounded-2xl border border-[#1e1e2d] mb-8 mr-8 flex gap-3 shadow-2xl">
            <button
              onClick={() => executeWorkflow()}
              disabled={isWorkflowRunning}
              className="p-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all hover:scale-110 active:scale-95 shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              title="运行工作流"
            >
              <Play size={20} fill="currentColor" />
            </button>
            <button
              onClick={() => requestStopWorkflow()}
              disabled={!isWorkflowRunning}
              className="p-3 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="停止执行"
            >
              <Square size={20} fill="currentColor" />
            </button>
            <button
              onClick={() => requestStopConcurrent()}
              disabled={!isWorkflowRunning}
              className="p-3 bg-orange-500/15 hover:bg-orange-500/25 text-orange-300 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={`停止并发队列（上限 ${maxWorkflowConcurrency}，不再调度新任务）`}
            >
              <span className="text-[10px] font-black">并发</span>
            </button>
            <div className="w-px bg-[#1e1e2d]" />
            <div className="flex items-center gap-2 pr-1">
              <input
                type="number"
                min={1}
                max={30}
                value={duplicateCount}
                onChange={(e) => setDuplicateCount(e.target.value)}
                className="w-14 bg-[#0f0f16] border border-[#2a2a3a] rounded-lg px-2 py-1 text-[10px] text-gray-300 outline-none focus:border-indigo-500/50"
                title="复制份数"
              />
              <button
                onClick={() => {
                  const parsed = Number.parseInt(duplicateCount, 10);
                  const count = Number.isFinite(parsed) ? Math.max(1, Math.min(30, parsed)) : 1;
                  duplicateSelectionInCanvas(count, { keepUploadData: false });
                }}
                className="p-3 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded-xl transition-all"
                title="复制选中节点组 (Ctrl/Cmd + D)"
              >
                <Copy size={18} />
              </button>
            </div>
            <div className="w-px bg-[#1e1e2d]" />
            <button
              onClick={() => toggleSkipForSelection()}
              className="p-3 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 rounded-xl transition-all"
              title="跳过/恢复选中节点 (S)"
            >
              <span className="text-xs font-black">S</span>
            </button>
            <button
              onClick={() => clearAllSkipped()}
              className="p-3 hover:bg-cyan-500/10 text-cyan-300 rounded-xl transition-all"
              title="恢复全部跳过节点 (Ctrl/Cmd+Shift+R)"
            >
              <RotateCcw size={18} />
            </button>
            <div className="w-px bg-[#1e1e2d]" />
            <button
              onClick={() => tidyUp()}
              className="p-3 hover:bg-indigo-500/10 text-gray-400 hover:text-indigo-400 rounded-xl transition-all"
              title="自动对齐整理"
            >
              <Layout size={20} />
            </button>
            <div className="w-px bg-[#1e1e2d]" />
            <button
              onClick={() => {
                clearCanvas();
                pushNotice('warn', '画布已清空');
              }}
              className="p-3 hover:bg-rose-500/10 text-gray-500 hover:text-rose-400 rounded-xl transition-all"
              title="清空画布"
            >
              <Trash2 size={20} />
            </button>
          </Panel>

          {nodes.length === 0 && (
            <Panel position="bottom-left" className="mb-5 ml-4 md:mb-8 md:ml-8 max-w-[92vw] sm:max-w-sm bg-[#111118]/95 border border-[#1e1e2d] rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
              <p className="text-[11px] font-black text-indigo-300 uppercase tracking-wider">快速开始</p>
              <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                1) 一键生成模板流程，或从左侧拖入节点
              </p>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                2) 连线后点击右下角运行按钮
              </p>
              <div className="grid grid-cols-1 gap-2 mt-3">
                <button
                  onClick={() => createStarterFlow('text')}
                  className="w-full py-2.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[10px] font-black tracking-wider uppercase hover:bg-indigo-500/25 transition-all"
                >
                  一键文本流程
                </button>
                <button
                  onClick={() => createStarterFlow('image')}
                  className="w-full py-2.5 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-300 text-[10px] font-black tracking-wider uppercase hover:bg-orange-500/25 transition-all"
                >
                  一键绘图流程
                </button>
                <button
                  onClick={() => createStarterFlow('multi-image')}
                  className="w-full py-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[10px] font-black tracking-wider uppercase hover:bg-cyan-500/25 transition-all"
                >
                  一键多图编辑
                </button>
              </div>
              <p className="text-[10px] text-gray-600 mt-3">选中节点后再搜索添加，会自动连线到新节点</p>
              <p className="text-[10px] text-gray-600 mt-1">快捷键：Ctrl/Cmd + K 搜索，Ctrl/Cmd + Enter 运行，Ctrl/Cmd + S 快速保存</p>
            </Panel>
          )}
        </ReactFlow>
        {/* Modal Overlay / Panels */}
        {showWorkflowManager && (
          <WorkflowManager onClose={() => setShowWorkflowManager(false)} />
        )}

        <HistoryDrawer
          isOpen={showHistoryDrawer}
          onClose={() => setShowHistoryDrawer(false)}
        />

        <CanvasAgentPanel
          isOpen={showCanvasAgent}
          onClose={() => setShowCanvasAgent(false)}
        />

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

      <PropertiesPanel />
      <ApiSettingsModal isOpen={isApiSettingsOpen} onClose={() => setIsApiSettingsOpen(false)} />
    </div>
  );
};

export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
