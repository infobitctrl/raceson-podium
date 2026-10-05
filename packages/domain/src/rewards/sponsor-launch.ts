import {decodeSavedRewardSetup, decodeRewardSetup, previewRewardSetup, setupId, type RewardDistributionSetup, type SavedRewardSetup} from "./distribution-setup.js";

/** A frozen launch request, NOT a deployment, funding observation or payout approval. */
export type SponsorLaunch = {
  id: string;
  setup: SavedRewardSetup;
  configurationHash: string;
  createdAt: string;
  state: "prepared";
};
export type SponsorLaunchView = {setup: SavedRewardSetup; launch: SponsorLaunch | null};

/** New launches must commit their source selections before deployment. This does
 * not assert sporting finality or change decoding of existing immutable launches. */
export function sponsorLaunchSourcesReady(setup: SavedRewardSetup): boolean {
  return sponsorConfigurationSourcesReady(decodeSavedRewardSetup(setup).configuration);
}

/** Shared editor/launch check; saving a draft does not require source readiness. */
export function sponsorConfigurationSourcesReady(configuration: RewardDistributionSetup): boolean {
  const c = decodeRewardSetup(configuration);
  if (c.version !== 5 || !c.guided || !c.context) return false;
  return c.root.children.filter(p => p.shareBps > 0).every(p => {
    const pot = c.guided!.pots.find(v => v.nodeId === p.id);
    if (!pot || pot.slot > 0 && !pot.roundId) return false;
    return p.children.filter(g => g.shareBps > 0).every(g => {
      const group = c.guided!.groups.find(v => v.nodeId === g.id);
      if (!group) return false;
      if (!["athlete_standings", "club_standings"].includes(group.type)) return true;
      const source = g.rule?.source;
      return Boolean(source && source.draftId === c.context!.draftId && source.catalogueHash === c.context!.catalogueHash
        && source.roundId === pot.roundId);
    });
  });
}

export function sponsorLaunchPlan(setup: SavedRewardSetup) {
  const saved = decodeSavedRewardSetup(setup), c = saved.configuration;
  const preview = previewRewardSetup(c);
  const complete = c.version === 5 && Boolean(c.guided?.groups.length) && preview.rows.filter(r => r.pathShare > 0).every(r => r.issue === null);
  const pots = c.root.children.map(node => ({
    id: node.id, name: node.name, shareBps: node.shareBps,
    amountWei: preview.rows.find(r => r.id === node.id)?.amountWei?.toString() ?? null,
    groups: node.children.map(group => ({id: group.id, name: group.name, shareBps: group.shareBps,
      amountWei: preview.rows.find(r => r.id === group.id)?.amountWei?.toString() ?? null})),
  }));
  const fixedV3Pots = c.guided?.pots.length === 6 && c.guided.pots.every(p =>
    c.root.children.find(n => n.id === p.nodeId)?.shareBps === (p.slot === 0 ? 5000 : 1000));
  // These are compatibility diagnostics only. Source IDs in a draft are not
  // authoritative publication evidence and never authorize a chain operation.
  return {complete, budgetWei: preview.budgetWei.toString(), pots,
    needsFlexibleContract: !fixedV3Pots,
    needsReturnPolicy: c.policy?.treasuryReturn !== "original_sender" || c.policy?.fewerFinishers === "raceson_main_treasury",
    needsClaimWindow: c.policy?.claimWindowDays !== 365,
    hasSourceReferences: Boolean(c.context) && c.root.children.filter(n => n.shareBps > 0).every(n =>
      n.children.filter(g => g.shareBps > 0).every(g => Boolean(g.rule?.source))),
  };
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== keys.sort().join()) throw Error("invalid_sponsor_launch");
  return value as Record<string, unknown>;
}
export function decodeSponsorLaunchView(value: unknown, chainId: number, setupIdExpected: string): SponsorLaunchView {
  const raw = object(value, ["setup", "launch"]);
  const setup = decodeSavedRewardSetup(raw.setup, chainId, setupIdExpected);
  if (raw.launch === null) return {setup, launch: null};
  const launch = object(raw.launch, ["id", "setup", "configurationHash", "createdAt", "state"]);
  const frozen = decodeSavedRewardSetup(launch.setup, chainId, setupIdExpected);
  // Lifecycle is current UI metadata, not part of the immutable economic snapshot.
  const currentSnapshot={...setup},frozenSnapshot={...frozen};
  delete currentSnapshot.lifecycle;delete frozenSnapshot.lifecycle;
  if (!setupId(launch.id) || launch.state !== "prepared" || !sponsorLaunchPlan(frozen).complete || frozen.revision > setup.revision
    || typeof launch.configurationHash !== "string" || !/^[0-9a-f]{64}$/.test(launch.configurationHash)
    || typeof launch.createdAt !== "string" || !Number.isFinite(Date.parse(launch.createdAt)) || new Date(launch.createdAt).toISOString() !== launch.createdAt
    || frozen.revision === setup.revision && JSON.stringify(frozenSnapshot) !== JSON.stringify(currentSnapshot)) throw Error("invalid_sponsor_launch");
  return {setup, launch: {id: launch.id, setup: frozen, configurationHash: launch.configurationHash, createdAt: launch.createdAt, state: "prepared"}};
}
