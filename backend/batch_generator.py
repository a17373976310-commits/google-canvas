import os
import sys
import pandas as pd
import asyncio
import base64
import mimetypes
from dotenv import load_dotenv

# Ensure we can import from the backend directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import execute_node, ExecuteRequest, NodeConfig
from backend.prompts import MAIN_ENGINE_INSTRUCTION

load_dotenv()

# ==========================================
# ⚙️ 核心配置区：在这里配置你的工作目录
# ==========================================
DESKTOP_PATH = os.path.join(os.path.expanduser("~"), "Desktop")
EXCEL_FILE = os.path.join(DESKTOP_PATH, "高温蒸汽清洁机作图需求new.xlsx")

# 👉【新增】：你需要在这个文件夹里放你的原产品图片（参考图），比如 "把手特写.jpg"
MATERIAL_FOLDER = os.path.join(DESKTOP_PATH, "洗地机素材库") 
os.makedirs(MATERIAL_FOLDER, exist_ok=True)

def get_image_base64(image_path: str) -> str:
    """自动将本地图片转换为适合提交给大模型的 Base64 格式"""
    if not os.path.exists(image_path):
        return ""
    mime_type, _ = mimetypes.guess_type(image_path)
    if not mime_type:
        mime_type = "image/jpeg"
        
    with open(image_path, "rb") as image_file:
        encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
        return f"data:{mime_type};base64,{encoded_string}"

