/**
 * Layers of a page. Every page has its own stack; the original page content
 * always lies underneath all of them and is not itself a layer in this list.
 */

export const LAYER_TYPES = ['text', 'image', 'drawing', 'shapes', 'annotation', 'custom'] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

export interface Layer {
  id: string;
  name: string;
  /** Determines the icon and which new objects go here by default. Any layer can hold any object. */
  type: LayerType;
  visible: boolean;
  /** Objects on a locked layer cannot be selected or changed on the canvas. */
  locked: boolean;
  /** 0 … 1, multiplied with the opacity of each object on the layer. */
  opacity: number;
}

/** Layers of every page, keyed by page id; array order is bottom to top. */
export type PageLayers = Record<string, Layer[]>;
