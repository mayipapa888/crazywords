import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

function isWav(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
}

/**
 * 将浏览器常见 webm/ogg/mp4 等转为阿里云一句话识别可用的 16kHz 单声道 WAV。
 * 依赖本机 ffmpeg。
 */
export async function toAliyunAsrWav(input: Buffer): Promise<{ wav: Buffer; format: "wav" }> {
  if (input.length === 0) {
    throw new Error("音频为空");
  }
  if (isWav(input)) {
    // 仍规范化采样率，避免浏览器导出的非 16k WAV
  }

  const dir = await mkdtemp(path.join(tmpdir(), "cw-asr-"));
  const inPath = path.join(dir, "input.bin");
  const outPath = path.join(dir, "out.wav");
  try {
    await writeFile(inPath, input);
    await new Promise<void>((resolve, reject) => {
      const ff = spawn(
        "ffmpeg",
        ["-hide_banner", "-loglevel", "error", "-y", "-i", inPath, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outPath],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let err = "";
      ff.stderr?.on("data", (d: Buffer) => {
        err += d.toString();
      });
      ff.on("error", (e) => reject(new Error(`无法启动 ffmpeg：${e.message}`)));
      ff.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg 转码失败（需安装 ffmpeg）：${err.trim() || `code=${code}`}`));
      });
    });
    const wav = await readFile(outPath);
    return { wav, format: "wav" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
