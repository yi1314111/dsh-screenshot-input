# 截图输入（Screenshot Input）

在 DeepSeek Harness Web 界面的输入框工具行添加一个截图按钮：点击后**直接进入系统截图**（与按下 `Win+Shift+S` 等效），在屏幕上框选区域后，截图自动作为普通图片附件加入当前草稿，可直接发送。

## 行为

- 按钮位于输入框左下工具行（权限、计划控件之后），28px 圆形按钮，与宿主“+”按钮同一套几何与状态样式。
- 点击后由 Host 侧向系统发送 `Win+Shift+S`，弹出 Windows 自带的截图遮罩；框选完成后 Host 从剪贴板取回图片（按内容哈希判断“新图”，不会误取旧剪贴板图片），再把 PNG 交给页面。
- 页面把 PNG 作为普通草稿图片附件提交给输入框：预览、删除、提交、持久化全部走宿主原有管线，不自动发送。
- 用户按 Esc 取消截图时不产生提示；上一次截图未结束时再次点击会提示“还在进行”。
- 遵守宿主图片上限：超过单张字节上限时自动缩小重编码；超过单条消息图片数量上限时在输入框下方给出提示。
- Host 路由不存在时（例如非 Windows 或未启用 Web 服务），自动退回浏览器屏幕共享（`getDisplayMedia`），再不行则读取剪贴板图片。

## 结构

- `index.js`：Host 半，注册 `/screenshot-input/snip`（POST，返回 PNG）与 `/screenshot-input/ping`（诊断）；仅在 Windows 上启用。请求只接受应用自身来源（桌面壳转发的请求没有 Origin）。
- 截图脚本：由 Host 写入临时目录，使用 Windows PowerShell（STA）调用 `keybd_event` 发送 Win+Shift+S，轮询剪贴板序列号与图片哈希，成功后保存 PNG，退出码 0/3 区分成功与取消。
- `client.js`：浏览器半，按钮与输入框下方提示行；点击后先调用 Host 路由，拿不到原生路由时回退浏览器捕获。

## 安装

作为本地 bundle 通过 Plugin Manager 安装：

```
plugin_manager install_bundle(".../plugins/dsh-screenshot-input")
```

`cordis.patch.yml` 插入一行 `screenshot-input`；客户端模块由 `dsh.client` 声明在页面启动时加载。

## 限制

- 依赖 Windows 自带的截图工具与 `Win+Shift+S` 热键；若系统禁用了该热键，会提示改用系统截图后粘贴。
- 一次点击抓取一张区域截图；不提供标注、连续录制或截图历史。
- 抓取期间 Host 会保持一个最长约 60 秒的请求等待用户框选。
