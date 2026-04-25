import { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useGraphStore } from '../../store/graphStore';
import { FrameNode } from '../Frame/FrameNode';
import { layoutGraph } from '../../lib/layout';

export function Canvas() {
  const { nodes, edges, setNodes, setEdges } = useGraphStore();

  const nodeTypes = useMemo(() => ({ frame: FrameNode }), []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes(applyNodeChanges(changes, nodes)),
    [nodes, setNodes]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges(applyEdgeChanges(changes, edges)),
    [edges, setEdges]
  );

  return (
    <div className="relative h-full w-full bg-[#07070a]">
      <div className="absolute right-3 top-3 z-10 flex gap-2">
        <button
          onClick={() => setNodes(layoutGraph(nodes, edges))}
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
        fitView
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep', animated: false, style: { stroke: '#3a3a42', strokeWidth: 1.5 } }}
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
