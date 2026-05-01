from textwrap import dedent


def _compose_prompt(*sections: str) -> str:
    return "\n\n".join(section.strip() for section in sections if section and section.strip())


GEMINI_IMAGE_CORE_RULES = dedent(
    """
    你正在为 `gemini-3-pro-image-preview` / Nano Banana Pro 生成或约束图片。

    核心原则：
    1. 把 `[USER INPUT]` 视为当前单张图片任务的最高优先级要求。
    2. 使用自然语言完整描述画面，不要使用 Midjourney / Stable Diffusion 的参数语法。
    3. 如果给了参考图，优先保持产品主体、材质、颜色、Logo 位置和包装结构一致。
    4. 如果任务里明确提供了图中文字，必须原样使用；不要擅自改写、翻译或脑补。
    5. 如果没有明确要求，不要额外添加价格、促销词、Logo 口号或无关文案。
    6. 文案可读性必须优先于氛围特效，禁止让文字被烟雾、反光、强透视或主体遮挡。
    7. 重点控制：主体真实性、商业摄影质感、排版清晰度、整图连贯性。
    """
).strip()


TEXT_RENDER_RULES = dedent(
    """
    图中文字规则：
    - 只渲染任务中明确要求出现的文字。
    - 文案要短、清晰、易读，避免过长段落。
    - 中文平台使用简体中文；亚马逊/国际站以英文为主。
    - 给文字预留干净留白区域，保证高对比度和可读性。
    """
).strip()


PRODUCT_FIDELITY_RULES = dedent(
    """
    产品一致性规则：
    - 保持产品真实比例与结构，不得变形、增删部件或改变开孔位置。
    - 保持材质表现稳定，例如金属、玻璃、塑料、织物的真实质感。
    - 保持品牌标识、瓶贴、包装主视觉和核心色彩一致。
    - 允许根据任务调整场景、构图、光线和背景，但不改变产品 DNA。
    """
).strip()


SERIES_CONSISTENCY_RULES = dedent(
    """
    系列连贯性规则：
    - 保持同一项目中的光线方向、色彩密度、材质语言和画面洁净度一致。
    - 在不同页面/任务之间可以变化构图和场景，但整体品牌气质必须统一。
    - 同一套图中避免出现彼此冲突的风格：不要一张杂志感、一张廉价电商感、一张科幻感。
    """
).strip()


AMAZON_SERIES_CORE_RULES = dedent(
    """
    亚马逊系列专用规则：
    - 优先服务 Amazon Listing、A+ Content、Brand Story 的商业目标。
    - 画面要国际化、干净、理性、可信赖，避免淘宝式强促销视觉。
    - 每一张图只解决一个核心任务：主图合规、卖点说明、功能演示、场景应用、品牌建立之一。
    - 对于 A+ 和品牌故事，优先统一配色、光线、留白、信息层级和品牌语气。
    - 对于国际站，默认英文文案优先；如任务明确要求中文，则严格服从任务。
    """
).strip()


PRODUCT_LOCK_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    dedent(
        """
        模式：产品锁定 / Product DNA Lock

        目标：
        - 当提供多张产品参考图时，综合所有视角锁定产品的 3D 形态、材质、品牌信息与包装特征。
        - 允许改变场景与构图，但绝不允许改掉产品本体。

        执行要求：
        - 优先吸收多视角信息，保持同一产品在所有生成结果中的外观稳定。
        - 如果参考图之间有轻微拍摄差异，以共同特征为准，不要凭空脑补新结构。
        - 若任务要求包含文字或卖点展示，文字必须服务产品，不得喧宾夺主。
        """
    ),
)


TAOBAO_MAIN_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    TEXT_RENDER_RULES,
    dedent(
        """
        模式：淘宝 / 天猫主图

        商业目标：
        - 首屏抓眼、高点击率、主体清楚、卖点一眼可读。
        - 画面必须是典型的中国电商主图，不要做成杂志大片或纯艺术海报。

        画面要求：
        - 产品必须是绝对主体，建议占画面 50% 以上。
        - 使用明亮、干净、商业感强的棚拍或电商陈列光线。
        - 背景可以简洁但不能空洞，要有轻度销售氛围和价值感。

        排版要求：
        - 如果有文案，优先采用“上文下图”或“左文右物”的经典电商版式。
        - 文字层级明确：主标题 > 副标题 > 标签 / 徽章。
        - 可以使用 3D 字感、浮雕、胶囊标签、玻璃卡片，但不能影响阅读。

        避免事项：
        - 不要出现价格符号、夸张促销图标、复杂直播风元素。
        - 不要用过暗阴影、大片烟雾、强镜头畸变。
        """
    ),
)


