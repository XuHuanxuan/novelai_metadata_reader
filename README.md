# NovelAI Metadata Reader

一个基于 Vue 3 + Vite 的本地 PNG 元数据读取工具，用于查看 NovelAI 生成图片中写入的 `Comment` 属性信息。

## 功能

- 支持点击选择或拖拽上传 PNG 文件
- 在浏览器本地解析 PNG
- 读取 PNG 文本块中的 `Comment` 元数据
- 自动识别 JSON 或松散键值对内容，并以表格展示
- 提供图片预览和基础错误提示

## 技术栈

- Vue 3
- Vite
- JavaScript
- CSS

## 环境要求

建议使用较新的 Node.js LTS 版本。

读取压缩文本块时依赖浏览器的 `DecompressionStream` API。如果当前浏览器不支持该 API，普通未压缩文本块仍可读取。

## 安装

```bash
npm install
```

## 本地开发

```bash
npm run dev
```

启动后根据终端提示打开本地地址，通常是：

```text
http://localhost:5173/
```

## 构建

```bash
npm run build
```

构建产物会输出到 `dist/` 目录。

## 预览构建产物

```bash
npm run preview
```

## 使用方法

1. 打开页面。
2. 点击上传区域选择 PNG 文件，或将 PNG 文件拖入上传区域。
3. 页面会显示图片预览。
4. 如果图片中存在 keyword 为 `Comment` 的文本属性，会在“属性”区域展示解析结果。

## 项目结构

```text
.
├── public/              # 静态资源
├── src/
│   ├── App.vue          # 主页面和 PNG 元数据解析逻辑
│   ├── main.js          # Vue 应用入口
│   └── style.css        # 页面样式
├── index.html
├── package.json
└── vite.config.js
```

## 注意事项

- 当前工具只接受 PNG 文件。
- 目前只展示 keyword 为 `Comment` 的文本属性。
- 文件解析在浏览器端完成，适合离线或私密场景使用。
