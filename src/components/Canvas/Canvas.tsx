import { useCallback, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useGraphStore } from '../../store/graphStore';
import { FrameNode } from '../Frame/FrameNode';
import { layoutGraph } from '../../lib/layout';
import { seedDemoGraph } from '../../lib/demoGraph';

export function Canvas() {
  const { nodes, edges, setNodes, setEdges } = useGraphStore();
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const nodeTypes = useMemo(() => ({ frame: FrameNode }), []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes(applyNodeChanges(changes, nodes)),
    [nodes, setNodes]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges(applyEdgeChanges(changes, edges)),
    [edges, setEdges]
  );

  const handleAutoLayout = useCallback(() => {
    setNodes(layoutGraph(nodes, edges));
    // The camera needs a tick to see the repositioned nodes before it
    // can frame them; fitView reads the current layout snapshot.
    setTimeout(() => {
      rfRef.current?.fitView({ padding: 0.18, duration: 600 });
    }, 30);
  }, [nodes, edges, setNodes]);

  const handleSeedDemo = useCallback(() => {
    seedDemoGraph();
    // Wait for the bulk-add to land in the store, then read the fresh
    // nodes/edges directly off the store and lay them out — the closure
    // copies of nodes/edges are still empty at this point.
    setTimeout(() => {
      const { nodes: ns, edges: es, setNodes: sn } = useGraphStore.getState();
      sn(layoutGraph(ns, es));
      setTimeout(() => {
        rfRef.current?.fitView({ padding: 0.18, duration: 600 });
      }, 30);
    }, 30);
  }, []);

  return (
    <div className="relative h-full w-full bg-[#07070a]">
      <div className="absolute right-3 top-3 z-10 flex gap-2">
        <button
          onClick={handleSeedDemo}
          className="flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-[11px] font-medium text-indigo-200 shadow-sm transition hover:border-indigo-400/60 hover:bg-indigo-500/15 hover:text-indigo-100"
          title="Replace the canvas with a curated multi-branch demo graph"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="2" />
            <circle cx="5" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
            <circle cx="8" cy="19" r="2" />
            <circle cx="16" cy="19" r="2" />
            <path d="M12 7v3M10.5 11.5l-4 .8M13.5 11.5l4 .8M6 14l2 3M18 14l-2 3" />
          </svg>
          Seed demo
        </button>
        <button
          onClick={handleAutoLayout}
          className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-[#0d0d11] px-3 py-1.5 text-[11px] font-medium text-neutral-300 shadow-sm transition hover:border-neutral-700 hover:bg-[#15151b] hover:text-neutral-100"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          Auto-layout
        </button>
      </div>
      {!nodes.length && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-neutral-800 bg-[#0d0d11]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="2.5" />
                <circle cx="5" cy="19" r="2.5" />
                <circle cx="19" cy="19" r="2.5" />
                <path d="M12 7.5v3.5M7 17l3-3M17 17l-3-3" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-neutral-200">Your lessons graph</div>
              <div className="mt-1 text-xs leading-relaxed text-neutral-500">
                Highlight text in the PDF, ask a question or press Enter, and lessons will appear here.
              </div>
            </div>
          </div>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onInit={(instance) => { rfRef.current = instance; }}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
          style: { stroke: '#6366f1', strokeWidth: 2.6, strokeOpacity: 0.78 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1', width: 18, height: 18 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#1f1f24" />
        <Controls />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(7,7,10,0.7)"
          nodeColor="#27272d"
          nodeStrokeColor="#3a3a42"
          style={{ background: '#0d0d11', border: '1px solid #1f1f24' }}
        />
      </ReactFlow>
    </div>
  );
}