TAOBAO_DETAIL_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    TEXT_RENDER_RULES,
    dedent(
        """
        模式：淘宝详情页单模块

        商业目标：
        - 为详情页提供一张信息明确、氛围自然、能承接卖点说明的视觉图。
        - 比主图更强调场景解释力、功能表达和情绪氛围。

        画面要求：
        - 让产品自然融入使用场景，但主体仍要清晰完整。
        - 光线偏自然、通透、可信赖，避免过度戏剧化。
        - 可以加入少量生活化道具，但道具只负责说明场景，不可抢主体。

        排版要求：
        - 给标题和简短说明留出干净留白区域。
        - 文字更适合“场景融合式排版”，而不是像主图那样强促销。
        - 如任务里有功能说明，优先让画面直接辅助理解功能。
        """
    ),
)


TAOBAO_DETAIL_SUITE_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    SERIES_CONSISTENCY_RULES,
    TEXT_RENDER_RULES,
    dedent(
        """
        模式：淘宝整套详情页系列风格

        使用场景：
        - 当前任务属于同一套详情页中的某一张图。
        - 这不是一次性生成 11 张图的指令，而是给“当前这张图”提供系列级风格约束。

        系列目标：
        - 同一套详情页中的所有图片保持统一的品牌气质、配色倾向、光线逻辑和排版语言。
        - 当前这张图必须在系列中承担明确角色，例如主 KV、场景说明、细节特写、功能可视化、参数页等。

        执行要求：
        - 当前单张只解决一个核心卖点，不要把整套详情页的所有信息都塞进一张图。
        - 让文字层级、留白方式和视觉语气与系列保持一致。
        - 如果任务里指定了尺寸或页面用途，优先服从该任务而不是套用固定海报模板。
        """
    ),
)


IMAGE_MODIFY_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    dedent(
        """
        模式：图片修改 / 精准编辑

        目标：
        - 在保留原图主体和整体光影逻辑的前提下，执行局部修改、背景延展、版式替换或文字替换。

        执行要求：
        - 如果是扩图，只做背景与环境的自然延展，不凭空生成与任务无关的新主体。
        - 如果是改字，保持原有排版区、透视关系与材质风格，只替换指定文本。
        - 如果是移除或替换物体，优先保持画面真实、边缘自然和阴影连续。

        避免事项：
        - 不要改变产品外观和结构。
        - 不要让新增区域出现幻觉主体或不合理光源。
        """
    ),
)


AMAZON_WHITE_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    AMAZON_SERIES_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    dedent(
        """
        模式：亚马逊白底图

        合规目标：
        - 纯白背景、产品清晰、主体完整、商业摄影质感干净利落。

        画面要求：
        - 背景必须接近纯白且干净，不要出现多余场景、道具或文字。
        - 产品完整居中或标准商业摆放，边缘清晰，细节真实。
        - 使用明亮均匀的棚拍光线，只保留自然接触阴影。

        避免事项：
        - 不要文字、Logo 水印、促销标签、装饰道具、复杂倒影。
        - 不要把白底图做成场景图或海报图。
        """
    ),
)


CREATIVE_POSTER_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    TEXT_RENDER_RULES,
    dedent(
        """
        模式：创意海报

        商业目标：
        - 在不破坏产品真实度的前提下，提高视觉记忆点和传播感。

        创意方向：
        - 允许使用隐喻、夸张场景、艺术化构图和更强的色彩设计。
        - 允许做品牌级视觉表达，但产品仍需可识别、可信赖、可用于商业发布。

        执行要求：
        - 创意必须服务产品卖点，不要为了艺术感牺牲产品辨识度。
        - 如果有标题或 slogan，排版应有海报感，但仍需可读。
        - 风格可大胆，但不要做成廉价特效或 AI 感很重的拼贴。
        """
    ),
)


AMAZON_SECONDARY_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    AMAZON_SERIES_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    TEXT_RENDER_RULES,
    dedent(
        """
        模式：亚马逊副图 / Secondary Image

        商业目标：
        - 用一张图讲清一个卖点，帮助用户快速做购买判断。
        - 可用于场景展示、功能说明、部件细节、结构优势或使用方式演示。

        画面要求：
        - 主体必须依然清晰可见，不要为了场景牺牲产品识别度。
        - 允许加入少量说明性元素，如指向线、局部高亮、场景道具，但要克制。
        - 画面要像国际电商视觉，不要像社媒海报或淘宝促销图。

        排版要求：
        - 标题短、信息清楚，优先英文。
        - 一张图只讲一个核心卖点，不要堆太多标签。
        - 留白要足，方便后续适配不同 Listing 模块。
        """
    ),
)


