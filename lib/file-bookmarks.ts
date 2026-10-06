"use client";

import { useSyncExternalStore } from "react";

export interface Bookmark {
  /** absolute directory path */
  path: string;
  name: string;
}

const KEY = "pi-web:file-bookmarks";

let bookmarks: Bookmark[] = load();
const listeners = new Set<() => void>();

function load(): Bookmark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Bookmark[]) : [];
    return Array.isArray(parsed) ? parsed.filter((b) => b && typeof b.path === "string") : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(bookmarks));
  } catch { /* storage full/unavailable — bookmarks stay in-memory */ }
}

function notify() {
  listeners.forEach((l) => l());
}

/** Add (dedup by path) — order = insertion order. */
export function addBookmark(bookmark: Bookmark) {
  if (bookmarks.some((b) => b.path === bookmark.path)) return;
  bookmarks = [...bookmarks, bookmark];
  persist();
  notify();
}

export function removeBookmark(path: string) {
  bookmarks = bookmarks.filter((b) => b.path !== path);
  persist();
  notify();
}

/** Drag reorder: moves the entry at from -> to (indexes into the list). */
export function moveBookmark(from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= bookmarks.length || to >= bookmarks.length) return;
  const next = [...bookmarks];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  bookmarks = next;
  persist();
  notify();
}

export function useFileBookmarks(): Bookmark[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => bookmarks,
    () => bookmarks,
  );
}
