"use client";

import { useEffect, useRef, useState } from "react";
import { Tree } from "react-arborist";
import { getFileIcon } from "./FileIcons";

interface FileTreeNode {
  /** absolute path — doubles as the node id */
  id: string;
  name: string;
  isDir: boolean;
  /** undefined = not loaded yet (lazy), [] = loaded and empty */
  children?: FileTreeNode[];
}

interface Props {
  /** Open a file in the editor. */
  onOpenFile: (absPath: string) => void;
}

async function loadChildren(dirPath: string): Promise<FileTreeNode[]> {
  const res = await fetch(`/api/files/list?path=${encodeURIComponent(dirPath)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { entries: { name: string; path: string; isDir: boolean }[] };
  return data.entries.map((e) => ({ id: e.path, name: e.name, isDir: e.isDir }));
}

function setChildren(nodes: FileTreeNode[], id: string, children: FileTreeNode[]): FileTreeNode[] {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, children };
    if (n.children) return { ...n, children: setChildren(n.children, id, children) };
    return n;
  });
}

/**
 * The right-panel file browser (replaces the old sidebar Files patch-job).
 * react-arborist tree over /api/files/list, lazily loading children per
 * directory, path-jailed to PI_WEB_FILES_ROOT server-side. Clicking a file
 * opens it in the editor; clicking a folder toggles it.
 */
export function FileTree({ onOpenFile }: Props) {
  const [nodes, setNodes] = useState<FileTreeNode[]>([]);
  const [root, setRoot] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 320, height: 480 });

  // react-arborist wants pixel dimensions
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setBox({ width: el.clientWidth || 320, height: el.clientHeight || 480 });
    });
    ro.observe(el);
    setBox({ width: el.clientWidth || 320, height: el.clientHeight || 480 });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadChildren("")
      .then((children) => setNodes(children))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    // learn the root for the header label (any list response carries it)
    fetch(`/api/files/list?path=`)
      .then((r) => r.json())
      .then((d: { root: string }) => setRoot(d.root))
      .catch(() => {});
  }, []);

  const toggleDir = async (node: { id: string; isDir: boolean; children?: FileTreeNode[]; }) => {
    if (!node.isDir || node.children !== undefined) return;
    try {
      const children = await loadChildren(node.id);
      setNodes((prev) => setChildren(prev, node.id, children));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "6px 14px", fontSize: 11, color: "var(--text-dim)", borderBottom: "1px solid var(--border)", flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={root}>
        {root ? `~${root.replace(/^\/home\/[^/]+/, "")}` : "\u200b"}
      </div>
      {error && (
        <div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>{error}</div>
      )}
      <div ref={boxRef} style={{ flex: 1, minHeight: 0 }}>
        <Tree<FileTreeNode>
          data={nodes}
          rowHeight={32}
          width={box.width}
          height={box.height}
          openByDefault={false}
          indent={16}
        >
          {({ node, style }: { node: any; style: React.CSSProperties }) => {
            const data = node.data as FileTreeNode;
            const isOpen = !!node.isOpen;
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
                  background: node.isSelected ? "var(--bg-selected)" : "transparent",
                }}
                onClick={() => {
                  if (data.isDir) {
                    void toggleDir(data);
                    node.toggle();
                  } else {
                    onOpenFile(data.id);
                  }
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
    </div>
  );
}
