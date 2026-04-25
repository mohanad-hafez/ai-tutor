import dagre from 'dagre';
import type { Node, Edge } from 'reactflow';

export function layoutGraph<T>(nodes: Node<T>[], edges: Edge[]): Node<T>[] {
  if (!nodes.length) return nodes;
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 100 });

  nodes.forEach((n) => g.setNode(n.id, { width: 280, height: 160 }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - 140, y: p.y - 80 } };
  });
}
