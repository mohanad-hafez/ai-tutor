import dagre from 'dagre';
import type { Node, Edge } from 'reactflow';

// Frame nodes are 320 × ~280 once the preview pane mounts.
const NODE_W = 320;
const NODE_H = 280;

// For radial layout: distance between concentric rings. Sized so a
// ring with up to ~10 nodes at depth 1 doesn't crowd, and depth 2
// (the outer ring of grandchildren) has enough arc length for ~14
// nodes without overlap.
const RING_STEP = 540;

// Build a parent → children adjacency map and find roots.
function buildTree<T>(nodes: Node<T>[], edges: Edge[]) {
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of edges) {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source)!.push(e.target);
    hasParent.add(e.target);
  }
  const roots = nodes.filter((n) => !hasParent.has(n.id));
  return { childrenOf, hasParent, roots };
}

// Radial tree layout — root at origin, immediate children fanned around
// the full 2π circle, grandchildren in their parent's angular slice.
// Each child's slice is proportional to the size of its subtree, so a
// dense branch gets more arc-length than a leaf branch and the result
// is roughly balanced in both x and y.
function radialLayout<T>(nodes: Node<T>[], edges: Edge[]): Node<T>[] | null {
  const { childrenOf, roots } = buildTree(nodes, edges);

  // Radial layout only makes sense when the graph is a single tree.
  // Multiple roots, cycles, or forests fall through to dagre.
  if (roots.length !== 1) return null;
  const rootId = roots[0].id;

  const sizeMemo = new Map<string, number>();
  function subtreeSize(nodeId: string): number {
    const cached = sizeMemo.get(nodeId);
    if (cached !== undefined) return cached;
    const children = childrenOf.get(nodeId) || [];
    let size = 1;
    for (const c of children) size += subtreeSize(c);
    sizeMemo.set(nodeId, size);
    return size;
  }

  const positions = new Map<string, { x: number; y: number }>();

  function place(
    nodeId: string,
    angleStart: number,
    angleEnd: number,
    depth: number,
  ): void {
    const myAngle = (angleStart + angleEnd) / 2;
    const radius = depth * RING_STEP;
    positions.set(nodeId, {
      x: radius * Math.cos(myAngle),
      y: radius * Math.sin(myAngle),
    });

    const children = childrenOf.get(nodeId) || [];
    if (!children.length) return;

    const range = angleEnd - angleStart;
    let total = 0;
    const sizes = children.map((c) => {
      const s = subtreeSize(c);
      total += s;
      return s;
    });

    let cursor = angleStart;
    for (let i = 0; i < children.length; i++) {
      const slice = (sizes[i] / total) * range;
      place(children[i], cursor, cursor + slice, depth + 1);
      cursor += slice;
    }
  }

  // Start the angular sweep at the top so the first branch is at 12 o'clock.
  // -π/2 is straight up; we sweep clockwise from there.
  const startAngle = -Math.PI / 2;
  place(rootId, startAngle, startAngle + 2 * Math.PI, 0);

  return nodes.map((n) => {
    const p = positions.get(n.id) || { x: 0, y: 0 };
    return { ...n, position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } };
  });
}

// Dagre top-to-bottom layout. Used as a fallback for non-tree graphs
// (multiple roots, cycles) and for tiny single-line hierarchies where
// a vertical layout reads more naturally than a circle.
function dagreLayout<T>(nodes: Node<T>[], edges: Edge[]): Node<T>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB',
    nodesep: 90,
    ranksep: 160,
    marginx: 60,
    marginy: 60,
    align: 'UL',
    ranker: 'tight-tree',
  });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } };
  });
}

export function layoutGraph<T>(nodes: Node<T>[], edges: Edge[]): Node<T>[] {
  if (!nodes.length) return nodes;

  // Tiny graphs (≤ 4 nodes, single chain) read better top-to-bottom
  // than as a tiny circle — fall straight through to dagre.
  if (nodes.length <= 4) return dagreLayout(nodes, edges);

  return radialLayout(nodes, edges) ?? dagreLayout(nodes, edges);
}
