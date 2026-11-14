# CrazyWords

面向自学用户的英语背单词 Web MVP：导入自有词表 → 设定每日目标 → **强制麦克风**的一对一听写（释义拼写 + 可关闭的例句挖空）→ SRS / 错词本复习。辅线：语音查词。

> 产品方案 SSOT 在项目 Agent Store：`docs/crazywords-product-plan.md`（本仓库不改该文档）。

## 本地启动

```bash
npm install
cp .env.example .env
npx prisma migrate deploy
npm run gen:import-template   # 可选：重新生成 Excel 模板
npm run db:seed               # 可选：写入样例 +「上海初中考纲 2026」到 seed 用户
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。每个浏览器有独立会话用户（httpOnly cookie）。

可选：`APP_ACCESS_PASSWORD` 开启访问门禁。本机 ASR 转码需 **ffmpeg**。

## 导入方式

导入页支持：

1. **CSV / Excel 批量**：表头 `word,gloss_zh,ipa,pos,example,phrases,related`；同词**覆盖**  
   - 接受 `.csv` / `.xlsx` / `.xls`  
   - [下载 Excel 模板](/api/import/template)（亦见 `public/templates/words-import.xlsx`、`samples/words.sample.xlsx`）
2. **手工单条**：必填单词；可选音标/词性/释义/例句等  
3. **语音输入单词**：麦克风 → ASR（英文）→ 填入 lemma，并可自动补全  
4. **自动补全**：Free Dictionary API（可回退 Datamuse）+ MyMemory 英译中；失败则手填并标「资料不全」  
5. **预设考纲**：一键导入「上海初中考纲 2026」，或 `npm run db:seed`

```bash
# 批量 API 示例
curl -F "file=@samples/words.sample.xlsx" -F "listName=样例" http://localhost:3000/api/import
curl -X POST http://localhost:3000/api/import/preset -H 'Content-Type: application/json' -d '{"preset":"shanghai-2026"}'
```

## 上海初中考纲 2026 词表

- 文件：[`samples/shanghai-zhongkao-2026.csv`](samples/shanghai-zhongkao-2026.csv)（约 **1808** 个唯一单词 lemma，不含词组单元）
- 来源与局限：见 [`samples/SOURCES.md`](samples/SOURCES.md)  
  - 公开索引：https://word.threeher.cn/books/8a30627116e68c1f/（《2026年上海市初中英语考纲词汇 用法手册》网页整理）  
  - 部分释义合并自 https://github.com/mahavivo/english-wordlists 中考公开词表  
  - **非**考试院官方机读 PDF；请以当年《考试手册》为准

### 重新 seed

```bash
npm run db:seed
```

会向 `sessionKey=seed-demo-user` 写入「默认样例词表」与「上海初中考纲 2026」。  
日常请在导入页点 **一键导入「上海初中考纲 2026」到我的词表**，写入当前浏览器会话用户。

## 环境变量

见 [`.env.example`](.env.example)。

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | 默认 SQLite |
| `SPEECH_PROVIDER` | `mock` 或 `aliyun`（失败不回退 mock） |
| `ASR_*` / `TTS_*` / `NLS_REGION` | 阿里云智能语音 |
| `DICTIONARY_PROVIDER` | `auto` / `freedict` / `datamuse` |
| `DICTIONARY_API_BASE` | Free Dictionary API 根路径 |
| `TRANSLATE_PROVIDER` | `mymemory` / `none` |
| `MYMEMORY_EMAIL` | 可选，提高翻译额度 |
| `APP_ACCESS_PASSWORD` | 可选门禁 |
| `MAX_AUDIO_BYTES` / `MAX_CSV_BYTES` | 上传上限 |

**切勿**提交真实密钥。

## 开通阿里云智能语音

1. 开通 [智能语音交互](https://www.aliyun.com/product/nls) → [NLS Portal](https://nls-portal.console.aliyun.com/) 创建项目拿 **AppKey**（英文听写选英文模型）  
2. 创建 AccessKey ID/Secret（建议 RAM）  
3. `.env`：`SPEECH_PROVIDER=aliyun` 及 `ASR_*` / `TTS_*`  
4. 试用/计费以控制台与账单为准；无密钥请保持 `mock`

## 已实现

- CSV / Excel 导入 + Excel 模板下载  
- 手工 / 语音录入 + 词典自动补全  
- 上海初中考纲 2026 种子/预设导入  
- 听写双模式、麦克风门禁、SRS、错词本  
- 阿里云 ASR/TTS 可插拔；会话隔离

## 未做

- 邮箱魔法链接完整账号体系  
- Android
