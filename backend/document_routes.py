import base64
import io
import zipfile
from typing import Any, Dict, List
from xml.etree import ElementTree as ET

from fastapi import APIRouter, File, HTTPException, UploadFile


router = APIRouter()

WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
DOCX_IMAGE_LIMIT = 24
DOCX_TEXT_LIMIT = 120_000


def _node_text(node: ET.Element) -> str:
    parts: List[str] = []
    for text_node in node.iter(f"{WORD_NS}t"):
        if text_node.text:
            parts.append(text_node.text)
    return "".join(parts).strip()


def _parse_relationships(zf: zipfile.ZipFile) -> Dict[str, str]:
    try:
        raw = zf.read("word/_rels/document.xml.rels")
    except KeyError:
        return {}

    rels: Dict[str, str] = {}
    root = ET.fromstring(raw)
    for rel in root:
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        if rel_id and target:
            rels[rel_id] = target
    return rels


def _resolve_docx_media_path(target: str) -> str:
    target = target.replace("\\", "/").lstrip("/")
    if target.startswith("word/"):
        return target
    if target.startswith("../"):
        return target.replace("../", "", 1)
    return f"word/{target}"


def _infer_mime(path: str) -> str:
    lower = path.lower()
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".gif"):
        return "image/gif"
    if lower.endswith(".bmp"):
        return "image/bmp"
    if lower.endswith(".svg"):
        return "image/svg+xml"
    return "image/png"


def _extract_docx_images(zf: zipfile.ZipFile) -> List[str]:
    media_paths = [
        name
        for name in zf.namelist()
        if name.lower().startswith("word/media/")
        and name.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"))
    ][:DOCX_IMAGE_LIMIT]

    images: List[str] = []
    for path in media_paths:
        try:
            payload = base64.b64encode(zf.read(path)).decode("ascii")
            images.append(f"data:{_infer_mime(path)};base64,{payload}")
        except Exception:
            continue
    return images


def _parse_docx(payload: bytes) -> Dict[str, Any]:
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as zf:
            try:
                document_xml = zf.read("word/document.xml")
            except KeyError as exc:
                raise HTTPException(status_code=400, detail="DOCX 文件缺少 word/document.xml，无法解析") from exc

            rels = _parse_relationships(zf)
            root = ET.fromstring(document_xml)
            body = root.find(f"{WORD_NS}body")
            sections: List[str] = []
            image_markers: List[str] = []

            if body is not None:
                for child in list(body):
                    if child.tag == f"{WORD_NS}p":
                        text = _node_text(child)
                        if text:
                            sections.append(text)

                        for blip in child.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}blip"):
                            rel_id = blip.attrib.get(f"{REL_NS}embed")
                            target = rels.get(rel_id or "")
                            if target:
                                image_markers.append(_resolve_docx_media_path(target))

                    elif child.tag == f"{WORD_NS}tbl":
                        rows: List[str] = []
                        for row in child.iter(f"{WORD_NS}tr"):
                            cells = [_node_text(cell) for cell in row.iter(f"{WORD_NS}tc")]
                            cells = [cell for cell in cells if cell]
                            if cells:
                                rows.append("\t".join(cells))
                        if rows:
                            sections.append("\n".join(rows))

            images = _extract_docx_images(zf)
            text = "\n\n".join(sections).strip()
            if image_markers:
                text = f"{text}\n\n# 文档内图片引用\n" + "\n".join(dict.fromkeys(image_markers))

            return {
                "text": text[:DOCX_TEXT_LIMIT],
                "images": images,
                "imageCount": len(images),
                "truncated": len(text) > DOCX_TEXT_LIMIT,
            }
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="这不是有效的 DOCX 文件") from exc


@router.post("/agent/parse-document")
async def parse_document(file: UploadFile = File(...)):
    filename = (file.filename or "").lower()
    payload = await file.read()
    if filename.endswith(".docx"):
        return _parse_docx(payload)
    if filename.endswith(".doc"):
        raise HTTPException(status_code=400, detail="暂不支持旧版 .doc，请另存为 .docx 后上传")
    if filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="暂不支持 PDF 正文解析，请先转为 .docx 或复制正文")
    raise HTTPException(status_code=400, detail="暂不支持该文档格式")
