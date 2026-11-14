# CrazyWords

面向自学用户的英语背单词 Web MVP：导入自有词表 → 设定每日目标 → **强制麦克风**的一对一听写（释义拼写 + 可关闭的例句挖空）→ SRS / 错词本复习。辅线：语音查词（ASR stub）。

> 产品方案 SSOT 在项目 Agent Store：`docs/crazywords-product-plan.md`（本仓库不改该文档）。

## 本地启动

```bash
# 依赖
npm install

# 环境变量（可直接复制）
cp .env.example .env

# 数据库（默认 SQLite：prisma/dev.db）
npx prisma migrate dev --name init
npm run db:seed   # 可选：写入 3 个样例词

# 开发服务器
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

### Postgres（可选）

将 `.env` 中 `DATABASE_URL` 改为：

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/crazywords"
```

并把 `prisma/schema.prisma` 里 `provider = "sqlite"` 改为 `"postgresql"`，再执行 `npx prisma migrate dev`。

## CSV 样例

文件：[`samples/words.sample.csv`](samples/words.sample.csv)

表头：

```text
word,gloss_zh,ipa,pos,example,phrases,related
```

- `phrases` / `related` 多项用 `|` 分隔
- 同一词表内重复 `word`：**覆盖**整条内容；`CardState` / 错词本按 entry 保留关联

页面「导入」可上传；亦可用 API：

```bash
curl -F "file=@samples/words.sample.csv" -F "listName=样例" http://localhost:3000/api/import
```

## 环境变量

见 [`.env.example`](.env.example)：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | 默认 `file:./dev.db`（相对 `prisma/`） |
| `SPEECH_PROVIDER` | `mock`（默认）或 `aliyun`（占位 stub，需密钥） |
| `ASR_ACCESS_KEY_ID` / `ASR_ACCESS_KEY_SECRET` / `ASR_APP_KEY` | 国内 ASR 密钥占位 |
| `TTS_ACCESS_KEY_ID` / `TTS_ACCESS_KEY_SECRET` / `TTS_APP_KEY` | 国内 TTS 密钥占位 |
| `DEMO_USER_EMAIL` | 演示用户标记（当前无真实鉴权） |

## 已实现 / 未接真语音

**已实现**

- Next.js App Router 全栈 + Prisma（SQLite 默认可跑）
- CSV 导入（含 `gloss_zh`，重复词覆盖）
- 词条浏览 / 编辑 / 删除与「资料不全」标记
- 每日目标 N、例句挖空开关、今日 SRS 队列（到期 → 错词 ≤40%N → 新词；逾期≥N 复习日）
- 听写 UI：双模式 + **麦克风门禁**（无麦不降级）
- 拼写判定；发音经可插拔 ASR 接口（mock 默认）
- TTS 可插拔接口（mock/stub）；开发期 stub 可回退浏览器朗读作提示
- 错词本；语音查词入口（ASR stub + 文字查词）
- 演示用户（无邮箱魔法链接）

**未接 / 占位**

- 真实国内 ASR/TTS HTTP 调用（仅 `aliyun-stub` + 环境变量占位）
- 邮箱魔法链接鉴权与多用户云同步
- 浏览器 SpeechSynthesis **不是**生产主 TTS（仅 mock 开发提示）

## 技术结构

```text
src/app          # 页面与 API
src/lib/srs      # 队列与简化 SM-2
src/lib/speech   # ASR/TTS 可插拔（mock / aliyun stub）
prisma/          # schema + migrate
samples/         # CSV 样例
```

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 开发 |
| `npm run build` / `npm start` | 生产构建与启动 |
| `npm run db:seed` | 种子数据 |
| `npx prisma studio` | 可视化数据库 |