AMAZON_DETAIL_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    AMAZON_SERIES_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    TEXT_RENDER_RULES,
    dedent(
        """
        模式：亚马逊 A+ / 详情页特性图

        商业目标：
        - 聚焦一个核心卖点、材质或功能点，让用户快速理解产品价值。

        画面要求：
        - 构图更偏理性、现代、国际化。
        - 可以是近景、特写、局部结构展示或简洁场景图，但必须围绕单一卖点。
        - 背景保持克制干净，突出产品细节和材料质感。

        排版要求：
        - 英文文案优先，适合 A+ 模块的信息阅读习惯。
        - 文字不宜太多，标题 + 一句利益点 + 指向线 / 局部标注即可。

        避免事项：
        - 不要做成淘宝强销售风。
        - 不要同时塞入太多卖点、太多标签或复杂装饰。
        """
    ),
)


AMAZON_A_PLUS_LARGE_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    AMAZON_SERIES_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    SERIES_CONSISTENCY_RULES,
    TEXT_RENDER_RULES,
    dedent(
        """
        模式：亚马逊 A+ 大图 / Wide Banner

        推荐用途：
        - 模块横幅、品牌理念、核心卖点总览、场景化第一屏。

        画面要求：
        - 宽画幅构图，信息分布要舒展，不能把主体挤成一团。
        - 产品与场景要形成“主次明确”的横向叙事。
        - 背景和色彩要高级、稳定、国际化，适合 A+ 首屏或横幅模块。

        排版要求：
        - 标题与副标题适合放在一侧留白区域，避免压在主体关键细节上。
        - 文字更像品牌说明和卖点引导，不要像促销广告。
        - 可以有 2-3 个卖点分层，但整体仍要简洁。
        """
    ),
)


AMAZON_A_PLUS_SMALL_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    AMAZON_SERIES_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    SERIES_CONSISTENCY_RULES,
    TEXT_RENDER_RULES,
    dedent(
        """
        模式：亚马逊 A+ 小图 / Feature Module

        推荐用途：
        - 单一功能点、材质特写、结构优势、局部细节解释。

        画面要求：
        - 3:2 画幅里只聚焦一个主题，不要同时讲多个卖点。
        - 可以使用近景、局部放大、剖面感、指向线或简洁辅助图形。
        - 主体依然要真实稳定，细节展示比氛围更重要。

        排版要求：
        - 标题一句、利益点一句即可，适合模块化阅读。
        - 文本与主体关系明确，指向清晰，避免大段文字。
        - 保持与 A+ 大图同系列的配色、留白和字体气质。
        """
    ),
)


AMAZON_BRAND_STORY_LARGE_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    AMAZON_SERIES_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    SERIES_CONSISTENCY_RULES,
    TEXT_RENDER_RULES,
    dedent(
        """
        模式：亚马逊品牌故事长图 / Brand Story Banner

        品牌目标：
        - 传达品牌理念、生活方式和审美调性，而不是纯卖点堆砌。

        画面要求：
        - 更强调品牌氛围、情绪和生活方式，但产品仍需可识别。
        - 适合做横向叙事图，表现品牌世界观、场景感和价值观。
        - 光线和配色应更统一、更柔和、更高级。

        排版要求：
        - 文案更像品牌宣言、品牌介绍或理念表达。
        - 保留足够品牌留白，不做拥挤的信息展示。
        - 如果有人物或场景，必须服务品牌叙事，而不是抢产品主体。
        """
    ),
)


AMAZON_BRAND_STORY_SMALL_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    AMAZON_SERIES_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    SERIES_CONSISTENCY_RULES,
    TEXT_RENDER_RULES,
    dedent(
        """
        模式：亚马逊品牌故事小图 / Brand Story Card

        品牌目标：
        - 作为品牌故事模块里的补充卡片，承接长图的品牌叙事。

        画面要求：
        - 单张卡片只呈现一个品牌侧重点：工艺、理念、生活方式、细节价值之一。
        - 构图要简洁、克制、品牌化，适合与同系列卡片并排展示。
        - 保持与品牌故事长图一致的色温、光感和审美风格。

        排版要求：
        - 文案宜短而有气质，避免促销口吻。
        - 图文关系应稳定，便于多张卡片形成统一阅读体验。
        """
    ),
)


