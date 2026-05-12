import React from 'react';
import { useStore } from '../store';
import { ImageHistoryItem, NodeType } from '../types';
import { History, X, Copy, Trash2, RotateCcw, Download, Search, Maximize2 } from 'lucide-react';
import { normalizeImageSrc } from '../utils/normalizeImageSrc';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const getPreviewSrc = (item: ImageHistoryItem) =>
  normalizeImageSrc(item.resultImageDataUrl || item.resultImageUrl) || '';

const getSourceSrc = (item: ImageHistoryItem) =>
  normalizeImageSrc(item.sourceImageDataUrl) || '';

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({ isOpen, onClose }) => {
  const {
    imageHistory,
    deleteImageHistory,
    clearImageHistory,
    selectedNodeId,
    nodes,
    updateNodeData,
    pushNotice,
  } = useStore();

  const [search, setSearch] = React.useState('');
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const openPreview = React.useCallback((src: string) => {
    if (!src) return;
    (window as any).openLightbox?.(src);
  }, []);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return imageHistory;
    return imageHistory.filter((item) => {
      return (
        item.modelId.toLowerCase().includes(q)
        || item.rawPrompt.toLowerCase().includes(q)
        || item.optimizedPrompt.toLowerCase().includes(q)
        || item.providerName.toLowerCase().includes(q)
      );
    });
  }, [imageHistory, search]);

  React.useEffect(() => {
    if (!activeId && filtered.length > 0) {
      setActiveId(filtered[0].id);
      return;
    }
    if (activeId && !filtered.some((item) => item.id === activeId)) {
      setActiveId(filtered[0]?.id || null);
    }
  }, [filtered, activeId]);

  const activeItem = React.useMemo(
    () => filtered.find((item) => item.id === activeId) || null,
    [filtered, activeId]
  );

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text || '');
      pushNotice('success', `${label}已复制`);
    } catch {
      pushNotice('error', '复制失败，请手动复制');
    }
  };

  const handleApplyToSelectedNode = () => {
    if (!activeItem) return;
    const selectedNode = nodes.find((n) => n.id === selectedNodeId);
    if (!selectedNode || selectedNode.type !== NodeType.AI_IMAGE) {
      pushNotice('warn', '请先选中一个图像节点，再回填提示词');
      return;
    }

    const promptToApply = (activeItem.rawPrompt || activeItem.optimizedPrompt || '').trim();
    updateNodeData(selectedNode.id, {
      config: {
        ...selectedNode.data.config,
        prompt: promptToApply,
        promptTemplate: 'free_mode',
        enablePromptTemplate: false,
      },
    });
    pushNotice('success', '已回填到当前图像节点');
  };

  const handleDownload = async () => {
    if (!activeItem) return;
    const src = getPreviewSrc(activeItem);
    const filename = `history-${activeItem.modelId}-${new Date(activeItem.createdAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;

    if (src.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = src;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    try {
      const response = await fetch(src, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, '_blank', 'noopener,noreferrer');
      pushNotice('info', '当前图片不支持直接下载，已在新标签页打开');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-y-0 right-0 z-[90] w-full md:w-[900px] theme-bg-overlay border-l theme-border-subtle shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl flex flex-col">
      <div className="px-5 py-4 border-b theme-border-subtle flex items-center gap-3">
        <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
          <History size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black text-white tracking-wide uppercase">图像历史记录</p>
          <p className="text-[10px] theme-text-muted mt-0.5">保存原始提示词 / 优化后提示词 / 输入图 / 结果图</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl theme-text-muted hover:theme-text-primary hover:bg-white/5 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="px-5 py-3 border-b theme-border-subtle flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2 theme-bg-secondary border theme-border-subtle rounded-xl px-3 py-2">
          <Search size={14} className="theme-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索提示词、模型或提供商"
            className="w-full bg-transparent border-none outline-none text-xs theme-text-primary theme-placeholder-muted"
          />
        </div>
        <button
          onClick={() => clearImageHistory()}
          className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-rose-500/15 border border-rose-500/25 text-rose-300 hover:bg-rose-500/25 transition-colors"
        >
          清空
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[320px_1fr]">
        <div className="border-r theme-border-subtle overflow-y-auto custom-scrollbar p-3 space-y-2">
          {filtered.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center theme-text-disabled text-xs gap-2">
              <History size={22} className="opacity-40" />
              <span>暂无历史记录</span>
            </div>
          )}

          {filtered.map((item) => {
            const isActive = item.id === activeId;
            return (
              <button
                key={item.id}
                onClick={() => setActiveId(item.id)}
                className={`w-full text-left p-2.5 rounded-xl border transition-all ${isActive ? 'bg-indigo-500/10 border-indigo-500/30' : 'theme-bg-secondary theme-border-subtle hover:theme-border-medium'}`}
              >
                <div
                  className="group relative aspect-[4/3] rounded-lg overflow-hidden bg-black"
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openPreview(getPreviewSrc(item));
                  }}
                  title="双击查看大图"
                >
                  <img src={getPreviewSrc(item)} alt="history" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/45 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[9px] font-black text-white backdrop-blur">
                      <Maximize2 size={12} />
                      双击查看
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-[10px] font-black theme-text-primary truncate">{item.modelId}</p>
                <p className="text-[10px] theme-text-muted truncate mt-0.5">{item.optimizedPrompt || item.rawPrompt}</p>
                <p className="text-[9px] theme-text-disabled mt-1">{new Date(item.createdAt).toLocaleString()}</p>
              </button>
            );
          })}
        </div>

        <div className="overflow-y-auto custom-scrollbar p-4 md:p-5">
          {!activeItem && (
            <div className="h-full flex items-center justify-center theme-text-disabled text-sm">
              请选择左侧历史记录
            </div>
          )}

          {activeItem && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="theme-bg-secondary border theme-border-subtle rounded-2xl p-3">
                  <p className="text-[10px] theme-text-muted uppercase tracking-widest font-black mb-2">原始图片</p>
                  {getSourceSrc(activeItem) ? (
                    <button
                      type="button"
                      onClick={() => openPreview(getSourceSrc(activeItem))}
                      className="group relative w-full overflow-hidden rounded-xl border theme-border-subtle bg-black text-left"
                      title="查看原始图片"
                    >
                      <img src={getSourceSrc(activeItem)} alt="source" className="w-full aspect-square object-cover transition-transform duration-500 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/45 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[10px] font-black text-white backdrop-blur">
                          <Maximize2 size={14} />
                          查看大图
                        </span>
                      </div>
                    </button>
                  ) : (
                    <div className="w-full aspect-square rounded-xl border border-dashed theme-border-medium theme-text-disabled text-xs flex items-center justify-center">文生图无原始图片</div>
                  )}
                </div>
                <div className="theme-bg-secondary border theme-border-subtle rounded-2xl p-3">
                  <p className="text-[10px] theme-text-muted uppercase tracking-widest font-black mb-2">最终图片</p>
                  <button
                    type="button"
                    onClick={() => openPreview(getPreviewSrc(activeItem))}
                    className="group relative w-full overflow-hidden rounded-xl border theme-border-subtle bg-black text-left"
                    title="查看最终图片"
                  >
                    <img src={getPreviewSrc(activeItem)} alt="result" className="w-full aspect-square object-cover transition-transform duration-500 group-hover:scale-105" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/45 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[10px] font-black text-white backdrop-blur">
                        <Maximize2 size={14} />
                        查看大图
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              <div className="theme-bg-secondary border theme-border-subtle rounded-2xl p-4 space-y-3">
                <div>
                  <p className="text-[10px] theme-text-muted uppercase tracking-widest font-black mb-1">原始提示词</p>
                  <div className="text-xs theme-text-primary whitespace-pre-wrap leading-relaxed bg-black/30 border theme-border-subtle rounded-xl p-3">{activeItem.rawPrompt || '-'}</div>
                </div>
                <div>
                  <p className="text-[10px] theme-text-muted uppercase tracking-widest font-black mb-1">优化后提示词</p>
                  <div className="text-xs theme-text-primary whitespace-pre-wrap leading-relaxed bg-black/30 border theme-border-subtle rounded-xl p-3">{activeItem.optimizedPrompt || activeItem.rawPrompt || '-'}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="bg-black/30 border theme-border-subtle rounded-xl p-2 theme-text-secondary">模型: <span className="theme-text-primary">{activeItem.modelId}</span></div>
                  <div className="bg-black/30 border theme-border-subtle rounded-xl p-2 theme-text-secondary">提供商: <span className="theme-text-primary">{activeItem.providerName}</span></div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button onClick={() => handleCopy(activeItem.rawPrompt, '原始提示词')} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider theme-bg-secondary border theme-border-medium theme-text-primary hover:theme-text-primary">
                  <Copy size={12} className="inline mr-1" /> 复制原始提示词
                </button>
                <button onClick={() => handleCopy(activeItem.optimizedPrompt || activeItem.rawPrompt, '优化后提示词')} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/25">
                  <Copy size={12} className="inline mr-1" /> 复制优化提示词
                </button>
                <button onClick={handleApplyToSelectedNode} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/25">
                  <RotateCcw size={12} className="inline mr-1" /> 回填到当前图像节点
                </button>
                <button onClick={handleDownload} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider theme-bg-secondary border theme-border-medium theme-text-primary hover:theme-text-primary">
                  <Download size={12} className="inline mr-1" /> 下载最终图片
                </button>
                <button onClick={() => deleteImageHistory(activeItem.id)} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-rose-500/15 border border-rose-500/25 text-rose-300 hover:bg-rose-500/25">
                  <Trash2 size={12} className="inline mr-1" /> 删除记录
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
