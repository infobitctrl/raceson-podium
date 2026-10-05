// One public syntax corpus shared by TypeScript and disposable SQL tests.
// Valid syntax is not release approval: the API still binds its exact config.
export const walletOriginCases = [
  ...[31337,10143].flatMap(chainId => [
    ["http://127.0.0.1:3102",chainId,true], ["http://localhost:65535",chainId,true],
    ...["http://localhost", "http://localhost:80", "http://localhost:03102", "http://localhost:65536",
      "http://127.0.0.1:3102/", "http://127.0.0.1:3102/path", "http://127.0.0.1:3102#fragment",
      "http://user@127.0.0.1:3102", "http://0.0.0.0:3102", "http://[::1]:3102",
      "https://www.raceson.com", "https://staging.raceson.com", "https://raceson-staging.vercel.app",
      "https://sitrail.com", "https://sibenik.trail"].map(origin => [origin,chainId,false]),
  ]),
  ["https://reward-demo.invalid",10143,true], ["https://monad.raceson.com",10143,true],
  ["https://reward-demo.invalid",31337,false], ["http://127.0.0.1:3102",143,false],
  ...["https://www.raceson.com.", "https://*.raceson.com", "https://bad_host.invalid", "https://a..invalid",
    "https://-demo.invalid", "https://demo-.invalid", "https://127.0.0.1", "https://reward-demo.invalid:443",
    "https://reward-demo.invalid:8443", "https://REWARD-demo.invalid", "https://abcdefghijklmnopqrst.supabase.co",
    `https://${"a".repeat(64)}.invalid`, `https://${"a".repeat(50)}.${"b".repeat(40)}.invalid`,
  ].map(origin => [origin,10143,false]),
];