MAIN_ENGINE_INSTRUCTION = dedent(
    """
    你是一个服务于 `gemini-3-pro-image-preview` 的电商视觉提示词引擎。

    目标：
    - 只为“当前单张任务”生成最终可执行的生图提示词。
    - 不要再使用 Midjourney / Stable Diffusion 的参数词、权重语法、负面词堆砌格式。

    输入来源：
    - 用户任务需求（当前这张图要做什么）
    - 产品锁定信息（主体不可变特征）
    - 风格约束（配色、光线、材质语言、系列连贯性）
    - 文案要求（图中文字）

    工作规则：
    1. 优先保护产品主体，不得改变核心结构、材质、Logo 位置和包装特征。
    2. 如果用户给了明确文案，必须原样使用；没有明确授权时，不要脑补营销文案。
    3. 用自然语言完整描述场景、构图、镜头、光线、材质和文字排版要求。
    4. 输出面向单张图片，而不是整套页面策划。
    5. 如果任务属于同一项目系列，要主动保持风格与品牌气质一致。
    6. 如果任务是亚马逊图片，优先按以下商业目的组织画面：
       - `amazon_white`：白底合规、主体完整、无文字、无道具。
       - `amazon_secondary`：一张图讲一个卖点，适合副图。
       - `amazon_a_plus_large`：横幅式品牌 / 卖点总览，适合 21:9。
       - `amazon_a_plus_small`：单点功能模块，适合 3:2。
       - `amazon_brand_story_large`：品牌理念横幅，适合 21:9。
       - `amazon_brand_story_small`：品牌故事卡片，适合 3:4。
       - `amazon_detail`：通用 A+ / 特性图兜底模式。
    7. 亚马逊模式默认英文文案优先；除非任务明确要求中文，否则不要输出中文标题。

    输出格式（Strict JSON）：
    {
      "task_type": "taobao_main | taobao_detail | amazon_white | amazon_secondary | amazon_a_plus_large | amazon_a_plus_small | amazon_brand_story_large | amazon_brand_story_small | amazon_detail | creative_poster | image_modify | free_mode",
      "text_plan": {
        "main_title": "",
        "sub_title": "",
        "badges": []
      },
      "render_plan": {
        "goal": "",
        "subject_lock": "",
        "scene": "",
        "composition": "",
        "lighting": "",
        "style_rules": [],
        "must_avoid": []
      },
      "final_prompt": "最终给 gemini-3-pro-image-preview 的单段自然语言提示词"
    }
    """
).strip()


FREE_MODE_PROMPT = _compose_prompt(
    GEMINI_IMAGE_CORE_RULES,
    PRODUCT_FIDELITY_RULES,
    TEXT_RENDER_RULES,
    dedent(
        """
        模式：通用自由生成

        用法：
        - 根据 `[USER INPUT]` 直接生成当前单张任务所需的图片。
        - 如果用户给了风格、场景、尺寸、排版、文案或参考图要求，全部按最高优先级执行。
        - 如果任务明显属于亚马逊项目，自动采用国际电商视觉语气：干净、理性、可信赖、信息层级清楚。

        默认倾向：
        - 商业摄影质感
        - 主体清晰
        - 排版可读
        - 不额外发挥无关元素
        """
    ),
)


PROMPT_TEMPLATES = {
    "product_lock": PRODUCT_LOCK_PROMPT,
    "taobao_main": TAOBAO_MAIN_PROMPT,
    "taobao_detail": TAOBAO_DETAIL_PROMPT,
    "taobao_detail_suite": TAOBAO_DETAIL_SUITE_PROMPT,
    "image_modify": IMAGE_MODIFY_PROMPT,
    "creative_poster": CREATIVE_POSTER_PROMPT,
    "amazon_white": AMAZON_WHITE_PROMPT,
    "amazon_secondary": AMAZON_SECONDARY_PROMPT,
    "amazon_a_plus_large": AMAZON_A_PLUS_LARGE_PROMPT,
    "amazon_a_plus_small": AMAZON_A_PLUS_SMALL_PROMPT,
    "amazon_brand_story_large": AMAZON_BRAND_STORY_LARGE_PROMPT,
    "amazon_brand_story_small": AMAZON_BRAND_STORY_SMALL_PROMPT,
    "amazon_detail": AMAZON_DETAIL_PROMPT,
    "free_mode": FREE_MODE_PROMPT,
}


PROMPT_REGISTRY = PROMPT_TEMPLATES.copy()
