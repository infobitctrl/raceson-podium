import { describe, expect, it } from "vitest";
import { rewardLifecycle } from "./rewardLifecycle";
import type { AthletePaymentStatusV3 } from "./athletePaymentStatusV3";
const status = (state: AthletePaymentStatusV3["state"], held = false) => ({state, confirmed: state === "confirmed", readinessHeld: held}) as AthletePaymentStatusV3;
describe("reward lifecycle", () => {
  it("does not turn recipient consent into a paid receipt", () => {
    expect(rewardLifecycle([{recipientConsented:true}],true,[status("not_prepared")],false)).toEqual({claim:"claimed",payment:"not_sent"});
  });
  it("does not infer a negative from incomplete or failed observations", () => {
    expect(rewardLifecycle([],false,[],false)).toEqual({claim:"unknown",payment:"unknown"});
    expect(rewardLifecycle([],true,[status("confirmed")],true).payment).toBe("unknown");
  });
  it("keeps confirmed historical payments paid even when readiness is held", () => {
    expect(rewardLifecycle([],false,[status("confirmed",true)],false)).toEqual({claim:"claimed",payment:"paid"});
  });
  it("separates holds and in-flight transactions from unclaimed awards", () => {
    expect(rewardLifecycle([],true,[],false)).toEqual({claim:"unclaimed",payment:"not_sent"});
    expect(rewardLifecycle([],true,[status("prepared",true)],false).payment).toBe("held");
    expect(rewardLifecycle([],true,[status("submitted")],false).payment).toBe("processing");
  });
});
