import React from 'react';
import { NodeType } from '../types';
import { useStore } from '../store';
import {
  Bell,
  Boxes,
  ChevronRight,
  Coins,
  Copy,
  Cpu,
  Download,
  Layers,
  Search,
  Settings,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import { NODE_CATALOG, NodeCatalogItem } from '../config/nodeCatalog';
import { isAdminEdition } from '../config/appEdition';
import { APP_VERSION, ClientAnnouncement, readStoredLicenseState, StoredLicenseState } from '../services/licenseClientApi';

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
      NodeType.TEXT_RECOGNITION,
      NodeType.AI_IMAGE,
      NodeType.AI_AUDIO,
      NodeType.AI_VIDEO,
    ],
  },
  {
    title: '输出与布局',
    types: [NodeType.DESIGN_BOARD, NodeType.OUTPUT, NodeType.GROUP],
  },
];

const FAVORITE_NODE_TYPES = [
  NodeType.INPUT,
  NodeType.FILE_UPLOAD,
  NodeType.TABLE_PARSE,
  NodeType.AI_CHAT,
  NodeType.TEXT_RECOGNITION,
  NodeType.AI_IMAGE,
  NodeType.DESIGN_BOARD,
  NodeType.OUTPUT,
];

const announcementKindLabel = (kind?: string) => {
  if (kind === 'important') return '重要';
  if (kind === 'maintenance') return '维护';
  if (kind === 'warning') return '提醒';
  return '公告';
};

