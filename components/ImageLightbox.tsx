import React, { useEffect } from 'react';
import { X, Download, ZoomIn, ZoomOut, RotateCw, RotateCcw, Move, Copy, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';

interface ImageLightboxProps {
    src: string;
    alt?: string;
    onClose: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const imageBlobToPng = (blob: Blob): Promise<Blob> => new Promise((resolve, reject) => {
    if (blob.type === 'image/png') {
        resolve(blob);
        return;
    }

    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext('2d');
        if (!context) {
            URL.revokeObjectURL(url);
            reject(new Error('Canvas context unavailable'));
            return;
        }

        context.drawImage(image, 0, 0);
        canvas.toBlob((pngBlob) => {
            URL.revokeObjectURL(url);
            if (pngBlob) {
                resolve(pngBlob);
            } else {
                reject(new Error('PNG conversion failed'));
            }
        }, 'image/png');
    };
    image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image decode failed'));
    };
    image.src = url;
});

export const ImageLightbox: React.FC<ImageLightboxProps> = ({ src, alt, onClose }) => {
    const stageRef = React.useRef<HTMLDivElement>(null);
    const [scale, setScale] = React.useState(1);
    const [rotation, setRotation] = React.useState(0);
    const [offset, setOffset] = React.useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = React.useState(false);
    const [isCopying, setIsCopying] = React.useState(false);
    const [copyStatus, setCopyStatus] = React.useState<string | null>(null);
    const dragRef = React.useRef({ pointerId: -1, startX: 0, startY: 0, offsetX: 0, offsetY: 0, moved: false });

    const resetView = React.useCallback(() => {
        setScale(1);
        setRotation(0);
        setOffset({ x: 0, y: 0 });
    }, []);

    useEffect(() => {
        resetView();
        setCopyStatus(null);
    }, [src, resetView]);

    useEffect(() => {
        if (!copyStatus) return;
        const timer = window.setTimeout(() => setCopyStatus(null), 2200);
        return () => window.clearTimeout(timer);
    }, [copyStatus]);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.body.classList.add('image-lightbox-open');

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key === '0') resetView();
            if (event.key === '+' || event.key === '=') setScale((value) => clamp(value + 0.2, 0.15, 8));
            if (event.key === '-' || event.key === '_') setScale((value) => clamp(value - 0.2, 0.15, 8));
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.body.classList.remove('image-lightbox-open');
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
        event.stopPropagation();
        if (event.target === event.currentTarget && !dragRef.current.moved) {
            onClose();
        }
    }, [onClose]);

    const stopLightboxEvent = React.useCallback((event: React.SyntheticEvent) => {
        event.stopPropagation();
    }, []);

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

    const handleCopyImage = async () => {
        if (isCopying) return;

        setIsCopying(true);
        setCopyStatus(null);

        try {
            const response = await fetch(src, src.startsWith('data:') ? undefined : { mode: 'cors' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const pngBlob = await imageBlobToPng(blob);

            if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
                throw new Error('Image clipboard unavailable');
            }

            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': pngBlob }),
            ]);
            setCopyStatus('已复制图片');
        } catch {
            try {
                if (!src.startsWith('data:') && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(src);
                    setCopyStatus('已复制图片链接');
                    return;
                }
            } catch {
                // Keep the user-facing failure below.
            }
            setCopyStatus('复制失败，请尝试下载');
        } finally {
            setIsCopying(false);
        }
    };

    return createPortal(
        <div
            className="image-lightbox-root fixed inset-0 z-[1000] bg-black/92 backdrop-blur-xl flex flex-col animate-in fade-in duration-200 select-none"
            data-image-lightbox="true"
            onPointerDown={stopLightboxEvent}
            onMouseDown={stopLightboxEvent}
            onMouseUp={stopLightboxEvent}
            onClick={handleBackdropClick}
            onDoubleClick={stopLightboxEvent}
            onContextMenu={stopLightboxEvent}
            onWheel={stopLightboxEvent}
        >
            <div className="flex items-center justify-between gap-4 p-4 md:p-6 shrink-0" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-xl bg-white/5 text-indigo-200">
                        <Move size={16} />
                    </div>
                    <div className="min-w-0">
                        <div className="text-[10px] font-black text-white uppercase tracking-[0.28em]">图片预览</div>
                        <div className="mt-1 text-[9px] theme-text-muted truncate">滚轮缩放，拖拽移动，双击放大/复位</div>
                    </div>
                </div>

                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 p-1.5 shadow-2xl">
                    <button
                        onClick={() => zoomBy(-0.25)}
                        className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl theme-text-secondary hover:theme-text-primary transition-all"
                        title="缩小 (-)"
                    >
                        <ZoomOut size={17} />
                    </button>
                    <span className="text-xs theme-text-primary font-bold w-16 text-center tabular-nums">{Math.round(scale * 100)}%</span>
                    <button
                        onClick={() => zoomBy(0.25)}
                        className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl theme-text-secondary hover:theme-text-primary transition-all"
                        title="放大 (+)"
                    >
                        <ZoomIn size={17} />
                    </button>
                    <div className="w-px h-6 bg-white/10 mx-1" />
                    <button
                        onClick={() => setRotation((value) => value - 90)}
                        className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl theme-text-secondary hover:theme-text-primary transition-all"
                        title="向左旋转"
                    >
                        <RotateCcw size={17} />
                    </button>
                    <button
                        onClick={() => setRotation((value) => value + 90)}
                        className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl theme-text-secondary hover:theme-text-primary transition-all"
                        title="向右旋转"
                    >
                        <RotateCw size={17} />
                    </button>
                    <button
                        onClick={resetView}
                        className="px-3 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-black theme-text-secondary hover:theme-text-primary transition-all"
                        title="复位 (0)"
                    >
                        复位
                    </button>
                    <div className="w-px h-6 bg-white/10 mx-1" />
                    <button
                        onClick={handleCopyImage}
                        disabled={isCopying}
                        data-testid="image-lightbox-copy"
                        className="p-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-60 disabled:cursor-wait rounded-xl theme-text-secondary hover:theme-text-primary transition-all"
                        title="复制图片"
                    >
                        {isCopying ? <Loader2 size={17} className="animate-spin" /> : <Copy size={17} />}
                    </button>
                    <button
                        onClick={handleDownload}
                        className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl theme-text-secondary hover:theme-text-primary transition-all"
                        title="下载图片"
                    >
                        <Download size={17} />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-2.5 bg-white/5 hover:bg-rose-500/20 rounded-xl theme-text-secondary hover:text-rose-400 transition-all"
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
                {copyStatus && (
                    <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[11px] font-bold text-white shadow-2xl backdrop-blur-md pointer-events-none">
                        {copyStatus}
                    </div>
                )}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_0,transparent_32%),linear-gradient(45deg,rgba(255,255,255,0.035)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.035)_75%),linear-gradient(45deg,rgba(255,255,255,0.035)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.035)_75%)] bg-[length:auto,28px_28px,28px_28px] bg-[position:center,0_0,14px_14px] opacity-50 pointer-events-none" />
                <div className="absolute inset-0 flex items-center justify-center p-6 md:p-10 pointer-events-none">
                    <img
                        src={src}
                        alt={alt || 'Preview image'}
                        className="max-w-full max-h-full object-contain rounded-2xl shadow-[0_30px_120px_rgba(0,0,0,0.75)] will-change-transform pointer-events-auto"
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
                <span className="text-[9px] theme-text-muted font-bold uppercase tracking-widest">
                    Esc 关闭 · 滚轮缩放 · 拖拽移动 · 双击放大/复位 · 0 复位
                </span>
            </div>
        </div>,
        document.body
    );
};
