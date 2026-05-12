import React, { useCallback } from 'react';
import { NodeProps } from 'reactflow';
import { NodeData } from '../../types';
import { useStore } from '../../store';
import { BaseNode } from '../BaseNode';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { X, FileBox, FileImage, FileVideo, FileSpreadsheet, UploadCloud } from 'lucide-react';

export const FileUploadNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const updateNodeData = useStore((state) => state.updateNodeData);

    const clearFile = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();

        // Revoke object url if exists to avoid memory leaks
        const currentOutput = data.output as any;
        if (currentOutput && currentOutput.url && currentOutput.url.startsWith('blob:')) {
            URL.revokeObjectURL(currentOutput.url);
        }

        updateNodeData(id, {
            output: null,
            status: 'idle',
            error: undefined
        });
    }, [id, data.output, updateNodeData]);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (!file) return;

        // Clean up previous blob url if exists
        const currentOutput = data.output as any;
        if (currentOutput && currentOutput.url && currentOutput.url.startsWith('blob:')) {
            URL.revokeObjectURL(currentOutput.url);
        }

        updateNodeData(id, {
            output: null,
            status: 'running',
            error: undefined
        });

        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        const normalizedName = file.name.toLowerCase();
        const isExcel = normalizedName.endsWith('.xlsx')
            || normalizedName.endsWith('.xls')
            || normalizedName.endsWith('.csv')
            || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            || file.type === 'application/vnd.ms-excel'
            || file.type === 'text/csv';

        let fileType: 'image' | 'video' | 'xlsx' | 'generic' = 'generic';
        if (isImage) fileType = 'image';
        else if (isVideo) fileType = 'video';
        else if (isExcel) fileType = 'xlsx';

        // We use object URL for images and videos by default instead of Base64
        // to prevent Store memory overflows. Keep base64 fallback only for tiny generic files if needed,
        // but prefer object URL universally.
        const objectUrl = URL.createObjectURL(file);

        let outputData: any = {
            id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
            source: 'local',
            type: fileType,
            name: file.name,
            size: file.size,
            mime: file.type || 'application/octet-stream',
            url: objectUrl,
        };

        if (isExcel) {
            const reader = new FileReader();
            reader.onloadend = async () => {
                try {
                    const dataBuffer = reader.result as ArrayBuffer;
                    const workbook = XLSX.read(dataBuffer, { type: 'array', bookFiles: true });
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const json = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
                    const embeddedImageCount = Object.keys((workbook as any).files || {})
                        .filter((key) => /^xl\/media\//i.test(String(key)))
                        .length;

                    outputData.previewData = json.slice(0, 6); // Top 6 rows
                    outputData.meta = {
                        sheetName: firstSheetName,
                        sheetNames: workbook.SheetNames,
                        sheetCount: workbook.SheetNames.length,
                        rowCount: json.length,
                        columns: json[0]?.length || 0,
                        embeddedImageCount
                    };
                } catch (err) {
                    console.error('Error parsing Excel', err);
                    URL.revokeObjectURL(objectUrl);
                    updateNodeData(id, {
                        output: null,
                        status: 'error',
                        error: 'Excel 解析失败，请检查文件格式是否正确'
                    });
                    return;
                }
                updateNodeData(id, {
                    output: outputData,
                    status: 'success',
                    error: undefined
                });
            };
            reader.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                updateNodeData(id, {
                    output: null,
                    status: 'error',
                    error: 'Excel 读取失败'
                });
            };
            reader.readAsArrayBuffer(file);
        } else {
            updateNodeData(id, {
                output: outputData,
                status: 'success',
                error: undefined
            });
        }
    }, [id, data.output, updateNodeData]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        maxFiles: 1,
    } as any);



    const renderPreview = () => {
        const out = data.output;
        if (!out) return null;

        if (out.type === 'image') {
            return (
                <div className="group relative flex-1 rounded-xl overflow-hidden border theme-border-medium bg-black shadow-inner">
                    <img src={out.url} alt={out.name} className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-500" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button onClick={clearFile} className="p-2 bg-rose-500/80 hover:bg-rose-500 rounded-full text-white shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all">
                            <X size={16} />
                        </button>
                    </div>
                </div>
            );
        }

        if (out.type === 'video') {
            return (
                <div className="group relative flex-1 rounded-xl overflow-hidden border theme-border-medium bg-black shadow-inner flex items-center justify-center">
                    <video src={out.url} controls className="max-w-full max-h-full object-contain" />
                    <button onClick={clearFile} className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-rose-500 rounded-full text-white opacity-0 group-hover:opacity-100 transition-all z-10">
                        <X size={14} />
                    </button>
                </div>
            );
        }

        if (out.type === 'xlsx') {
            const tableData = out.previewData || [];
            return (
                <div className="group relative flex flex-col flex-1 rounded-xl border theme-border-medium theme-bg-secondary shadow-inner overflow-hidden min-h-[120px]">
                    <div className="flex items-center justify-between px-3 py-2 theme-bg-tertiary border-b theme-border-medium shrink-0">
                        <div className="flex items-center gap-2 overflow-hidden">
                            <FileSpreadsheet size={14} className="text-emerald-400 shrink-0" />
                            <span className="text-[10px] theme-text-primary font-bold truncate">{out.name}</span>
                        </div>
                        <button onClick={clearFile} className="p-1 hover:bg-rose-500/20 theme-text-muted hover:text-rose-400 rounded-lg transition-colors">
                            <X size={12} />
                        </button>
                    </div>
                    {typeof out.meta?.embeddedImageCount === 'number' && (
                        <div className="px-3 py-2 border-b theme-border-medium bg-emerald-500/[0.04] flex items-center justify-between text-[9px]">
                            <span className="theme-text-secondary">
                                {Number(out.meta?.sheetCount || 1) > 1
                                    ? `工作表：共 ${out.meta.sheetCount} 个，当前预览 ${out.meta?.sheetName || '未识别'}`
                                    : `工作表：${out.meta?.sheetName || '未识别'}`}
                            </span>
                            <span className="text-emerald-300 font-bold">
                                表内图片 {out.meta.embeddedImageCount} 张
                            </span>
                        </div>
                    )}
                    <div className="flex-1 overflow-auto custom-scrollbar p-2 theme-bg-node-content">
                        {tableData.length > 0 ? (
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr>
                                        {tableData[0]?.map((h: any, i: number) => (
                                            <th key={i} className="px-2 py-1 text-[9px] text-emerald-300 border-b border-emerald-500/20 whitespace-nowrap bg-emerald-500/5">{String(h || '')}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableData.slice(1).map((row: any[], i: number) => (
                                        <tr key={i} className="hover:bg-white/5 transition-colors">
                                            {row.map((cell: any, j: number) => (
                                                <td key={j} className="px-2 py-1 text-[9px] theme-text-secondary border-b theme-border-medium whitespace-nowrap max-w-[100px] truncate" title={String(cell || '')}>{String(cell || '')}</td>
                                            ))}
                                            {/* Fill empty cells if row is shorter than header */}
                                            {Array.from({ length: Math.max(0, (tableData[0]?.length || 0) - row.length) }).map((_, j) => (
                                                <td key={`empty-${j}`} className="px-2 py-1 border-b theme-border-medium"></td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="flex items-center justify-center h-full text-[10px] theme-text-muted">无法预览表格数据</div>
                        )}
                    </div>
                </div>
            );
        }

        // Generic
        return (
            <div className="group relative flex items-center justify-center flex-1 rounded-xl border theme-border-medium theme-bg-secondary shadow-inner">
                <div className="flex flex-col items-center gap-2">
                    <FileBox size={24} className="text-fuchsia-400" />
                    <span className="text-[10px] theme-text-primary font-bold truncate max-w-[120px] text-center">{out.name}</span>
                </div>
                <button onClick={clearFile} className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-rose-500 rounded-full text-white opacity-0 group-hover:opacity-100 transition-all">
                    <X size={14} />
                </button>
            </div>
        );
    };

    return (
        <BaseNode id={id} data={data} icon={UploadCloud} color="bg-fuchsia-500" selected={selected}>
            <div className="p-4 flex-1 flex flex-col gap-3 min-h-[160px] max-h-[300px] relative">
                {data.output ? (
                    renderPreview()
                ) : (
                    <div
                        {...getRootProps()}
                        className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-3 theme-bg-input cursor-pointer group transition-all p-4 ${isDragActive ? 'border-fuchsia-500 bg-fuchsia-500/10' : 'theme-border-medium hover:border-fuchsia-500/50'}`}
                    >
                        <input {...getInputProps()} />
                        <div className={`w-10 h-10 theme-bg-secondary rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-inner ${isDragActive ? 'text-fuchsia-400' : 'theme-text-muted group-hover:text-fuchsia-500'}`}>
                            {isDragActive ? <FileBox size={20} /> : <UploadCloud size={20} />}
                        </div>
                        <div className="text-center">
                            <span className="block text-[10px] theme-text-secondary font-bold uppercase tracking-tight">
                                {isDragActive ? '释放以添加文件' : '点击或拖拽文件到此处'}
                            </span>
                            <span className="block text-[8px] theme-text-muted mt-1 whitespace-pre-wrap">图片 / 视频 / Excel 表格</span>
                        </div>

                    </div>
                )}
                {data.status === 'running' && (
                    <div className="absolute inset-4 theme-bg-overlay backdrop-blur-sm rounded-xl flex items-center justify-center z-20">
                        <div className="w-5 h-5 border-2 border-fuchsia-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                )}
            </div>

        </BaseNode>
    );
};
