import { classifyNodes, type NodeLookupResult } from '../../comfyui-node-registry';

/**
 * Classify every class_type in a ComfyUI workflow against the extension-node-map
 * registry. GitHub fallback is intentionally disabled here — the panel triggers
 * it as a separate async request after the metadata response arrives, so the
 * initial load is never blocked by GitHub API latency.
 */
// Node provenance extracted from the Workflow PNG chunk (ComfyUI ≥1.26).
// Keys are class_type strings; values are the cnr_id / aux_id from node.properties.
export type WorkflowProvenance = Record<string, { cnrId?: string; auxId?: string }>;

/**
 * Extract node provenance from the ComfyUI Workflow PNG chunk.
 * ComfyUI ≥1.26 stores cnr_id and aux_id in each node's properties:
 *   cnr_id: "comfy-core"        → built-in node
 *   aux_id: "owner/repo"        → custom node, GitHub repo
 * This is more authoritative than the extension-node-map registry and avoids
 * GitHub code-search false positives entirely.
 */
export function extractWorkflowProvenance(workflowJson: string): WorkflowProvenance {
  const provenance: WorkflowProvenance = {};
  try {
    const wf = JSON.parse(workflowJson);
    const nodes: any[] = Array.isArray(wf.nodes) ? wf.nodes : [];
    for (const node of nodes) {
      const type = node?.type;
      const props = node?.properties ?? {};
      if (typeof type === 'string' && type && (props.cnr_id || props.aux_id)) {
        provenance[type] = { cnrId: props.cnr_id, auxId: props.aux_id };
      }
    }
  } catch {
    // Not valid JSON or unexpected shape — skip
  }
  return provenance;
}

export async function classifyComfyUIWorkflow(
  workflow: Record<string, any>,
  provenance?: WorkflowProvenance,
): Promise<{
  summary: { total: number; builtin: number; custom: number; unknown: number; githubResolved: number };
  classifications: Record<string, NodeLookupResult>;
  unknownNodes: string[];
} | null> {
  const classTypes = new Set<string>();
  for (const node of Object.values(workflow)) {
    const ct = (node as any)?.class_type;
    if (typeof ct === 'string' && ct) classTypes.add(ct);
  }
  if (classTypes.size === 0) return null;

  let classifications: Record<string, NodeLookupResult>;
  try {
    classifications = await classifyNodes([...classTypes]);
  } catch (err) {
    console.error('[metadata] ComfyUI node classification failed:', err);
    classifications = {};
  }

  // Overlay Workflow-chunk provenance — this is authoritative and avoids
  // GitHub code-search false positives for nodes with known origins.
  if (provenance) {
    for (const ct of classTypes) {
      const p = provenance[ct];
      if (!p) continue;
      if (p.cnrId === 'comfy-core') {
        classifications[ct] = { classification: 'builtin' };
      } else if (p.auxId) {
        const repoTitle = p.auxId.split('/').pop() ?? p.auxId;
        classifications[ct] = {
          classification: 'custom',
          repo: {
            repoUrl: `https://github.com/${p.auxId}`,
            repoName: p.auxId,
            title: repoTitle,
          },
        };
      }
    }
  }

  let builtin = 0, custom = 0, unknown = 0, githubResolved = 0;
  const unknownNodes: string[] = [];
  for (const [ct, result] of Object.entries(classifications)) {
    switch (result.classification) {
      case 'builtin': builtin++; break;
      case 'custom':
        custom++;
        if (result.source === 'github') githubResolved++;
        break;
      case 'unknown': unknown++; unknownNodes.push(ct); break;
    }
  }

  return {
    summary: { total: classTypes.size, builtin, custom, unknown, githubResolved },
    classifications,
    unknownNodes,
  };
}

// TensorArt-specific ComfyUI node class_types
export const TENSORART_NODE_TYPES = new Set([
  'ECHOCheckpointLoaderSimple', 'TensorArt_CheckpointLoader',
  'TensorArt_PromptText', 'KolorsCheckpointLoaderSimple', 'TensorArtLoadChatGLM3',
]);
