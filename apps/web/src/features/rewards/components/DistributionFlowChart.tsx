import { Curve, Layer, Rectangle, ResponsiveContainer, Sankey, Text } from "recharts";
import styles from "./DistributionExplorer.module.css";

export type FlowNode = { id: string; parentId: string | null; label: string; amount: string; amountWei: bigint; tone: "league" | "race" | "total" };
/** Geometry uses ratios only. Display values always come from exact integer amounts. */
export default function DistributionFlowChart({ nodes: input, selected, onSelect, controls, disabled = false, height = 420 }: {
  nodes: FlowNode[]; selected: string; onSelect: (id: string) => void; controls: string; disabled?: boolean; height?: number;
}) {
  const source = input.filter(n => n.amountWei > 0n), budget = source[0]?.amountWei ?? 0n;
  if (!budget || source.length < 2) return null;
  const nodes = source.map(n => ({ ...n, name: n.label }));
  const links = source.flatMap((n, target) => {
    const parent = source.findIndex(p => p.id === n.parentId);
    return parent < 0 ? [] : [{ source: parent, target, value: Math.max(Number(n.amountWei * 1_000_000_000n / budget) / 1_000_000_000, 1e-9) }];
  });
  const colour = (node: FlowNode) => node.tone === "league" ? "var(--flow-league)" : node.tone === "race" ? "var(--flow-race)" : "var(--flow-ink)";
  type NodeProps = { x: number; y: number; width: number; height: number; payload: FlowNode };
  return <div className={styles.chart} style={{ height }}>
    <ResponsiveContainer width="100%" height={height} minWidth={0}>
      <Sankey data={{ nodes, links }} nodeWidth={12} nodePadding={30} iterations={32} sort={false}
        margin={{ top: 32, bottom: 28, left: 8, right: 215 }} link={(props: { sourceX: number; sourceY: number; targetX: number; targetY: number; linkWidth: number; payload: { target: FlowNode } }) =>
          <Curve type="bumpX" points={[{ x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY }]}
            stroke={colour(props.payload.target)} strokeWidth={props.linkWidth} strokeOpacity={selected === props.payload.target.id ? .5 : .2} fill="none" />}
        node={({ x, y, width, height: nodeHeight, payload }: NodeProps) => {
          const leaf = !source.some(n => n.parentId === payload.id);
          return <Layer role={disabled?"img":"button"} tabIndex={disabled?undefined:0} aria-label={`${payload.label} ${payload.amount}`} aria-pressed={disabled?undefined:selected === payload.id}
            aria-controls={disabled?undefined:controls} className={styles.node} onClick={disabled?undefined:() => onSelect(payload.id)}
            onKeyDown={event => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(payload.id); } }}>
            <Rectangle x={x - 4} y={leaf ? y + nodeHeight / 2 - 25 : y - 34} width={leaf ? 210 : 170} height={leaf ? 50 : nodeHeight + 36} fill="transparent" />
            <Rectangle x={x} y={y} width={width} height={Math.max(nodeHeight, .1)} radius={3} fill={colour(payload)} />
            <Text x={x + (leaf ? 24 : 0)} y={leaf ? y + nodeHeight / 2 - 7 : y - 20} fontSize={leaf ? 15 : 12} fontWeight={600} fill="var(--flow-ink)">{leaf ? payload.amount : payload.label}</Text>
            <Text x={x + (leaf ? 24 : 0)} y={leaf ? y + nodeHeight / 2 + 14 : y - 4} fontSize={12} fill="var(--flow-muted)">{leaf ? payload.label : payload.amount}</Text>
          </Layer>;
        }} />
    </ResponsiveContainer>
  </div>;
}
