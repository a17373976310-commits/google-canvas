import React from 'react';
import { NodeType } from '../types';
import { useStore } from '../store';
import {
  Boxes,
  ChevronRight,
  Cpu,
  Layers,
  Search,
  Settings,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import { NODE_CATALOG, NodeCatalogItem } from '../config/nodeCatalog';

const NODE_GROUPS: Array<{ title: string; types: NodeType[] }> = [
  {
    title: '输入与素材',
    types: [
      NodeType.INPUT,
      NodeType.FILE_UPLOAD,
      NodeType.IMAGE_UPLOAD,
      NodeType.MULTI_IMAGE_UPLOAD,
    ],
  },
  {
    title: '任务编排',
    types: [
      NodeType.TABLE_PARSE,
      NodeType.TASK_SELECT,
      NodeType.BATCH_EXECUTE,
      NodeType.PRODUCT_IMAGE_MATCH,
    ],
  },
  {
    title: 'AI 生成',
    types: [
      NodeType.AI_CHAT,
      NodeType.AI_IMAGE,
      NodeType.AI_AUDIO,
      NodeType.AI_VIDEO,
    ],
  },
  {
    title: '输出与布局',
    types: [NodeType.OUTPUT, NodeType.GROUP],
  },
];

const FAVORITE_NODE_TYPES = [
  NodeType.INPUT,
  NodeType.FILE_UPLOAD,
  NodeType.TABLE_PARSE,
  NodeType.AI_CHAT,
  NodeType.AI_IMAGE,
  NodeType.OUTPUT,
];

interface SidebarProps {
  isModelHubOpen?: boolean;
  isLicenseAdminOpen?: boolean;
  showLicenseAdmin?: boolean;
  onToggleModelHub?: () => void;
  onToggleLicenseAdmin?: () => void;
  onOpenApiSettings?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isModelHubOpen = false,
  isLicenseAdminOpen = false,
  showLicenseAdmin = false,
  onToggleModelHub,
  onToggleLicenseAdmin,
  onOpenApiSettings,
}) => {
  const { addNode } = useStore();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const catalogByType = React.useMemo(() => {
    return new Map(NODE_CATALOG.map((node) => [node.type, node]));
  }, []);

  const filteredCatalog = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NODE_CATALOG;
    return NODE_CATALOG.filter((node) => (
      node.label.toLowerCase().includes(q)
      || node.desc.toLowerCase().includes(q)
      || node.keywords.some((keyword) => keyword.toLowerCase().includes(q))
    ));
  }, [query]);

  const filteredTypeSet = React.useMemo(() => (
    new Set(filteredCatalog.map((node) => node.type))
  ), [filteredCatalog]);

  const handleDragStart = (event: React.DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const addPaletteNode = (nodeType: NodeType) => {
    addNode(nodeType, { x: 320, y: 240 });
  };

  return (
    <>
      <aside className="canvas-sidebar z-30 flex h-full shrink-0 flex-col items-center border-r theme-border-subtle theme-bg-primary font-sans">
        <button
          type="button"
          className="canvas-rail-logo mt-3 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-[0_10px_24px_rgba(79,70,229,0.28)]"
          title="AI Canvas"
          onClick={() => setPaletteOpen((prev) => !prev)}
        >
          <Zap className="fill-white" size={20} />
        </button>

        <div className="mt-5 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setPaletteOpen((prev) => !prev)}
            className={`canvas-rail-button ${paletteOpen ? 'is-active' : ''}`}
            title="节点库"
          >
            <Layers size={18} />
          </button>
          <button
            type="button"
            onClick={() => onToggleModelHub?.()}
            className={`canvas-rail-button ${isModelHubOpen ? 'is-active' : ''}`}
            title="模型枢纽"
          >
            <Cpu size={18} />
          </button>
          {showLicenseAdmin && (
            <button
              type="button"
              onClick={() => onToggleLicenseAdmin?.()}
              className={`canvas-rail-button ${isLicenseAdminOpen ? 'is-active' : ''}`}
              title="用户控制台"
            >
              <ShieldCheck size={18} />
            </button>
          )}
        </div>

        <div className="canvas-rail-node-strip custom-scrollbar mt-5 flex flex-1 flex-col items-center gap-2 overflow-y-auto px-2">
          {FAVORITE_NODE_TYPES
            .map((type) => catalogByType.get(type))
            .filter((node): node is NodeCatalogItem => !!node)
            .map((node) => (
            <button
              key={node.type}
              type="button"
              draggable
              onDragStart={(event) => handleDragStart(event, node.type)}
              onClick={() => addPaletteNode(node.type)}
              className={`canvas-rail-node ${node.color}`}
              title={node.label}
            >
              <node.icon size={17} />
            </button>
          ))}
        </div>

        <div className="mb-3 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenApiSettings?.()}
            className="canvas-rail-button"
            title="API 设置"
          >
            <Settings size={18} />
          </button>
        </div>
      </aside>

      <div className={`canvas-palette-drawer ${paletteOpen ? 'is-open' : ''}`}>
        <div className="canvas-palette-header">
          <div className="flex items-center gap-3">
            <div className="canvas-palette-mark">
              <Boxes size={16} />
            </div>
            <div>
              <h2 className="text-sm font-black theme-text-primary">节点库</h2>
              <p className="text-[10px] font-medium theme-text-muted">拖入画布或点击添加</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(false)}
            className="canvas-palette-close"
            title="收起节点库"
          >
            <X size={16} />
          </button>
        </div>

        <div className="canvas-palette-search">
          <Search size={14} className="theme-text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full bg-transparent text-xs outline-none theme-text-primary theme-placeholder-muted"
            placeholder="搜索节点..."
          />
        </div>

        <div className="canvas-palette-list custom-scrollbar">
          {NODE_GROUPS.map((group) => {
            const nodes = group.types
              .map((type) => catalogByType.get(type))
              .filter((node): node is NodeCatalogItem => !!node && filteredTypeSet.has(node.type));

            if (nodes.length === 0) return null;

            return (
              <section key={group.title} className="canvas-palette-section">
                <div className="canvas-palette-section-title">{group.title}</div>
                <div className="space-y-1.5">
                  {nodes.map((node) => (
                    <button
                      key={node.type}
                      type="button"
                      draggable
                      onDragStart={(event) => handleDragStart(event, node.type)}
                      onClick={() => addPaletteNode(node.type)}
                      className="canvas-palette-item"
                    >
                      <div className={`canvas-palette-icon ${node.color}`}>
                        <node.icon size={16} />
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-[12px] font-bold theme-text-primary">{node.label}</div>
                        <div className="truncate text-[10px] theme-text-muted">{node.desc}</div>
                      </div>
                      <ChevronRight size={14} className="theme-text-disabled opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
};
