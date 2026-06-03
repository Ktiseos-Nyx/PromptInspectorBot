type UiNode = {
  id: number | string; type?: string; mode?: number;
  inputs?: Array<{ name: string; type?: string; link?: number | null }>;
  outputs?: Array<{ name: string; type?: string; links?: number[] | null }>;
  widgets_values?: any[];
};
type UiWorkflow = { nodes: UiNode[]; links?: any[] };

export function isUiWorkflow(wf: any): wf is UiWorkflow {
  return !!wf && typeof wf === 'object' && Array.isArray(wf.nodes);
}

/** Convert a UI workflow ({nodes,links}) into the API-shaped graph the tracer expects:
 *  { [id]: { class_type, mode, widgets_values, inputs: { [name]: value | [srcId, srcSlot] } } }.
 *  Connections come from links[] = [linkId, fromNode, fromSlot, toNode, toSlot, type] — deterministic. */
export function normalizeUiWorkflow(wf: UiWorkflow): Record<string, any> {
  const graph: Record<string, any> = {};

  // toId -> (toSlot -> [fromId, fromSlot])
  const incoming = new Map<string, Map<number, [string, number]>>();
  for (const l of wf.links ?? []) {
    if (!Array.isArray(l) || l.length < 5) continue;
    const [, fromNode, fromSlot, toNode, toSlot] = l;
    const toId = String(toNode);
    if (!incoming.has(toId)) incoming.set(toId, new Map());
    incoming.get(toId)!.set(Number(toSlot), [String(fromNode), Number(fromSlot)]);
  }

  for (const n of wf.nodes) {
    const id = String(n.id);
    const inputs: Record<string, any> = {};
    const slotMap = incoming.get(id);
    (n.inputs ?? []).forEach((slot, idx) => {
      if (!slot?.name) return;
      const src = slotMap?.get(idx);
      if (src) inputs[slot.name] = src;
    });
    graph[id] = {
      class_type: n.type ?? '',
      mode: n.mode ?? 0,
      widgets_values: n.widgets_values ?? [],
      inputs,
    };
  }
  return graph;
}
