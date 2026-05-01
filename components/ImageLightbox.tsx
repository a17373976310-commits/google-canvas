import React, { useEffect } from 'react';
import { X, Download, ZoomIn, ZoomOut, RotateCw, RotateCcw, Move } from 'lucide-react';
import { createPortal } from 'react-dom';

interface ImageLightboxProps {
    src: string;
    alt?: string;
    onClose: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const ImageLightbox: React.FC<ImageLightboxProps> = ({ src, alt, onClose }) => {
    const stageRef = React.useRef<HTMLDivElement>(null);
    const [scale, setScale] = React.useState(1);
    const [rotation, setRotation] = React.useState(0);
    const [offset, setOffset] = React.useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = React.useState(false);
    const dragRef = React.useRef({ pointerId: -1, startX: 0, startY: 0, offsetX: 0, offsetY: 0, moved: false });

    const resetView = React.useCallback(() => {
        setScale(1);
        setRotation(0);
        setOffset({ x: 0, y: 0 });
    }, []);

    useEffect(() => {
        resetView();
    }, [src, resetView]);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key === '0') resetView();
            if (event.key === '+' || event.key === '=') setScale((value) => clamp(value + 0.2, 0.15, 8));
            if (event.key === '-' || event.key === '_') setScale((value) => clamp(value - 0.2, 0.15, 8));
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose, resetView]);

    const zoomBy = React.useCallback((delta: number, focal?: { x: number; y: number }) => {
        setScale((currentScale) => {
            const nextScale = clamp(currentScale + delta, 0.15, 8);
            if (nextScale === currentScale) return currentScale;

            if (focal && stageRef.current) {
                const rect = stageRef.current.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const focalX = focal.x - centerX;
                const focalY = focal.y - centerY;
                const ratio = nextScale / currentScale;
                setOffset((currentOffset) => ({
                    x: focalX - (focalX - currentOffset.x) * ratio,
                    y: focalY - (focalY - currentOffset.y) * ratio,
                }));
            }

            return nextScale;
        });
    }, []);

    const handleWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        const direction = event.deltaY > 0 ? -1 : 1;
        zoomBy(direction * 0.18, { x: event.clientX, y: event.clientY });
    }, [zoomBy]);

    const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: offset.x,
            offsetY: offset.y,
            moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsDragging(true);
    }, [offset.x, offset.y]);

    const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!isDragging || drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        setOffset({
            x: drag.offsetX + dx,
            y: drag.offsetY + dy,
        });
    }, [isDragging]);

    const stopDragging = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current.pointerId === event.pointerId) {
            try {
                event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {
                // Pointer capture may already be released when the pointer leaves the window.
            }
        }
        setIsDragging(false);
    }, []);

    const handleDoubleClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (scale > 1.05 || Math.abs(offset.x) > 2 || Math.abs(offset.y) > 2 || rotation !== 0) {
            resetView();
            return;
        }
        zoomBy(1, { x: event.clientX, y: event.clientY });
    }, [offset.x, offset.y, resetView, rotation, scale, zoomBy]);

    const handleBackdropClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && !dragRef.current.moved) {
            onClose();
        }
    }, [onClose]);

    const handleDownload = async () => {
        const filename = `generated-image-${Date.now()}.png`;

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
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 z-[1000] bg-black/92 backdrop-blur-xl flex flex-col animate-in fade-in duration-200 select-none"
            onClick={handleBackdropClick}
        >
            <div className="flex items-center justify-between gap-4 p-4 md:p-6 shrink-0" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-xl bg-white/5 text-indigo-200">
                        <Move size={16} />
                    </div>
                    <div className="min-w-0">
                        <div className="text-[10px] font-black text-white uppercase tracking-[0.28em]">图片预览</div>
                        <div className="mt-1 text-[9px] text-gray-500 truncate">滚轮缩放，拖拽移动，双击放大/复位</div>
                    </div>
                </div>

                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 p-1.5 shadow-2xl">
                    <button
                        onClick={() => zoomBy(-0.25)}
                        className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-all"
                        title="缩小 (-)"
                    >
                        <ZoomOut size={17} />
                    </button>
                    <span className="text-xs text-gray-300 font-bold w-16 text-center tabular-nums">{Math.round(scale * 100)}%</span>
                    <button
                        onClick={() => zoomBy(0.25)}
                        className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-all"
                        title="放大 (+)"
                    >
                        <ZoomIn size={17} />
                    </button>
                    <div className="w-px h-6 bg-white/10 mx-1" />
                    <button
                        onClick={() => setRotation((value) => value - 90)}
                        className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-all"
                        title="向左旋转"
                    >
                        <RotateCcw size={17} />
                    </button>
                    <button
                        onClick={() => setRotation((value) => value + 90)}
                        className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-all"
                        title="向右旋转"
                    >
                        <RotateCw size={17} />
                    </button>
                    <button
                        onClick={resetView}
                        className="px-3 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-black text-gray-400 hover:text-white transition-all"
                        title="复位 (0)"
                    >
                        复位
                    </button>
                    <div className="w-px h-6 bg-white/10 mx-1" />
                    <button
                        onClick={handleDownload}
                        className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-all"
                        title="下载图片"
                    >
                        <Download size={17} />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-2.5 bg-white/5 hover:bg-rose-500/20 rounded-xl text-gray-400 hover:text-rose-400 transition-all"
                        title="关闭 (Esc)"
                    >
                        <X size={17} />
                    </button>
                </div>
            </div>

            <div
                ref={stageRef}
                className={`relative flex-1 overflow-hidden touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                onClick={(event) => event.stopPropagation()}
                onWheel={handleWheel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
                onDoubleClick={handleDoubleClick}
            >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_0,transparent_32%),linear-gradient(45deg,rgba(255,255,255,0.035)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.035)_75%),linear-gradient(45deg,rgba(255,255,255,0.035)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.035)_75%)] bg-[length:auto,28px_28px,28px_28px] bg-[position:center,0_0,14px_14px] opacity-50 pointer-events-none" />
                <div className="absolute inset-0 flex items-center justify-center p-6 md:p-10 pointer-events-none">
                    <img
                        src={src}
                        alt={alt || 'Preview image'}
                        className="max-w-full max-h-full object-contain rounded-2xl shadow-[0_30px_120px_rgba(0,0,0,0.75)] will-change-transform pointer-events-none"
                        style={{
                            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) rotate(${rotation}deg) scale(${scale})`,
                            transformOrigin: 'center center',
                            transition: isDragging ? 'none' : 'transform 140ms ease-out',
                        }}
                        draggable={false}
                    />
                </div>
            </div>

            <div className="p-3 text-center shrink-0 pointer-events-none">
                <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">
                    Esc 关闭 · 滚轮缩放 · 拖拽移动 · 双击放大/复位 · 0 复位
                </span>
            </div>
        </div>,
        document.body
    );
};
