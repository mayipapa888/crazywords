"use client";

import { useSession } from "@/components/SessionBootstrap";
import { withBase } from "@/lib/base-path";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type AdminUser = {
  id: string;
  username: string;
  status: string;
  role: string;
  createdAt: string;
};

type AdminAction = "approve" | "disable" | "enable" | "delete";

type Notice = { kind: "ok" | "error"; text: string };

const ACTION_LABEL: Record<AdminAction, string> = {
  approve: "开通",
  disable: "停用",
  enable: "启用",
  delete: "删除",
};

function statusMeta(status: string): { label: string; className: string } {
  if (status === "pending") return { label: "待开通", className: "badge badge-warn" };
  if (status === "active") return { label: "已开通", className: "badge badge-ok" };
  if (status === "disabled") {
    return {
      label: "已停用",
      className: "badge bg-[var(--danger-soft)] text-[var(--danger)]",
    };
  }
  return { label: status || "未知", className: "badge" };
}

function roleLabel(role: string): string {
  return role === "admin" ? "管理员" : "普通用户";
}

/** 当前状态对应的主操作；unknown 状态不给操作。 */
function primaryAction(status: string): AdminAction | null {
  if (status === "pending") return "approve";
  if (status === "active") return "disable";
  if (status === "disabled") return "enable";
  return null;
}

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function successText(action: AdminAction, username: string): string {
  if (action === "approve") return `已开通用户「${username}」`;
  if (action === "disable") return `已停用用户「${username}」`;
  if (action === "enable") return `已启用用户「${username}」`;
  return `已删除用户「${username}」`;
}

export default function AdminPage() {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: AdminAction } | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(withBase("/api/admin/users"), { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        users?: AdminUser[];
        error?: string;
      };
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) {
        setLoadError(data.error || `加载失败（${res.status}）`);
        return;
      }
      setForbidden(false);
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch {
      setLoadError("网络异常，无法加载用户列表");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void loadUsers();
  }, [isAdmin, loadUsers]);

  async function runAction(target: AdminUser, action: AdminAction) {
    if (busy) return;
    if (
      action === "delete" &&
      !window.confirm(`确定删除用户「${target.username}」？此操作不可撤销。`)
    ) {
      return;
    }

    setBusy({ id: target.id, action });
    setNotice(null);
    try {
      const res = await fetch(
        withBase(`/api/admin/users/${encodeURIComponent(target.id)}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNotice({ kind: "error", text: data.error || "操作失败，请稍后重试" });
        return;
      }
      setNotice({ kind: "ok", text: successText(action, target.username) });
      // 操作成功后重新拉取，状态/统计以服务端为准
      await loadUsers();
    } catch {
      setNotice({ kind: "error", text: "网络异常，操作失败" });
    } finally {
      setBusy(null);
    }
  }

  if (!isAdmin || forbidden) {
    return (
      <div className="flex h-full items-center justify-center">
        <section className="panel anim-fade-up w-full max-w-sm space-y-3 p-6 text-center">
          <p className="font-display text-xl">无权限</p>
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            仅管理员可以访问用户管理。
          </p>
          <Link href="/" className="btn-primary w-full">
            返回首页
          </Link>
        </section>
      </div>
    );
  }

  const pendingCount = users.filter((row) => row.status === "pending").length;
  const activeCount = users.filter((row) => row.status === "active").length;
  const disabledCount = users.filter((row) => row.status === "disabled").length;

  return (
    <div className="flex h-full flex-col gap-3">
      <section className="panel flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3">
        <div className="min-w-0">
          <h1 className="font-display text-lg">用户管理</h1>
          <p className="text-xs text-[var(--muted)]">
            新注册账号默认待开通，开通后才能登录
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-warn">待开通 {pendingCount}</span>
          <span className="badge badge-ok">已开通 {activeCount}</span>
          <span className="badge bg-[var(--danger-soft)] text-[var(--danger)]">
            已停用 {disabledCount}
          </span>
          <button
            type="button"
            onClick={() => void loadUsers()}
            disabled={loading}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      </section>

      {notice && (
        <div
          role="status"
          className={`shrink-0 rounded-md border px-3 py-2 text-sm ${
            notice.kind === "ok"
              ? "border-[var(--ok)] bg-[var(--ok-soft)] text-[var(--ok)]"
              : "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
          }`}
        >
          {notice.text}
        </div>
      )}

      <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="hidden shrink-0 grid-cols-[minmax(0,1fr)_5.5rem_5rem_9.5rem_auto] gap-3 border-b border-[var(--line)] px-3 py-2 text-xs text-[var(--muted)] sm:grid">
          <span>用户名</span>
          <span>状态</span>
          <span>角色</span>
          <span>注册时间</span>
          <span className="text-right">操作</span>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
          {loadError && users.length > 0 && (
            <p className="border-b border-[var(--line)] px-3 py-2 text-xs text-[var(--danger)]">
              {loadError}
            </p>
          )}

          {loading && users.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--muted)]">加载中…</p>
          ) : !loading && loadError && users.length === 0 ? (
            <div className="space-y-2 px-3 py-6 text-center">
              <p className="text-sm text-[var(--danger)]">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadUsers()}
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                重试
              </button>
            </div>
          ) : users.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--muted)]">
              暂无注册用户
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {users.map((row) => {
                const meta = statusMeta(row.status);
                const primary = primaryAction(row.status);
                const rowBusy = busy?.id === row.id ? busy.action : null;
                const actionDisabled = busy !== null;
                return (
                  <li
                    key={row.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_5rem_9.5rem_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={row.username}>
                        {row.username}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[var(--muted)] sm:hidden">
                        {roleLabel(row.role)} · {formatCreatedAt(row.createdAt)}
                      </p>
                    </div>

                    <div>
                      <span className={meta.className}>{meta.label}</span>
                    </div>

                    <div className="hidden text-sm text-[var(--muted)] sm:block">
                      {roleLabel(row.role)}
                    </div>

                    <div className="hidden text-xs text-[var(--muted)] sm:block">
                      {formatCreatedAt(row.createdAt)}
                    </div>

                    <div className="col-span-2 flex items-center justify-end gap-1.5 sm:col-span-1">
                      {primary && (
                        <button
                          type="button"
                          onClick={() => void runAction(row, primary)}
                          disabled={actionDisabled}
                          className={`px-2.5 py-1 text-xs ${
                            primary === "approve" ? "btn-primary" : "btn-secondary"
                          }`}
                        >
                          {rowBusy === primary ? "处理中…" : ACTION_LABEL[primary]}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void runAction(row, "delete")}
                        disabled={actionDisabled}
                        className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--danger)] transition hover:bg-[var(--danger-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {rowBusy === "delete" ? "删除中…" : "删除"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
