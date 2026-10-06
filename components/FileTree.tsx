"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Tree, type TreeApi } from "react-arborist";
import { getFileIcon } from "./FileIcons";

interface FileTreeNode {
  /** absolute path — doubles as the node id */
  id: string;
  name: string;
  isDir: boolean;
  /** undefined = not loaded yet (lazy); [] = loaded and empty */
  children?: FileTreeNode[];
  /** transient row for the "new file/folder" name input */
  creating?: boolean;
}

interface Props {
  /** Open a file in the editor. */
  onOpenFile: (absPath: string) => void;
  /** Directory to reveal + select on mount (the previous tab's working dir). */
  focusPath?: string | null;
}

/* ------------------------- helpers ------------------------- */

const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

async function listDir(dirPath: string): Promise<FileTreeNode[]> {
  const res = await fetch(`/api/files/list?path=${encodeURIComponent(dirPath)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { entries: { name: string; path: string; isDir: boolean }[] };
  return data.entries.map((e) => ({ id: e.path, name: e.name, isDir: e.isDir }));
}

async function ops(body: Record<string, unknown>): Promise<Response> {
  return fetch("/api/files/ops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mapTree(nodes: FileTreeNode[], id: string, fn: (n: FileTreeNode) => FileTreeNode): FileTreeNode[] {
  return nodes.map((n) => {
    if (n.id === id) return fn(n);
    if (n.children) return { ...n, children: mapTree(n.children, id, fn) };
    return n;
  });
}

function findNode(nodes: FileTreeNode[], id: string): FileTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

function removeNode(nodes: FileTreeNode[], id: string): FileTreeNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.children ? { ...n, children: removeNode(n.children, id) } : n));
}

function filterHidden(nodes: FileTreeNode[], showHidden: boolean): FileTreeNode[] {
  return nodes
    .filter((n) => showHidden || n.creating || !n.name.startsWith("."))
    .map((n) => (n.children ? { ...n, children: filterHidden(n.children, showHidden) } : n));
}

/** Refresh a directory's children, preserving already-loaded subchildren. */
function mergeChildren(oldNodes: FileTreeNode[], parentId: string | null, fresh: FileTreeNode[]): FileTreeNode[] {
  const merge = (old: FileTreeNode[], f: FileTreeNode): FileTreeNode => {
    const prev = old.find((o) => o.id === f.id);
    return prev?.children !== undefined && f.isDir ? { ...f, children: prev.children } : f;
  };
  if (parentId === null) return fresh.map((f) => merge(oldNodes, f));
  return mapTree(oldNodes, parentId, (n) => ({ ...n, children: fresh.map((f) => merge(n.children ?? [], f)) }));
}

/* ------------- shared clipboard (across Browse tabs) ------------- */

let clipboard: { path: string; isDir: boolean } | null = null;
const clipboardListeners = new Set<() => void>();
function setClipboard(v: { path: string; isDir: boolean } | null) {
  clipboard = v;
  clipboardListeners.forEach((l) => l());
}
function useClipboard() {
  return useSyncExternalStore(
    (cb) => {
      clipboardListeners.add(cb);
      return () => clipboardListeners.delete(cb);
    },
    () => clipboard,
    () => null,
  );
}

/* ------------------------- component ------------------------- */

export function FileTree({ onOpenFile, focusPath }: Props) {
  const [nodes, setNodes] = useState<FileTreeNode[]>([]);
  const [root, setRoot] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null; isDir: boolean } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: { id: string; name: string; isDir: boolean } } | null>(null);
  const clip = useClipboard();
  const treeRef = useRef<TreeApi<FileTreeNode> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 320, height: 480 });
  const revealedRef = useRef(false);
  const loadedRef = useRef(false);

  // react-arborist wants pixel dimensions
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setBox({ width: el.clientWidth || 320, height: el.clientHeight || 480 });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Close the context menu on click-away / Escape / scroll
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  // Initial load (+ focus reveal for "new tab from where I'm working")
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        const rootRes = await fetch(`/api/files/list?path=`);
        const rootData = (await rootRes.json()) as { root: string; entries: { name: string; path: string; isDir: boolean }[] };
        setRoot(rootData.root);
        const children = rootData.entries.map((e) => ({ id: e.path, name: e.name, isDir: e.isDir }));
        setNodes(children);
        if (focusPath) await reveal(children, rootData.root, focusPath);
      } catch (e) {
        setError(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Expand + select `target`: loads any missing children along its chain. */
  const reveal = async (initialNodes: FileTreeNode[], rootPath: string, target: string) => {
    if (!target.startsWith(rootPath)) return;
    const rel = target.slice(rootPath.length).split("/").filter(Boolean);
    const chain = [rootPath];
    for (const seg of rel) chain.push(`${chain[chain.length - 1]}/${seg}`);

    let cur = initialNodes;
    // Ensure every ancestor's child list is loaded so the chain can expand.
    for (let i = 1; i < chain.length; i++) {
      const parent = chain[i - 1];
      const node = parent === rootPath ? null : findNode(cur, parent);
      const kids = node ? node.children : cur;
      if (kids === undefined) {
        const fresh = await listDir(parent);
        cur = mapTree(cur, parent, (n) => ({ ...n, children: fresh }));
      }
    }
    // ...and the target itself, so its contents are what you see.
    const targetNode = findNode(cur, target);
    if (targetNode?.isDir && targetNode.children === undefined) {
      const fresh = await listDir(target);
      cur = mapTree(cur, target, (n) => ({ ...n, children: fresh }));
    }
    setNodes(cur);
    setSelectedId(target);
    // Open the chain after the data commit lands (arborist resolves ids
    // against its current data).
    setTimeout(() => {
      for (const id of chain.slice(1)) treeRef.current?.open(id);
      treeRef.current?.scrollTo(target, "center");
    }, 0);
  };

  /** Refetch one directory's children (post-op refresh). */
  const refreshDir = async (parentId: string | null) => {
    try {
      const fresh = await listDir(parentId ?? root);
      setNodes((prev) => mergeChildren(prev, parentId, fresh));
    } catch (e) {
      setError(String(e));
    }
  };

  /** Full refresh: re-list every directory that is already loaded. */
  const refreshAll = async () => {
    try {
      const collect = (ns: FileTreeNode[], acc: string[]): string[] => {
        for (const n of ns) {
          if (n.isDir && n.children !== undefined) {
            acc.push(n.id);
            collect(n.children, acc);
          }
        }
        return acc;
      };
      const loadedDirs = collect(nodes, []);
      const fresh = await listDir(root);
      setNodes((prev) => mergeChildren(prev, null, fresh));
      for (const dir of loadedDirs) {
        if (!findNode(fresh, dir) && !fresh.some((f) => dir.startsWith(`${f.id}/`))) continue;
        try {
          const kids = await listDir(dir);
          setNodes((prev) => mergeChildren(prev, dir, kids));
        } catch { /* dir vanished or unreadable — leave as-is */ }
      }
    } catch (e) {
      setError(String(e));
    }
  };

  /* -------- create (inline name input) -------- */

  const startCreate = (isDir: boolean) => {
    const sel = selectedId ? findNode(nodes, selectedId) : null;
    const parentId = sel ? (sel.isDir ? sel.id : parentOf(sel.id)) : null;
    // Make sure the target dir is loaded + open so the input row is visible.
    void (async () => {
      let base = nodes;
      if (parentId && findNode(base, parentId)?.children === undefined) {
        const fresh = await listDir(parentId);
        base = mapTree(base, parentId, (n) => ({ ...n, children: fresh }));
      }
      const temp: FileTreeNode = { id: "__creating__", name: "", isDir, creating: true };
      const inject = (ns: FileTreeNode[]): FileTreeNode[] => {
        if (parentId === null) return [temp, ...ns];
        return mapTree(ns, parentId, (n) => ({ ...n, children: [temp, ...(n.children ?? [])] }));
      };
      setNodes(inject(base));
      setCreating({ parentId, isDir });
      if (parentId) setTimeout(() => treeRef.current?.open(parentId), 0);
    })();
  };

  const cancelCreate = () => {
    setNodes((prev) => removeNode(prev, "__creating__"));
    setCreating(null);
  };

  const commitCreate = async (name: string) => {
    const c = creating;
    cancelCreate();
    if (!c || !name.trim()) return;
    const target = `${c.parentId ?? root}/${name.trim()}`;
    const res = await ops({ action: c.isDir ? "mkdir" : "create", path: target });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      return;
    }
    setError(null);
    await refreshDir(c.parentId);
  };

  /* -------- rename (inline input, base name preselected) -------- */

  const startRename = (node: { id: string; name: string }) => {
    setRenameId(node.id);
  };

  const commitRename = async (node: { id: string; name: string }, newName: string) => {
    setRenameId(null);
    const trimmed = newName.trim();
    if (!trimmed || trimmed === node.name) return;
    const res = await ops({ action: "rename", from: node.id, newName: trimmed });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      return;
    }
    setError(null);
    await refreshDir(parentOf(node.id));
  };

  /* -------- delete / copy / paste -------- */

  const doDelete = async (node: { id: string; name: string; isDir: boolean }) => {
    if (!window.confirm(`Delete "${node.name}"${node.isDir ? " and everything inside it" : ""}?`)) return;
    const res = await ops({ action: "delete", path: node.id });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      return;
    }
    setError(null);
    if (selectedId === node.id || selectedId?.startsWith(`${node.id}/`)) setSelectedId(null);
    await refreshDir(parentOf(node.id));
  };

  const doPaste = async (targetRow: { id: string; isDir: boolean }) => {
    if (!clip) return; // nothing valid in the clipboard — do nothing
    const toDir = targetRow.isDir ? targetRow.id : parentOf(targetRow.id);
    const res = await ops({ action: "copy", from: clip.path, toDir });
    if (!res.ok) return; // stale clipboard — silently do nothing
    setError(null);
    await refreshDir(toDir);
  };

  const visible = useMemo(() => filterHidden(nodes, showHidden), [nodes, showHidden]);

  const tbButton = (title: string, onClick: () => void, child: React.ReactNode, active = false) => (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 24, height: 24, padding: 0,
        background: active ? "var(--bg-selected)" : "none",
        border: "none", borderRadius: 5,
        color: active ? "var(--text)" : "var(--text-dim)",
        cursor: "pointer", flexShrink: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? "var(--bg-selected)" : "none"; e.currentTarget.style.color = active ? "var(--text)" : "var(--text-dim)"; }}
    >
      {child}
    </button>
  );

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      {/* Toolbar: root path + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "4px 8px 4px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={root}>
          {root ? `~${root.replace(/^\/home\/[^/]+/, "")}` : "\u200b"}
        </div>
        {tbButton(showHidden ? "Hide hidden files" : "Show hidden files", () => setShowHidden((v) => !v), showHidden ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ), showHidden)}
        {tbButton("New file", () => startCreate(false), (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
          </svg>
        ))}
        {tbButton("New folder", () => startCreate(true), (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        ))}
        {tbButton("Refresh", () => void refreshAll(), (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" /><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
          </svg>
        ))}
      </div>

      {error && (
        <div style={{ padding: "6px 14px", color: "#f87171", fontSize: 11, borderBottom: "1px solid var(--border)" }}>{error}</div>
      )}

      <div ref={boxRef} style={{ flex: 1, minHeight: 0 }}>
        <Tree<FileTreeNode>
          ref={treeRef}
          data={visible}
          rowHeight={32}
          width={box.width}
          height={box.height}
          openByDefault={false}
          indent={16}
        >
          {({ node, style }: { node: any; style: React.CSSProperties }) => {
            const data = node.data as FileTreeNode;
            const isOpen = !!node.isOpen;
            const isRenaming = renameId === data.id;

            // Inline name input (create or rename)
            if (data.creating || isRenaming) {
              return (
                <div style={{ ...style, display: "flex", alignItems: "center", gap: 7, paddingLeft: 26, paddingRight: 10 }}>
                  <span style={{ flexShrink: 0, display: "flex", width: 15, height: 15, alignItems: "center", justifyContent: "center" }}>
                    {data.isDir ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                    ) : (
                      getFileIcon(data.name || "new")
                    )}
                  </span>
                  <NameInput
                    initial={data.name}
                    selectBase={isRenaming}
                    onCommit={(name) => {
                      if (data.creating) void commitCreate(name);
                      else void commitRename(data, name);
                    }}
                    onCancel={() => { if (data.creating) cancelCreate(); else setRenameId(null); }}
                  />
                </div>
              );
            }

            return (
              <div
                style={{
                  ...style,
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  paddingRight: 10,
                  cursor: "pointer",
                  fontSize: 13,
                  color: data.isDir ? "var(--text)" : "var(--text-muted)",
                  background: node.isSelected || data.id === selectedId ? "var(--bg-selected)" : "transparent",
                }}
                onClick={() => {
                  setSelectedId(data.id);
                  if (data.isDir) {
                    void (async () => {
                      if (data.children === undefined) {
                        try {
                          const fresh = await listDir(data.id);
                          setNodes((prev) => mapTree(prev, data.id, (n) => ({ ...n, children: fresh })));
                        } catch (e) { setError(String(e)); }
                      }
                      node.toggle();
                    })();
                  } else {
                    onOpenFile(data.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelectedId(data.id);
                  setMenu({ x: e.clientX, y: e.clientY, node: { id: data.id, name: data.name, isDir: data.isDir } });
                }}
                onMouseEnter={(e) => { if (!node.isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (!node.isSelected) e.currentTarget.style.background = "transparent"; }}
                title={data.id}
              >
                {data.isDir ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.6, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                ) : (
                  <span style={{ width: 10, flexShrink: 0 }} />
                )}
                <span style={{ flexShrink: 0, display: "flex", width: 15, height: 15, alignItems: "center", justifyContent: "center" }}>
                  {getFileIcon(data.name)}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {data.name}
                </span>
              </div>
            );
          }}
        </Tree>
      </div>

      {/* Right-click context menu */}
      {menu && (
        <div
          style={{
            position: "fixed",
            left: Math.min(menu.x, window.innerWidth - 170),
            top: Math.min(menu.y, window.innerHeight - 150),
            zIndex: 200,
            minWidth: 160,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            overflow: "hidden",
            padding: 4,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {([
            {
              label: "Copy",
              disabled: false,
              run: () => { setClipboard({ path: menu.node.id, isDir: menu.node.isDir }); },
            },
            {
              label: "Paste",
              disabled: !clip,
              run: () => void doPaste(menu.node),
            },
            {
              label: "Rename",
              disabled: false,
              run: () => startRename(menu.node),
            },
            {
              label: "Delete",
              disabled: false,
              danger: true,
              run: () => void doDelete(menu.node),
            },
          ]).map((item) => (
            <button
              key={item.label}
              disabled={item.disabled}
              onClick={() => { setMenu(null); if (!item.disabled) item.run(); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "6px 10px", border: "none", borderRadius: 5,
                background: "none", fontSize: 12.5,
                color: item.disabled ? "var(--text-dim)" : item.danger ? "#ef4444" : "var(--text)",
                cursor: item.disabled ? "default" : "pointer",
              }}
              onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Inline name editor. Enter commits, Esc cancels, blur commits. */
function NameInput({
  initial,
  selectBase,
  onCommit,
  onCancel,
}: {
  initial: string;
  selectBase: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Rename selects the base name (minus extension): replacing = just
    // typing, editing the name = clicking into the selection first.
    const dot = initial.lastIndexOf(".");
    const base = dot > 0 ? initial.slice(0, dot) : initial;
    if (selectBase) el.setSelectionRange(0, base.length);
    else el.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      ref={ref}
      defaultValue={initial}
      style={{
        flex: 1, minWidth: 0, height: 22,
        fontSize: 12.5, fontFamily: "var(--font-mono, monospace)",
        color: "var(--text)", background: "var(--bg)",
        border: "1px solid var(--accent)", borderRadius: 4,
        padding: "0 5px", outline: "none",
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !doneRef.current) {
          doneRef.current = true;
          onCommit(ref.current?.value ?? "");
        } else if (e.key === "Escape") {
          doneRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!doneRef.current) {
          doneRef.current = true;
          onCommit(ref.current?.value ?? "");
        }
      }}
    />
  );
}
