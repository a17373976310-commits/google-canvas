import {
    Cpu,
    FileSpreadsheet,
    FileText,
    Filter,
    Images as ImagesIcon,
    Layers,
    List,
    Play,
    Sparkles,
    Upload,
    UploadCloud,
    Video,
    Volume2
} from 'lucide-react';
import { NodeType } from '../types';

export interface NodeCatalogItem {
    type: NodeType;
    label: string;
    desc: string;
    keywords: string[];
    icon: any;
    color: string;
}

export const NODE_CATALOG: NodeCatalogItem[] = [
    { type: NodeType.INPUT, label: '输入文本', desc: '原始提示词输入', keywords: ['输入', 'text', 'prompt'], icon: FileText, color: 'text-blue-400' },
    { type: NodeType.FILE_UPLOAD, label: '文件上传', desc: '支持图片、视频、XLSX', keywords: ['文件', '文档', 'xlsx', '上传'], icon: UploadCloud, color: 'text-fuchsia-400' },
    { type: NodeType.TABLE_PARSE, label: '表格解析', desc: '把 Excel 拆成任务列表', keywords: ['表格', 'xlsx', '解析', 'excel', '任务'], icon: FileSpreadsheet, color: 'text-emerald-400' },
    { type: NodeType.TASK_SELECT, label: '任务选择', desc: '从任务列表中选出一条任务', keywords: ['任务', '选择', 'prompt', '参考图'], icon: List, color: 'text-teal-400' },
    { type: NodeType.BATCH_EXECUTE, label: '批量执行', desc: '按范围批量生成多条任务', keywords: ['批量', '循环', '任务', '生成'], icon: List, color: 'text-cyan-400' },
    { type: NodeType.PRODUCT_IMAGE_MATCH, label: '产品图筛选', desc: '按任务从多张产品图里自动选图', keywords: ['产品图', '匹配', '筛选', '参考图'], icon: Filter, color: 'text-sky-400' },
    { type: NodeType.IMAGE_UPLOAD, label: '图片上传', desc: '本地图片资源', keywords: ['图片', '上传', 'image'], icon: Upload, color: 'text-orange-400' },
    { type: NodeType.MULTI_IMAGE_UPLOAD, label: '多图上传', desc: '批量图片资源', keywords: ['多图', '批量', 'images'], icon: ImagesIcon, color: 'text-amber-400' },
    { type: NodeType.AI_CHAT, label: '智能对话', desc: '大语言模型推理', keywords: ['对话', 'chat', 'llm'], icon: Cpu, color: 'text-indigo-400' },
    { type: NodeType.AI_IMAGE, label: '图像生成', desc: '多模态绘图引擎', keywords: ['绘图', '图像', 'image gen', '生成'], icon: Sparkles, color: 'text-purple-400' },
    { type: NodeType.AI_AUDIO, label: '语音合成', desc: '文本转语音输出', keywords: ['语音', '音频', 'tts'], icon: Volume2, color: 'text-cyan-400' },
    { type: NodeType.AI_VIDEO, label: '视频生成', desc: '动态图像生成', keywords: ['视频', 'video'], icon: Video, color: 'text-rose-400' },
    { type: NodeType.OUTPUT, label: '结果输出', desc: '流程终点展示', keywords: ['结果', '输出', 'output'], icon: Play, color: 'text-emerald-400' },
    { type: NodeType.GROUP, label: '视觉分组', desc: '布局整理容器', keywords: ['分组', 'group', '容器'], icon: Layers, color: 'text-pink-400' },
];
