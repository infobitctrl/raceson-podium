const { handleRewardDemoApiRequest } = require("@raceson/api/rewards-demo");

module.exports = async (req, res) => {
  // A hosted artifact must never fall through to the full portal if a setting is lost.
  if (!["preview-v1", "sponsor-drafts-v1"].includes(process.env.RACESON_REWARD_HOSTED_COPY_MODE)) {
    res.writeHead(503, { "Cache-Control": "no-store", "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "hosted_preview_configuration_required" } }));
    return;
  }
  let expectedHost;
  try { expectedHost = new URL(process.env.RACESON_REWARD_DEMO_ORIGIN).host; } catch {}
  if (!expectedHost || req.headers.host !== expectedHost) {
    res.writeHead(403, { "Cache-Control": "no-store", "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "hosted_preview_origin_mismatch" } }));
    return;
  }
  await handleRewardDemoApiRequest(req, res);
};
