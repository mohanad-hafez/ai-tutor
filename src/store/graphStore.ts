import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Node, Edge } from 'reactflow';
import type { FrameData } from '../types';

interface GraphState {
  nodes: Node<FrameData>[];
  edges: Edge[];
  focusedNodeId: string | null;
  setNodes: (nodes: Node<FrameData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  addFrame: (frame: FrameData, parentId?: string, position?: { x: number; y: number }) => void;
  addEdge: (source: string, target: string) => void;
  updateFrame: (id: string, patch: Partial<FrameData>) => void;
  removeFrame: (id: string) => void;
  setFocused: (id: string | null) => void;
  reset: () => void;
}

let posCounter = 0;
const nextPos = () => {
  posCounter += 1;
  return { x: (posCounter % 4) * 320, y: Math.floor(posCounter / 4) * 240 };
};

export const useGraphStore = create<GraphState>()(
  persist(
    (set) => ({
      nodes: [],
      edges: [],
      focusedNodeId: null,
      setNodes: (nodes) => set({ nodes }),
      setEdges: (edges) => set({ edges }),
      addFrame: (frame, parentId, position) =>
        set((state) => {
          const pos = position ?? nextPos();
          const node: Node<FrameData> = {
            id: frame.id,
            type: 'frame',
            position: pos,
            data: frame,
          };
          const newEdges = parentId
            ? [
                ...state.edges,
                {
                  id: `${parentId}->${frame.id}`,
                  source: parentId,
                  target: frame.id,
                },
              ]
            : state.edges;
          return { nodes: [...state.nodes, node], edges: newEdges };
        }),
      addEdge: (source, target) =>
        set((state) => {
          const id = `${source}->${target}`;
          if (state.edges.some((e) => e.id === id)) return {};
          return { edges: [...state.edges, { id, source, target }] };
        }),
      updateFrame: (id, patch) =>
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
          ),
        })),
      removeFrame: (id) =>
        set((state) => ({
          nodes: state.nodes.filter((n) => n.id !== id),
          edges: state.edges.filter((e) => e.source !== id && e.target !== id),
          focusedNodeId: state.focusedNodeId === id ? null : state.focusedNodeId,
        })),
      setFocused: (id) => set({ focusedNodeId: id }),
      reset: () => set({ nodes: [], edges: [], focusedNodeId: null }),
    }),
    {
      name: 'ai-tutor-graph',
      partialize: (s) => ({ nodes: s.nodes, edges: s.edges }),
    }
  )
);
