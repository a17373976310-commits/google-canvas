// 请在浏览器打开你本地的画板页面 (http://localhost:5000)
// 然后按 F12 打开开发者工具，切换到 Console (控制台) 面板
// 将下面这段代码粘贴进去并回车：

(function exportMySettings() {
    const apiProviders = localStorage.getItem('api_providers');
    const savedWorkflowsIndex = localStorage.getItem('saved_workflows');
    const savedWorkflowPayloads = localStorage.getItem('saved_workflow_local_payloads');

    const result = {
        apiProviders: apiProviders ? JSON.parse(apiProviders) : [],
        savedWorkflowsIndex: savedWorkflowsIndex ? JSON.parse(savedWorkflowsIndex) : [],
        savedWorkflowPayloads: savedWorkflowPayloads ? JSON.parse(savedWorkflowPayloads) : {}
    };

    const jsonString = JSON.stringify(result, null, 2);

    // 自动下载配置为 json 文件
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-canvas-defaults.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log("%c🎉 配置已自动下载为 my-canvas-defaults.json", "color: #10b981; font-weight: bold; font-size: 14px;");
    console.log("请把下载好的文件内容发给 AI 助手！");
})();
