# rss2html-cf

将 RSS/Atom feed 转换成简单 HTML 页面的 Cloudflare Worker。零依赖，抓取 → 解析 → 渲染一条龙，通过 URL 参数控制输出。

> [English](README.md) | **中文**

## 特性

- 支持 **RSS 2.0 / RSS 1.0 / Atom** 三种格式
- `url` 参数指定 feed 地址，`limit` 参数控制显示条数
- 自动处理 CDATA、实体转义、相对链接补全
- 输出防 XSS（标题转义、剥离描述中的 `<script>`）
- 零依赖，`wrangler` 即可部署

## 一键部署

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/boypt/rss2html-cf)

点击上方按钮，按提示授权 GitHub 仓库并部署到 Cloudflare，完成后即可获得你的专属地址。

## 网页部署（无需 Git 仓库）

本项目零依赖，直接把代码粘贴进 Cloudflare 网页编辑器即可：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Worker** → **Deploy**
2. 进入刚创建的 Worker → **Edit code**（打开 Code Editor）
3. 清空默认代码，粘贴 [`src/index.js`](src/index.js) 的全部内容
4. 点击 **Deploy**，稍等片刻即可访问 `https://你的worker名.你的子域.workers.dev`

## 手动部署（命令行）

```bash
npm install          # 安装 wrangler
npm run deploy       # 部署到 Cloudflare（首次需 npx wrangler login）
```

## 本地开发

```bash
npm install
npm run dev          # 默认 http://localhost:8787
```

## 使用方式

```
GET /?url=https://example.com/feed.xml&limit=10
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | 是 | feed 地址（http/https） |
| `limit` | 否 | 显示的条目数，默认 10，最大 100 |

示例：

- `https://你的worker地址/?url=https://hnrss.org/frontpage&limit=5`
- `https://你的worker地址/?url=https://feeds.bbci.co.uk/news/rss.xml`

## 项目结构

```
├── src/index.js      # worker 全部逻辑：抓取、解析、渲染
├── wrangler.toml     # Cloudflare Worker 配置
└── package.json      # dev / deploy 脚本
```

## 错误响应

| 状态码 | 场景 |
|--------|------|
| 400 | 缺少或非法 `url` 参数 |
| 404 | feed 无条目 / 路径不存在 |
| 502 | 抓取失败、网络错误或解析失败 |

## License

[MIT](LICENSE)
