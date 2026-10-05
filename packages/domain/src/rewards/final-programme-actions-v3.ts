import { decodeProgrammeExecutionStatusV3, type ProgrammeExecutionStatusV3 } from "./programme-execution-status-v3.js";
import { nextProgrammeExecutionActionV3, decodeProgrammeActionStateV3 } from "./programme-actions-v3.js";
import { decodeFinalPublicationViewV3, type FinalPublicationViewV3 } from "./final-publication-view-v3.js";
const check = (v: unknown): void => { if (!v) throw Error("invalid_reward_final_programme_action"); };
export function nextFinalProgrammeActionV3(execution: ProgrammeExecutionStatusV3, publication: FinalPublicationViewV3 | null) {
  check(execution.slot === 5 || execution.slot === 6);
  const published = Boolean(publication?.publicationBound && publication.current && publication.publication
    && ["chainId", "draftId", "slot", "approvalId", "uploadId", "packageHash"].every(k =>
      publication[k as keyof FinalPublicationViewV3] === execution[k as keyof ProgrammeExecutionStatusV3]));
  return nextProgrammeExecutionActionV3(execution, published);
}
export function decodeFinalProgrammeActionsV3(value: unknown) {
  check(value && typeof value === "object" && !Array.isArray(value));
  const fields = Object.getOwnPropertyDescriptors(value!), keys = ["schema", "execution", "selected", "ack", "publication"];
  check(Reflect.ownKeys(value as object).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]!));
  const r = Object.fromEntries(keys.map(k => [k, fields[k]!.value]));
  check(r.schema === "raceson-final-programme-actions-v3");
  const execution = decodeProgrammeExecutionStatusV3(r.execution); check(execution.slot === 5 || execution.slot === 6);
  const publication = r.publication === null ? null : decodeFinalPublicationViewV3(r.publication, execution);
  const state = decodeProgrammeActionStateV3(execution, r.selected, r.ack);
  return { schema: "raceson-final-programme-actions-v3" as const, execution, ...state, publication };
}
export type FinalProgrammeActionsV3 = ReturnType<typeof decodeFinalProgrammeActionsV3>;
