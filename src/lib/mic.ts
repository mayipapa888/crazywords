export type MicPermission = "granted" | "denied" | "prompt" | "unsupported";

export async function queryMicPermission(): Promise<MicPermission> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unsupported";
  }
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      if (status.state === "granted" || status.state === "denied" || status.state === "prompt") {
        return status.state;
      }
    }
  } catch {
    // Safari 等可能不支持 permissions.query(microphone)
  }
  return "prompt";
}

export async function requestMicStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前浏览器不支持麦克风");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
}

export function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg",
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "";
}

export class MicRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  async start() {
    this.stream = await requestMicStream();
    const mime = pickMimeType();
    this.recorder = mime
      ? new MediaRecorder(this.stream, { mimeType: mime })
      : new MediaRecorder(this.stream);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  async stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("未开始录音");

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" }));
      };
      recorder.onerror = () => reject(new Error("录音失败"));
      recorder.stop();
    });

    this.cleanup();
    return blob;
  }

  cleanup() {
    this.recorder = null;
    this.chunks = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
