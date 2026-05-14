import React from 'react';
import { NodeProps } from 'reactflow';
import { Copy, Download, Layers3, Palette, Plus, Trash2, Type } from 'lucide-react';
import { useStore } from '../../store';
import { DesignBoardConfig, DesignBoardTextLayer, NodeData } from '../../types';
import { ensureCanvasFontsLoaded, getCanvasFontStack } from '../../services/fontRegistry';
import { buildDesignBoardOutput, createDesignBoardTextLayer, normalizeDesignBoardConfig } from '../../utils/designBoard';
import { renderDesignBoardToDataUrl } from '../../utils/designBoardRenderer';
import { normalizeImageSrc } from '../../utils/normalizeImageSrc';
import { BaseNode } from '../BaseNode';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getLayerTextShadow = (layer: DesignBoardTextLayer, scale: number) => {
  if (!layer.shadow?.enabled) return undefined;
  const x = Math.round(layer.shadow.x * scale * 10) / 10;
  const y = Math.round(layer.shadow.y * scale * 10) / 10;
  const blur = Math.round(layer.shadow.blur * scale * 10) / 10;
  return `${x}px ${y}px ${blur}px ${layer.shadow.color}`;
};

const getLayerStyle = (
  layer: DesignBoardTextLayer,
  board: DesignBoardConfig,
  scale: number
): React.CSSProperties => ({
  left: `${layer.x}%`,
  top: `${layer.y}%`,
  width: `${layer.width}%`,
  transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
  fontFamily: getCanvasFontStack(layer.fontId),
  fontSize: `${Math.max(8, layer.fontSize * scale)}px`,
  color: layer.color,
  opacity: layer.opacity,
  textAlign: layer.align,
  lineHeight: layer.lineHeight,
  letterSpacing: `${layer.letterSpacing * scale}px`,
  textShadow: getLayerTextShadow(layer, scale),
  WebkitTextStroke: layer.stroke?.enabled ? `${Math.max(0.4, layer.stroke.width * scale)}px ${layer.stroke.color}` : undefined,
  zIndex: Number(layer.zIndex ?? 10),
});