async def process_excel_requirements(file_path: str):
    print(f" 开始读取需求表: {file_path}")
    print(f" 素材库已锁定: {MATERIAL_FOLDER}\n")
    
    try:
        # Load all sheets and grab the first one to avoid name mismatch
        dfs = pd.read_excel(file_path, sheet_name=None, engine='openpyxl')
        first_sheet_name = list(dfs.keys())[0]
        df = dfs[first_sheet_name]
        print(f"成功读取工作表: {first_sheet_name}")
        # Clean up empty rows
        df.dropna(how='all', inplace=True)
    except Exception as e:
        print(f"读取 Excel 失败: {e}")
        return

    # Create output directory on desktop
    output_dir = os.path.join(DESKTOP_PATH, "清洁机_AI生成图包_测试")
    os.makedirs(output_dir, exist_ok=True)
    
    print(f" 输出目录已准备: {output_dir}\n")

    # Iterate through each row (requirement) in the Excel file
    # We skip the first row (headers) and iterate through the rest
    for index, row in df.iterrows():
        # Handle NaN values safely
        # 【配置对应列】如果你的Excel里A列是图片名，这里iloc[0]代表第一列。
        image_filename = str(row.iloc[0]) if pd.notna(row.iloc[0]) else "" # 比如填入了: "01正侧面.jpg"
        scene_mode_cn = str(row.iloc[1]) if pd.notna(row.iloc[1]) else "" # B列：场景模式
        demand_text = str(row.iloc[3]) if pd.notna(row.iloc[3]) else "" # 需求列 (Requirements)
        english_text = str(row.iloc[4]) if pd.notna(row.iloc[4]) else "" # 插入的英文列 (English Insertions)
        
        if not demand_text or demand_text == 'nan':
             continue
             
        # SKIP HEADER ROWS
        if "需求" in demand_text or "插入的英文" in english_text:
             print(f"跳过表头行: {index}")
             continue

        demand_str = str(demand_text)
        english_str = str(english_text).replace('\n', ' ')
        scene_mode_cn = str(row.iloc[1]) if pd.notna(row.iloc[1]) else "" # B列：场景模式 (例如: 亚马逊A+, 淘宝主图)
        
        print("==========================================")
        print(f"正在处理 第 {index} 项需求 (模式: {scene_mode_cn})...")
        print(f"原始需求: {demand_str[:50]}...")
        print(f"需插入英文: {english_str[:50]}")
        
        # --- 步骤 0：从素材库加载产品原图（如果有的话）---
        image_base64_data = ""
        if image_filename and image_filename != 'nan':
            image_path = os.path.join(MATERIAL_FOLDER, image_filename)
            image_base64_data = get_image_base64(image_path)
            if image_base64_data:
                print(f"[素材库] 已加载产品参考图: {image_filename}")
            else:
                print(f"[素材库] 未找到参考图: {image_filename}，将使用纯文字生图")
        
        # --- 步骤 1.5：加载智能体助手 (匹配独家配方) ---
        from backend.prompts import PROMPT_TEMPLATES
        
        expert_guidelines = ""
        scene_lower = scene_mode_cn.lower()
        if "亚马逊" in scene_lower and "a+" in scene_lower:
            expert_guidelines = PROMPT_TEMPLATES.get("amazon_detail", "")
        elif "亚马逊" in scene_lower and "白底" in scene_lower:
            expert_guidelines = PROMPT_TEMPLATES.get("amazon_white", "")
        elif "主图" in scene_lower:
            expert_guidelines = PROMPT_TEMPLATES.get("taobao_main", "")
        elif "详情" in scene_lower:
            expert_guidelines = PROMPT_TEMPLATES.get("taobao_detail", "")
        elif "海报" in scene_lower or "创意" in scene_lower:
            expert_guidelines = PROMPT_TEMPLATES.get("creative_poster", "")
            
        if expert_guidelines:
            print(f"[智能体辅脑] 📘 触发专属业务配方！已注入《智能体助手》中的 [{scene_mode_cn}] 规范。")
        else:
            print("[智能体辅脑] 📘 未匹配到特定业务配方，使用通用电商规范。")

        # --- 步骤 1：调用 ChatGPT (AI_CHAT) 将口语化需求转换为专业的生图 Prompt ---
        print("[智能体工作] 正在将需求翻译为纯正的英语生图提示词...")
        
        prompt_instruction = f"""
        # Role
        You are an expert AI Image Prompt Engineer for E-commerce.
        
        # Task
        Translate the following Chinese design requirements into a highly descriptive, professional English prompt for Midjourney/Stable Diffusion.
        
        # Input Data
        [Chinese Requirements]:
        {demand_text}
        
        [Mandatory English Text to Include in Design]:
        {english_text}
        
        # Expert Guidelines (From Agent Assistant):
        {expert_guidelines}
        
        # Rules
        1. OUTPUT ONLY THE FINAL ENGLISH PROMPT. No conversational text, no greetings, no JSON, no formatting blocks.
        2. Describe the scene, lighting, characters, and objects in detail (e.g., highly detailed, 8k resolution, cinematic lighting).
        3. Ensure the prompt explicitly mentions incorporating the [Mandatory English Text].
        4. Strictly follow the 'Expert Guidelines' for layout, tone, and specific constraints.
        """

        # Construct the proper Pydantic ExecuteRequest model expected by main.py's execute_node
        chat_node_data = ExecuteRequest(
            node_id=f"batch_node_{index}",
            node_type="AI_CHAT",
            config=NodeConfig(
                systemInstruction="你是一个专门负责翻译和重写提示词的AI。请直接输出最终的英文提示词文本，不要使用任何JSON格式，不要包含任何前言、后语或额外的标记。",
                modelId="gemini-3.1-pro-preview-customtools"
            ),
            inputs={
                "prompt": prompt_instruction
            },
            api_key="sk-fl70CZroCVYpDJKHprqu9xZbcqjuZPc3cF0C8bLPto1PQDFR",
            base_url="https://api.bltcy.ai/v1"
        )

        try:
            # We must run this in an async context since execute_node is async
            chat_response = await execute_node(chat_node_data)
            translated_prompt = chat_response.get("output", "生成失败")
            
            print(f"[智能体输出] 完美的生图提示词编排完毕：\n{translated_prompt}\n")
            
            # --- 步骤 2：自动调用生图 (AI_IMAGE) 渲染最终效果 ---
            print(f"[智能体工作] 提示词准备就绪，正在交给 AI 视觉大模型生成最终图像...")
            
            # 【核心改进】我们将翻译好的提示词，连同刚才读到内存里的那张原产品大图，一起发过去！
            render_inputs = {"prompt": translated_prompt}
            if image_base64_data:
                # 告诉视觉模型：“看这张图来画！”
                render_inputs["image"] = image_base64_data 
                
            image_node_data = ExecuteRequest(
                node_id=f"batch_node_img_{index}",
                node_type="AI_IMAGE",
                config=NodeConfig(
                    modelId="nano-banana-2-2k", # 因为 flux-pro 需要特殊参数/代理支持，如果是测试先用标准 DALL-E，如果没有可以换回 flux-pro 测试
                    aspectRatio="1:1"
                ),
                inputs=render_inputs,
                api_key="sk-fl70CZroCVYpDJKHprqu9xZbcqjuZPc3cF0C8bLPto1PQDFR",
                base_url="https://api.bltcy.ai/v1"
            )

            try:
                img_response = await execute_node(image_node_data)
                image_url = img_response.get("output", "")
                
                if image_url:
                    print(f"[智能体输出] 图像渲染成功！获取到下载链接：\n{image_url}\n")
                    
                    # --- 步骤 3：下载并保存成品至桌面 ---
                    import urllib.request
                    import time
                    
                    try:
                        img_file = os.path.join(output_dir, f"主图需求_{index}_成图.png")
                        print(f"正在下载图像至: {img_file}")
                        # Add a simple user agent to avoid blocking
                        req = urllib.request.Request(image_url, headers={'User-Agent': 'Mozilla/5.0'})
                        with urllib.request.urlopen(req, timeout=60) as response, open(img_file, 'wb') as out_file:
                            data = response.read()
                            out_file.write(data)
                        print(f"图像已成功保存！\n")
                    except Exception as down_err:
                        print(f"图像下载失败: {down_err}\n")
                else:
                    print("生图失败，未返回图像链接。\n")
                    
            except Exception as img_err:
                print(f"调用 AI_IMAGE 节点异常: {img_err}\n")

            # 保留配置信息的存档
            result_file = os.path.join(output_dir, f"主图需求_{index}_配置清单.txt")
            with open(result_file, "w", encoding="utf-8") as f:
                f.write(f"【原始需求】:\n{demand_text}\n\n")
                f.write(f"【嵌入英文】:\n{english_text}\n\n")
                f.write(f"【AI编排使用的提示词】:\n{translated_prompt}\n")
            
            print(f" 配置文件已保存至: {result_file}")
            
            if True: # Force the loop to stop after ONE successful row
                print("\n[测试模式] 成功执行首行任务并生图，终止后续批量作业...")
                break
            
        except Exception as e:
            print(f" 节点执行异常: {e}")
            break # Stop on first major failure for safety

    print("\n 批量作业完成！所有需求解析均已保存在桌面文件夹。")

if __name__ == "__main__":
    # Ensure OPENAI_API_KEY is minimally populated so the backend doesn't crash on validation
    if not os.getenv("OPENAI_API_KEY"):
        os.environ["OPENAI_API_KEY"] = "sk-mock-key-for-test"
        
    test_file = r"C:\Users\Administrator\Desktop\高温蒸汽清洁机作图需求new.xlsx"
    asyncio.run(process_excel_requirements(test_file))
