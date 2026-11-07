# 豆包媒体下载助手 / Doubao Media Downloader

Tampermonkey（油猴）脚本集合：**视频下载**与**图片下载**是两个独立的用户脚本，可以同时安装，互不覆盖。

## 安装

1. Chrome / Edge 安装 Tampermonkey 或兼容的用户脚本管理器。
2. 根据需要点击下方脚本链接，进入安装页面并确认安装。
3. 重新打开或刷新 [豆包网页版](https://www.doubao.com/)。

| 脚本 | 功能 | 安装链接 |
| --- | --- | --- |
| `doubao-media-downloader.user.js` | 视频无水印原始资源解析；多视频列表下载；单视频快捷下载（v1.2.0） | [安装视频脚本](https://raw.githubusercontent.com/piboss001/doubao-media-downloader/main/doubao-media-downloader.user.js) |
| `doubao-image-downloader.user.js` | 从响应数据的 `image_ori_raw` 等原图字段提取图片；单张下载、勾选后批量 ZIP（v1.0.0） | [安装图片脚本](https://raw.githubusercontent.com/piboss001/doubao-media-downloader/main/doubao-image-downloader.user.js) |

## 图片助手使用说明

- 在豆包打开一个有 AI 生成图片的聊天，或新生成图片；**第一次安装后记得刷新页面**。
- 页面左下角出现 **🖼️ 原图 N** 按钮。点击打开管理面板，勾选图片后点击 **下载选中 ZIP**。
- 当页面上的图片链接能与捕获的原图数据准确对应时，图片上会显示 **↓ 无水印原图** 按钮，可单独下载。
- ZIP 为无压缩 Store 归档模式（图片已压缩，不再二次压缩），最多每批 60 张、300MB；过大请分批下载。
- 每次切换豆包会话会清除当前缓存，避免下载到其他聊天的图片。

### 原理及限制

脚本在本地监听豆包网页响应，**只使用明确的无水印原图地址**，不抹除或裁剪水印，不上传图片到第三方服务。支持探测 PNG、JPEG、WebP、GIF、AVIF 格式；具体取决于豆包返回的真实格式。

- 如果豆包没有下发 `image_ori_raw` 或其他明确原图字段，脚本不会用有水印预览图冒充原图。
- 不保证支持全部旧聊天、智能编辑图片或豆包后续改版；图片地址过期需要重新加载会话。
- 只能处理你有权访问、使用的图片；平台规则及相关标识要求仍需遵守。
- **当前版本已通过 JavaScript 语法检查；尚未在真实豆包账号的页面上完成端到端验证。** 如果未出现图片，请反馈豆包页面截图与 F12 控制台中的 `[DoubaoImageDL]` 日志。

## 更新记录

- **2026-11-07：图片脚本 v1.0.0** — 新增无水印图片捕获、缩略图面板、单张下载、多选 ZIP、会话隔离；视频 v1.2.0 保持原样。
