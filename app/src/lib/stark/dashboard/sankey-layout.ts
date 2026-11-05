// The 260px chart leaves 244px after its top and bottom insets. Reserve some
// height for each category so many categories cannot collapse every node.
export const SANKEY_NODE_GAP = 10;
export const SANKEY_LAYOUT_ITERATIONS = 32;
export const SANKEY_LABEL_DISTANCE = 8;

/**
 * Shared layout values for the account-to-category Sankey diagram.
 * Account labels live in the card header. ECharts keeps nodes and flow lines
 * in one automatic layout pass; colliding category labels are hidden rather
 * than moved outside the chart bounds.
 */
export function sankeyLayoutOptions(nodeCount = 0) {
  const nodeGap = nodeCount > 1
    ? Math.min(SANKEY_NODE_GAP, Math.max(1, Math.floor((244 - nodeCount * 4) / (nodeCount - 1))))
    : SANKEY_NODE_GAP;
  return {
    nodeGap,
    layoutIterations: SANKEY_LAYOUT_ITERATIONS,
    labelDistance: SANKEY_LABEL_DISTANCE,
    labelLayout: { hideOverlap: true },
  };
}
