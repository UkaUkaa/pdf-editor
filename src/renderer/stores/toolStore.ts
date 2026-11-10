import { create } from 'zustand';
import { DEFAULT_TOOL_STYLE, type EditorObject, type Tool, type ToolStyle } from '@shared/types/objects';

/** The text object being typed into, and the text typed so far (not yet part of the document). */
export interface TextEditing {
  documentId: string;
  pageId: string;
  objectId: string;
  text: string;
}

interface ToolState {
  tool: Tool;
  /** Style given to newly created objects. */
  style: ToolStyle;
  editing: TextEditing | null;
  /** Objects copied with Copy/Cut, pasted with new ids. */
  clipboard: EditorObject[];
  setTool: (tool: Tool) => void;
  setStyle: (patch: Partial<ToolStyle>) => void;
  setEditing: (editing: TextEditing | null) => void;
  setEditingText: (text: string) => void;
  setClipboard: (objects: EditorObject[]) => void;
}

/** The active tool and its settings. Shared by all documents, like in any editor. */
export const useToolStore = create<ToolState>((set) => ({
  tool: 'select',
  style: DEFAULT_TOOL_STYLE,
  editing: null,
  clipboard: [],
  setTool: (tool) => set({ tool }),
  setStyle: (patch) => set((state) => ({ style: { ...state.style, ...patch } })),
  setEditing: (editing) => set({ editing }),
  setEditingText: (text) => set((state) => (state.editing ? { editing: { ...state.editing, text } } : state)),
  setClipboard: (clipboard) => set({ clipboard }),
}));

export function resetToolStore(): void {
  useToolStore.setState({ tool: 'select', style: DEFAULT_TOOL_STYLE, editing: null, clipboard: [] });
}
