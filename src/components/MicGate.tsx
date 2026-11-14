"use client";

import { useEffect, useState } from "react";
import { queryMicPermission, requestMicStream, type MicPermission } from "@/lib/mic";

type Props = {
  onGranted: () => void;
  title?: string;
};

export function MicGate({ onGranted, title = "听写需要麦克风" }: Props) {
  const [perm, setPerm] = useState<MicPermission>("prompt");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    queryMicPermission().then(setPerm);
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const stream = await requestMicStream();
      stream.getTracks().forEach((t) => t.stop());
      setPerm("granted");
      onGranted();
    } catch {
      setPerm("denied");
      setError("无法访问麦克风。请在浏览器地址栏允许麦克风权限后重试。无麦克风时不能听写，也不会降级为仅拼写。");
    } finally {
      setBusy(false);
    }
  }

  if (perm === "unsupported") {
    return (
      <div className="panel p-6 space-y-3">
        <h2 className="font-display text-2xl">{title}</h2>
        <p className="text-[var(--muted)]">
          当前环境不支持麦克风。听写<strong>必须</strong>语音，无法以降级模式继续。
        </p>
      </div>
    );
  }

  return (
    <div className="panel p-6 space-y-4 max-w-lg">
      <h2 className="font-display text-2xl">{title}</h2>
      <p className="text-[var(--muted)] leading-relaxed">
        拼写与发音均需判定。拒绝授权或设备无麦时，听写会被阻断，不会进入「仅拼写」模式。
      </p>
      {error && (
        <p className="text-sm text-[var(--danger)] bg-[var(--danger-soft)] rounded-md px-3 py-2">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={enable}
      >
        {busy ? "请求中…" : "授权并开启麦克风"}
      </button>
    </div>
  );
}
