# CrazyWords

面向自学用户的英语背单词 Web MVP：导入自有词表 → 设定每日目标 → **强制麦克风**的一对一听写（释义拼写 + 可关闭的例句挖空）→ SRS / 错词本复习。辅线：语音查词（阿里云 ASR 或 mock）。

> 产品方案 SSOT 在项目 Agent Store：`docs/crazywords-product-plan.md`（本仓库不改该文档）。

## 本地启动

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run db:seed   # 可选：仅写入无会话绑定的样例（日常用「导入」更贴近真实）
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。每个浏览器会获得独立会话用户（httpOnly cookie），数据互不共享。

可选：在 `.env` 设置 `APP_ACCESS_PASSWORD` 开启访问门禁。

### Postgres（可选）

将 `DATABASE_URL` 改为 Postgres 连接串，并把 `prisma/schema.prisma` 的 `provider` 改为 `postgresql`，再 `npx prisma migrate dev`。

## CSV 样例

[`samples/words.sample.csv`](samples/words.sample.csv)

表头：`word,gloss_zh,ipa,pos,example,phrases,related`  
`phrases` / `related` 用 `|` 分隔；同词表重复 `word` **覆盖**。

```bash
curl -F "file=@samples/words.sample.csv" -F "listName=样例" http://localhost:3000/api/import
```

## 环境变量

见 [`.env.example`](.env.example)。

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | 默认 SQLite `file:./dev.db` |
| `SPEECH_PROVIDER` | `mock`（开发）或 `aliyun`（真实调用；**失败不会静默回 mock**） |
| `NLS_REGION` | 智能语音地域，默认 `cn-shanghai` |
| `ASR_ACCESS_KEY_ID` / `ASR_ACCESS_KEY_SECRET` / `ASR_APP_KEY` | 一句话识别 |
| `TTS_ACCESS_KEY_ID` / `TTS_ACCESS_KEY_SECRET` / `TTS_APP_KEY` | 语音合成 |
| `TTS_VOICE` / `TTS_FORMAT` / `TTS_SAMPLE_RATE` | TTS 可选参数 |
| `APP_ACCESS_PASSWORD` | 可选访问门禁 |
| `MAX_AUDIO_BYTES` / `MAX_CSV_BYTES` | 上传上限 |

**切勿**把真实密钥提交进 Git。

## 开通阿里云智能语音（ASR + TTS）

1. 开通 [智能语音交互](https://www.aliyun.com/product/nls)（控制台：[NLS Portal](https://nls-portal.console.aliyun.com/)）。
2. **创建项目**：控制台 → 全部项目 → 创建项目，复制 **AppKey**。  
   - 听写/查词为英文时，项目需选择支持**英文**的识别模型（以控制台可选模型为准）。  
   - 语音合成音色在项目/控制台可用列表中选择（默认 `xiaoyun`）。
3. **AccessKey**：阿里云账号或 RAM 用户创建 `AccessKey ID` / `AccessKey Secret`（建议 RAM + 最小权限，勿用主账号长期密钥）。
4. 在 `.env` 填写：

```env
SPEECH_PROVIDER=aliyun
NLS_REGION=cn-shanghai
ASR_ACCESS_KEY_ID=...
ASR_ACCESS_KEY_SECRET=...
ASR_APP_KEY=你的项目AppKey
TTS_ACCESS_KEY_ID=...          # 可与 ASR 相同
TTS_ACCESS_KEY_SECRET=...
TTS_APP_KEY=你的项目AppKey     # 可与 ASR 相同
TTS_VOICE=xiaoyun
```

5. 本服务端实现：
   - **ASR**：一句话识别 RESTful（`/stream/v1/asr`）；浏览器录音经 ffmpeg 转为 16kHz WAV 再上传。
   - **TTS**：语音合成 RESTful（`/stream/v1/tts`），返回音频给前端播放。
   - Token：服务端用 AccessKey 调 `CreateToken`，缓存至过期前。

### 试用 / 计费提示

- 新开通通常有**免费试用额度**（以控制台/账单页当前说明为准），用尽后按量计费。
- Token 本身获取一般不计语音时长；**识别与合成按调用计费**。
- 请在阿里云费用中心关注额度与账单；生产环境建议设置费用告警与 RAM 限权。
- 无密钥或调用失败时 API 返回明确错误，**不会**自动改用 mock。本地无密钥请保持 `SPEECH_PROVIDER=mock`。

依赖：本机需安装 **ffmpeg**（ASR 转码）。

## 已实现

- Next.js + Prisma（SQLite）
- CSV 导入覆盖、词表、每日目标、SRS 队列、错词本
- 听写双模式 + 麦克风门禁
- **阿里云真实 ASR/TTS**（可插拔；`mock` 仅开发）
- 会话 cookie 用户隔离 + 可选密码门禁；上传大小限制
- 语音查词

## 未做

- 邮箱魔法链接完整账号体系
- Android
- 真机阿里云联调需你方密钥（本仓库不提交密钥）

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 开发 |
| `npm run build` / `npm start` | 生产 |
| `npm run db:seed` | 种子 |
| `npx prisma studio` | 数据库 UI |
