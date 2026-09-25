import { useSyncExternalStore } from "react";
import type { Json, WidgetState } from "../core/types";
let states: Record<string, WidgetState> = {};
let revisionDigest = "";
let ready = false;
let generation = 0;
const listeners = new Set<() => void>();
const registered = new Map<string, string>();
const defaults = new Map<string, Json>();
let mutation = 0;
const pending = new Map<string, { mutation: number; state: WidgetState }>();
const emit = () => listeners.forEach((fn) => fn());
type BridgeMessage = {
  type: string;
  id?: string;
  signature?: string;
  value?: Json;
  mutation?: number;
  anchor?: unknown;
};
let receiver: ((message: BridgeMessage) => void) | undefined;
function send(message: BridgeMessage) {
  receiver?.(message);
}
export function startBridge(
  digest: string,
  widgets: Record<string, WidgetState>,
  receive: (message: BridgeMessage) => void,
) {
  generation++;
  states = widgets;
  revisionDigest = digest;
  ready = true;
  receiver = receive;
  registered.clear();
  defaults.clear();
  pending.clear();
  mutation = 0;
  return () => {
    generation++;
    ready = false;
    receiver = undefined;
    states = {};
    registered.clear();
    defaults.clear();
    pending.clear();
    listeners.clear();
  };
}
export function updateBridge(message: {
  state: { widgets: Record<string, WidgetState> };
  ack?: { id: string; mutation: number };
}) {
  if (
    message.ack &&
    pending.get(message.ack.id)?.mutation === message.ack.mutation
  )
    pending.delete(message.ack.id);
  const incoming: Record<string, WidgetState> = {
    ...message.state.widgets,
  };
  for (const [id, entry] of pending) incoming[id] = entry.state;
  for (const [id, next] of Object.entries(incoming)) {
    const previous = states[id];
    if (
      previous &&
      previous.signature === next.signature &&
      previous.confirmed === next.confirmed &&
      previous.touched === next.touched &&
      previous.active === next.active &&
      JSON.stringify(previous.value) === JSON.stringify(next.value)
    )
      incoming[id] = previous;
  }
  states = incoming;
  emit();
}
export function resetBridge() {
  pending.clear();
}
export function bridgeReady() {
  return ready;
}
export function useBlueprintState<T extends Json>(
  id: string,
  initial: T,
  definition?: Json,
): [T, (value: T) => void, boolean] {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(id))
    throw new Error("Виджету нужен стабильный id");
  if (!defaults.has(id)) {
    if (defaults.size >= 200) throw new Error("Максимум 200 виджетов");
    defaults.set(id, initial);
  }
  const currentGeneration = generation;
  const signature = JSON.stringify(definition ?? { custom: revisionDigest });
  const state = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => states[id],
  );
  if (ready && registered.get(id) !== signature) {
    registered.set(id, signature);
    queueMicrotask(() => {
      if (ready && generation === currentGeneration)
        send({ type: "register", id, signature, value: initial });
    });
  }
  return [
    (state ? state.value : defaults.get(id)) as T,
    (value) => {
      if (!ready || generation !== currentGeneration) return;
      states = {
        ...states,
        [id]: {
          value,
          signature,
          confirmed: true,
          touched: true,
          active: true,
        },
      };
      const seq = ++mutation;
      pending.set(id, { mutation: seq, state: states[id] });
      emit();
      send({ type: "widget", id, signature, value, mutation: seq });
    },
    state?.confirmed ?? true,
  ];
}
export function annotateSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const parentEl =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const block = parentEl?.closest("[data-block-id]");
  if (!block || !block.contains(range.endContainer)) return;
  const before = range.cloneRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange();
  after.selectNodeContents(block);
  after.setStart(range.endContainer, range.endOffset);
  send({
    type: "selection",
    anchor: {
      block: block.getAttribute("data-block-id"),
      quote: selection.toString(),
      prefix: before.toString().slice(-160),
      suffix: after.toString().slice(0, 160),
    },
  });
}