interface SidebarProps {
  isModelHubOpen?: boolean;
  isLicenseAdminOpen?: boolean;
  showLicenseAdmin?: boolean;
  showApiSettings?: boolean;
  onToggleModelHub?: () => void;
  onToggleLicenseAdmin?: () => void;
  onOpenApiSettings?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isModelHubOpen = false,
  isLicenseAdminOpen = false,
  showLicenseAdmin = false,
  showApiSettings = true,
  onToggleModelHub,
  onToggleLicenseAdmin,
  onOpenApiSettings,
}) => {
  const { addNode } = useStore();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [announcementOpen, setAnnouncementOpen] = React.useState(false);
  const [creditOpen, setCreditOpen] = React.useState(false);
  const [downloadCopied, setDownloadCopied] = React.useState(false);
  const creditRef = React.useRef<HTMLDivElement | null>(null);
  const [licenseState, setLicenseState] = React.useState<StoredLicenseState | null>(() => readStoredLicenseState());
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    if (isAdminEdition) return undefined;
    const syncLicenseState = (event?: Event) => {
      const detail = (event as CustomEvent<StoredLicenseState | null> | undefined)?.detail;
      setLicenseState(detail?.deviceId ? detail : readStoredLicenseState());
    };
    syncLicenseState();
    window.addEventListener('awei-license-state-change', syncLicenseState);
    window.addEventListener('storage', syncLicenseState);
    return () => {
      window.removeEventListener('awei-license-state-change', syncLicenseState);
      window.removeEventListener('storage', syncLicenseState);
    };
  }, []);

  React.useEffect(() => {
    if (!creditOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (creditRef.current?.contains(event.target as Node)) return;
      setCreditOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [creditOpen]);

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
    addNode(nodeType, nodeType === NodeType.DESIGN_BOARD ? { x: 320, y: 110 } : { x: 320, y: 240 });
  };

  const togglePalette = () => {
    setPaletteOpen((prev) => !prev);
    setAnnouncementOpen(false);
  };

  const toggleAnnouncements = () => {
    setAnnouncementOpen((prev) => !prev);
    setPaletteOpen(false);
    setCreditOpen(false);
  };

  const credits = !isAdminEdition ? licenseState?.credits : undefined;
  const creditAvailable = Number(credits?.available_balance ?? credits?.balance ?? 0);
  const creditReserved = Number(credits?.reserved_balance ?? 0);
  const creditSpent = Number(credits?.lifetime_spent ?? 0);
  const creditGranted = Number(credits?.lifetime_granted ?? 0);
  const creditTone = creditAvailable <= 0 ? 'is-empty' : creditAvailable < 10 ? 'is-low' : 'is-ok';
  const creditStatus = creditAvailable <= 0 ? '余额不足' : creditAvailable < 10 ? '余额偏低' : '余额正常';
  const versionInfo = !isAdminEdition ? licenseState?.version : undefined;
  const latestVersion = versionInfo?.latest_version || '';
  const downloadUrl = versionInfo?.download_url?.trim() || '';
  const hasUpdate = Boolean(versionInfo?.update_available && latestVersion);
  const requiresUpdate = Boolean(versionInfo?.must_update || (versionInfo?.force_update && versionInfo?.update_available));
  const activeAnnouncements = !isAdminEdition ? (licenseState?.announcements || []) : [];
  const announcementCount = activeAnnouncements.length + (hasUpdate ? 1 : 0);
  const showAnnouncementEntry = !isAdminEdition && licenseState?.status === 'enabled';
  const updateAnnouncement = hasUpdate ? {
    kind: requiresUpdate ? 'warning' : 'important',
    title: `AWEI Canvas ${latestVersion}`,
    body: versionInfo?.release_notes || '发现可用的新版本。',
    meta: `当前版本 ${versionInfo?.current_version || APP_VERSION}${versionInfo?.min_version ? ` · 最低可用 ${versionInfo.min_version}` : ''}`,
  } : null;

  const openDownloadTarget = async () => {
    if (!downloadUrl) return;
    setDownloadCopied(false);
    if (/^(https?:\/\/|file:\/\/)/i.test(downloadUrl)) {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await navigator.clipboard.writeText(downloadUrl);
      setDownloadCopied(true);
    } catch {
      setDownloadCopied(false);
    }
  };

  return (
    <>
      <aside className="canvas-sidebar z-30 flex h-full shrink-0 flex-col items-center border-r theme-border-subtle theme-bg-primary font-sans">
        <button
          type="button"
          className="canvas-rail-logo mt-3 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-[0_10px_24px_rgba(79,70,229,0.28)]"
          title="AI Canvas"
          onClick={togglePalette}
        >
          <Zap className="fill-white" size={20} />
        </button>

        <div className="mt-5 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={togglePalette}
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
          {showAnnouncementEntry && (
            <button
              type="button"
              onClick={toggleAnnouncements}
              className={`canvas-rail-button canvas-rail-notice-button ${announcementOpen ? 'is-active' : ''}`}
              title={announcementCount > 0 ? `公告中心 · ${announcementCount} 条` : '公告中心'}
              aria-label="公告中心"
              aria-expanded={announcementOpen}
            >
              <Bell size={18} />
              {announcementCount > 0 && (
                <span className="canvas-rail-badge">
                  {announcementCount > 9 ? '9+' : announcementCount}
                </span>
              )}
            </button>
          )}
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

        {credits && (
          <div ref={creditRef} className="canvas-credit-wallet">
            <button
              type="button"
              onClick={() => setCreditOpen((prev) => !prev)}
              className={`canvas-credit-trigger ${creditTone} ${creditOpen ? 'is-open' : ''}`}
              title={`平台代币 ${creditAvailable}${creditReserved > 0 ? ` · 冻结 ${creditReserved}` : ''}`}
              aria-expanded={creditOpen}
              aria-label="平台代币"
            >
              <span className="canvas-credit-live-dot" />
              <Coins size={15} />
              <strong>{creditAvailable}</strong>
            </button>

            {creditOpen && (
              <div className="canvas-credit-popover" role="dialog" aria-label="平台代币详情">
                <div className="canvas-credit-popover-head">
                  <span>平台代币</span>
                  <strong className={creditTone}>{creditStatus}</strong>
                </div>
                <div className="canvas-credit-balance">
                  <span>可用余额</span>
                  <strong>{creditAvailable}</strong>
                </div>
                <div className="canvas-credit-meta-grid">
                  <div>
                    <span>冻结中</span>
                    <strong>{creditReserved}</strong>
                  </div>
                  <div>
                    <span>已消耗</span>
                    <strong>{creditSpent}</strong>
                  </div>
                  <div>
                    <span>累计发放</span>
                    <strong>{creditGranted}</strong>
                  </div>
                  <div>
                    <span>账户状态</span>
                    <strong>{credits.status === 'enabled' ? '可用' : '停用'}</strong>
                  </div>
                </div>
                <p className="canvas-credit-hint">
                  AI 节点运行前会检查余额，执行中短暂冻结，完成后按线路单价扣除。
                </p>
              </div>
            )}
          </div>
        )}

        {showApiSettings && <div className="mb-3 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenApiSettings?.()}
            className="canvas-rail-button"
            title="本机调试 API"
          >
            <Settings size={18} />
          </button>
        </div>}
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

      {showAnnouncementEntry && (
        <div className={`canvas-palette-drawer canvas-announcement-drawer ${announcementOpen ? 'is-open' : ''}`}>
          <div className="canvas-palette-header">
            <div className="flex items-center gap-3">
              <div className="canvas-palette-mark">
                <Bell size={16} />
              </div>
              <div>
                <h2 className="text-sm font-black theme-text-primary">公告中心</h2>
                <p className="text-[10px] font-medium theme-text-muted">公告和版本更新都会保留在这里</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAnnouncementOpen(false)}
              className="canvas-palette-close"
              title="收起公告中心"
            >
              <X size={16} />
            </button>
          </div>

          <div className="license-announcement-list custom-scrollbar">
            {updateAnnouncement && (
              <article className={`license-announcement-item is-${updateAnnouncement.kind}`}>
                <div className="license-announcement-item-top">
                  <span>{requiresUpdate ? '强制更新' : '版本更新'}</span>
                  <time>{latestVersion}</time>
                </div>
                <h3>{updateAnnouncement.title}</h3>
                <p className="license-announcement-meta">{updateAnnouncement.meta}</p>
                <div className="license-announcement-body">{updateAnnouncement.body}</div>
                {downloadCopied && (
                  <div className="license-update-copied mt-2">下载地址已复制。</div>
                )}
                <div className="license-announcement-actions">
                  <button type="button" disabled={!downloadUrl} onClick={() => void openDownloadTarget()}>
                    {downloadUrl && /^(https?:\/\/|file:\/\/)/i.test(downloadUrl) ? <Download size={14} /> : <Copy size={14} />}
                    {downloadUrl && /^(https?:\/\/|file:\/\/)/i.test(downloadUrl) ? '下载新版' : '复制下载地址'}
                  </button>
                </div>
              </article>
            )}

            {activeAnnouncements.map((announcement: ClientAnnouncement) => (
              <article key={announcement.id} className={`license-announcement-item is-${announcement.kind}`}>
                <div className="license-announcement-item-top">
                  <span>{announcementKindLabel(announcement.kind)}</span>
                  <time>{new Date(announcement.updated_at).toLocaleDateString('zh-CN')}</time>
                </div>
                <h3>{announcement.title}</h3>
                <div className="license-announcement-body">{announcement.body}</div>
              </article>
            ))}

            {!updateAnnouncement && activeAnnouncements.length === 0 && (
              <div className="license-announcement-empty">
                <Bell size={18} />
                <span>暂无公告</span>
                <p>后续公告、维护通知和版本更新都会保留在这里。</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
