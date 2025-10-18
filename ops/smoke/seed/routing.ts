export function baseGraph() {
  const nodes = [
    { id: "A", name: "A", kind: "facility" },
    { id: "B", name: "B", kind: "hub" },
    { id: "C", name: "C", kind: "hub" },
    { id: "D", name: "D", kind: "address" },
  ];
  const edges = [
    { id: "A-B", fromNodeId: "A", toNodeId: "B", distanceKm: 5 },
    { id: "B-C", fromNodeId: "B", toNodeId: "C", distanceKm: 4 },
    { id: "C-D", fromNodeId: "C", toNodeId: "D", distanceKm: 3 },
    { id: "A-D", fromNodeId: "A", toNodeId: "D", distanceKm: 20 },
    { id: "B-D", fromNodeId: "B", toNodeId: "D", distanceKm: 8 },
  ];
  const tasks = [
    { id: "t1", fromNodeId: "A", toNodeId: "D" },
    { id: "t2", fromNodeId: "B", toNodeId: "C" },
  ];
  return { nodes, edges, tasks };
}

export function withClosure(edgeId) {
  const g = baseGraph();
  const edges = g.edges.map(e => (e.id === edgeId ? { ...e, isClosed: true } : e));
  return { ...g, edges };
}