export const DesignBoardNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const updateNodeData = useStore((state) => state.updateNodeData);
  const board = React.useMemo(() => normalizeDesignBoardConfig(data.config), [data.config]);
  const boardRef = React.useRef(board);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = React.useState(0);
  const [isExporting, setIsExporting] = React.useState(false);

  React.useEffect(() => {
    void ensureCanvasFontsLoaded();
  }, []);

  React.useEffect(() => {
    boardRef.current = board;
  }, [board]);

  React.useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return undefined;

    const updateSize = () => setStageWidth(element.getBoundingClientRect().width);
    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const selectedLayer = board.layers.find((layer) => layer.id === board.selectedLayerId) || board.layers[0];
  const selectedLayerTextRows = React.useMemo(() => {
    const lineCount = String(selectedLayer?.text || '').split('\n').length;
    return Math.max(3, Math.min(6, lineCount + 1));
  }, [selectedLayer?.text]);
  const scale = stageWidth > 0 ? stageWidth / board.boardWidth : 0.34;
  const upstreamBackground = normalizeImageSrc(
    data.inputs?.cleanImage
    ?? data.inputs?.backgroundImage
    ?? data.inputs?.image
    ?? data.inputs?.sourceImage
    ?? data.inputs?.default
  );
  const backgroundImage = upstreamBackground || board.backgroundImage || undefined;

  const commitBoard = React.useCallback((nextBoard: DesignBoardConfig) => {
    const normalized = normalizeDesignBoardConfig(nextBoard);
    boardRef.current = normalized;
    updateNodeData(id, {
      config: {
        ...data.config,
        ...normalized,
      },
      output: buildDesignBoardOutput(normalized, data.inputs),
      error: undefined,
    });
  }, [data.config, data.inputs, id, updateNodeData]);

  const updateLayer = React.useCallback((layerId: string, patch: Partial<DesignBoardTextLayer>) => {
    const current = boardRef.current;
    const nextBoard = {
      ...current,
      selectedLayerId: layerId,
      layers: current.layers.map((layer) => (
        layer.id === layerId ? { ...layer, ...patch } : layer
      )),
    };
    commitBoard(nextBoard);
  }, [commitBoard]);

  const selectLayer = React.useCallback((layerId: string) => {
    commitBoard({ ...boardRef.current, selectedLayerId: layerId });
  }, [commitBoard]);

  const addLayer = () => {
    const current = boardRef.current;
    const layer = createDesignBoardTextLayer({
      name: `文字 ${current.layers.length + 1}`,
      text: '新文字',
      x: 50,
      y: clamp(42 + current.layers.length * 8, 18, 82),
      width: 64,
      fontId: selectedLayer?.fontId || 'youshe-title',
      fontSize: selectedLayer?.fontSize || 64,
      color: selectedLayer?.color || '#171717',
      shadow: selectedLayer?.shadow,
      stroke: selectedLayer?.stroke,
    });
    commitBoard({
      ...current,
      selectedLayerId: layer.id,
      layers: [...current.layers, layer],
    });
  };

  const duplicateLayer = () => {
    if (!selectedLayer) return;
    const current = boardRef.current;
    const layer = createDesignBoardTextLayer({
      ...selectedLayer,
      id: undefined,
      name: `${selectedLayer.name} 副本`,
      x: clamp(selectedLayer.x + 4, 0, 100),
      y: clamp(selectedLayer.y + 4, 0, 100),
    });
    commitBoard({
      ...current,
      selectedLayerId: layer.id,
      layers: [...current.layers, layer],
    });
  };

  const deleteLayer = () => {
    if (!selectedLayer || board.layers.length <= 1) return;
    const nextLayers = board.layers.filter((layer) => layer.id !== selectedLayer.id);
    commitBoard({
      ...board,
      selectedLayerId: nextLayers[0]?.id,
      layers: nextLayers,
    });
  };

  const exportImage = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const renderedImage = await renderDesignBoardToDataUrl(boardRef.current, data.inputs);
      updateNodeData(id, {
        output: buildDesignBoardOutput(boardRef.current, data.inputs, renderedImage),
        error: undefined,
      });

      const link = document.createElement('a');
      link.href = renderedImage;
      link.download = `${data.label || 'design-board'}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error: any) {
      const message = error?.message || 'Design board export failed';
      updateNodeData(id, {
        output: buildDesignBoardOutput(boardRef.current, data.inputs, undefined, message),
        error: message,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleLayerPointerDown = (event: React.PointerEvent<HTMLButtonElement>, layer: DesignBoardTextLayer) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = layer.x;
    const originY = layer.y;

    selectLayer(layer.id);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = ((moveEvent.clientX - startX) / rect.width) * 100;
      const dy = ((moveEvent.clientY - startY) / rect.height) * 100;
      const current = boardRef.current;
      const nextBoard = {
        ...current,
        selectedLayerId: layer.id,
        layers: current.layers.map((item) => (
          item.id === layer.id
            ? { ...item, x: clamp(originX + dx, 0, 100), y: clamp(originY + dy, 0, 100) }
            : item
        )),
      };
      commitBoard(nextBoard);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  return (
    <BaseNode id={id} data={data} icon={Palette} color="bg-violet-500" selected={selected}>
      <div className="design-board-node flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="design-board-stage-shell nodrag nopan" data-node-interactive="true">
          <div className="design-board-stage-meta">
            <span>{board.boardWidth} x {board.boardHeight}</span>
            <span>{data.output?.primaryUrl ? '已导出' : `${board.layers.length} 图层`}</span>
          </div>
          <div
            ref={stageRef}
            className="design-board-stage"
            style={{
              aspectRatio: `${board.boardWidth} / ${board.boardHeight}`,
              backgroundColor: board.backgroundColor,
              backgroundImage: backgroundImage ? `url("${backgroundImage}")` : undefined,
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
          >
            {!backgroundImage && <div className="design-board-paper-grain" aria-hidden="true" />}
            {board.layers.map((layer) => {
              const isSelected = selectedLayer?.id === layer.id;
              return (
                <button
                  key={layer.id}
                  type="button"
                  className={`design-board-text-layer ${isSelected ? 'is-selected' : ''}`}
                  data-node-interactive="true"
                  style={getLayerStyle(layer, board, scale)}
                  onPointerDown={(event) => handleLayerPointerDown(event, layer)}
                  title="拖动文字图层"
                >
                  {layer.text || ' '}
                </button>
              );
            })}
          </div>
        </div>

        <div className="design-board-toolbar nodrag nopan" data-node-interactive="true">
          <button type="button" onClick={addLayer} title="添加文字">
            <Plus size={13} />
            <span>文字</span>
          </button>
          <button type="button" onClick={duplicateLayer} disabled={!selectedLayer} title="复制图层">
            <Copy size={13} />
          </button>
          <button type="button" onClick={deleteLayer} disabled={!selectedLayer || board.layers.length <= 1} title="删除图层">
            <Trash2 size={13} />
          </button>
          <button type="button" onClick={() => void exportImage()} disabled={isExporting} title="导出 PNG">
            <Download size={13} />
            <span>{isExporting ? '导出中' : 'PNG'}</span>
          </button>
          <div className="design-board-toolbar-divider" />
          <span className="design-board-selected-name">
            <Layers3 size={13} />
            {selectedLayer?.name || '未选中'}
          </span>
        </div>

        {selectedLayer && (
          <div className="design-board-inspector is-simple custom-scrollbar nodrag nopan" data-node-interactive="true">
            <label className="design-board-field is-wide">
              <span><Type size={12} />当前文字</span>
              <textarea
                value={selectedLayer.text}
                rows={selectedLayerTextRows}
                onChange={(event) => updateLayer(selectedLayer.id, { text: event.target.value })}
                placeholder="输入要显示在画板上的文字"
                title={selectedLayer.text}
              />
            </label>

            <div className="design-board-size-control">
              <label className="design-board-field is-wide">
                <span>文字大小</span>
                <input
                  type="range"
                  min={10}
                  max={260}
                  step={1}
                  value={Math.round(selectedLayer.fontSize)}
                  onChange={(event) => updateLayer(selectedLayer.id, { fontSize: Number(event.target.value) || 10 })}
                />
              </label>
              <input
                className="design-board-size-number"
                type="number"
                min={10}
                max={260}
                value={Math.round(selectedLayer.fontSize)}
                onChange={(event) => updateLayer(selectedLayer.id, { fontSize: Number(event.target.value) || 10 })}
                aria-label="文字大小"
              />
            </div>

            <div className="design-board-edit-hint">
              点击画板上的文字进行选择，按住文字直接拖动位置。
            </div>
          </div>
        )}
      </div>
    </BaseNode>
  );
};
