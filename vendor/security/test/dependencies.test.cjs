const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const load = createRequire(path.join(root, 'package.json'));
const braces = load('braces');
const decode = load('decode-uri-component');
const query = load('query-string');
const depthError = error => error instanceof SyntaxError && error.code === 'ERR_BRACES_DEPTH';

test('all installed callers resolve the reviewed local packages', () => {
  assert.equal(load('braces/package.json').name, '@raceson/braces');
  assert.equal(load('decode-uri-component/package.json').name, '@raceson/decode-uri-component');
  for (const parent of ['chokidar', 'micromatch']) {
    assert.equal(createRequire(load.resolve(parent)).resolve('braces'), load.resolve('braces'));
  }
  assert.equal(createRequire(load.resolve('query-string')).resolve('decode-uri-component'), load.resolve('decode-uri-component'));
});

test('all public pattern APIs reject deep braces, parentheses and unbalanced patterns', () => {
  for (const input of ['{'.repeat(4800) + 'x' + '}'.repeat(4800), '('.repeat(4800) + 'x' + ')'.repeat(4800), '{('.repeat(300) + 'x', '{'.repeat(300) + 'a..b,c']) {
    for (const fn of [braces, braces.create, braces.compile, braces.expand, braces.stringify, braces.parse]) {
      assert.throws(() => fn(input, { maxDepth: Infinity, maxLength: Infinity }), depthError);
    }
  }
  assert.throws(() => braces(['a/{b,c}', '{'.repeat(300)]), depthError);
  assert.throws(() => load('micromatch').braceExpand('{'.repeat(4800) + 'a' + '}'.repeat(4800)), depthError);
});

test('direct AST and lib entry points cannot bypass the depth bound', () => {
  for (const kind of ['deep', 'cycle']) {
    let ast = { type: 'root', nodes: [] };
    if (kind === 'cycle') ast.nodes.push(ast);
    else for (let i = 0; i < 300; i++) ast = { type: 'root', nodes: [ast] };
    for (const name of ['compile', 'expand', 'stringify']) {
      assert.throws(() => braces[name](ast), depthError);
      assert.throws(() => load(`braces/lib/${name}`)(ast), depthError);
    }
  }
});

test('normal nested globs, numeric ranges, escaped literals and ASTs still work', () => {
  assert.deepEqual(braces.expand('src/{a,{b,c}}.{js,ts}'), ['src/a.js', 'src/a.ts', 'src/b.js', 'src/b.ts', 'src/c.js', 'src/c.ts']);
  assert.deepEqual(braces.expand('round-{01..05}'), ['round-01', 'round-02', 'round-03', 'round-04', 'round-05']);
  assert.equal(braces.compile('src/{a,b}.ts'), 'src/(a|b).ts');
  assert.equal(braces.stringify(braces.parse('src/{a,b}.ts')), 'src/{a,b}.ts');
  assert.deepEqual(load('micromatch')(['src/a.ts', 'src/b.js', 'dist/a.ts'], ['src/*.{ts,js}']), ['src/a.ts', 'src/b.js']);
  assert.deepEqual(braces.expand(String.raw`src/\{literal\}`), ['src/{literal}']);
  for (const literal of ['"' + '{'.repeat(300) + '"', '[' + '{'.repeat(300) + ']']) assert.doesNotThrow(() => braces.compile(literal));
  assert.doesNotThrow(() => braces.compile('{'.repeat(128) + 'x' + '}'.repeat(128)));
  assert.throws(() => braces.compile('{'.repeat(129) + 'x' + '}'.repeat(129)), depthError);
});

test('decoder preserves CommonJS, form values, UTF-8 and malformed-byte fallback', () => {
  assert.equal(typeof decode, 'function');
  for (const [input, expected] of [['Races+Mon1', 'Races Mon1'], ['a%2Bb', 'a+b'], ['%C5%A0ibenik', 'Šibenik'], ['%F0%9F%8F%83', '🏃'], ['%FF', '%FF'], ['%C2', '\uFFFD'], ['%FE%FF', '\uFFFD\uFFFD'], ['%E0%A4%A', '%E0%A4%A'], ['%41%FF%42', 'A%FFB']]) assert.equal(decode(input), expected);
  assert.throws(() => decode(null), TypeError);
  assert.deepEqual({ ...query.parse('name=Races+Mon1&memo=%C5%A0ibenik&value=a%2Bb') }, {name: 'Races Mon1', memo: 'Šibenik', value: 'a+b'});
  assert.equal(query.parseUrl('https://example.invalid/?a=%41#%C5%A0', {parseFragmentIdentifier: true}).fragmentIdentifier, 'Š');
});

test('malformed query keys, values and fragments complete in a bounded child process', () => {
  const code = `const assert=require('node:assert/strict'); const q=require('query-string');
    for(const bad of ['%FF'.repeat(1200), '%E0%A4%A'.repeat(1200), '%C0%AF'.repeat(1200)]) {
      const parsed=q.parse('field='+bad); assert.ok(parsed.field.length>0);
      assert.equal(Object.keys(q.parse(bad+'=value')).length,1);
      assert.ok(q.parseUrl('https://example.invalid/#'+bad,{parseFragmentIdentifier:true}).fragmentIdentifier.length>0);
    }`;
  const result = spawnSync(process.execPath, ['-e', code], {cwd: root, timeout: 3000, encoding: 'utf8'});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('real WalletConnect URI serialization and parsing remain compatible', () => {
  const original = {protocol: 'wc', topic: 'a'.repeat(64), version: 2, symKey: 'b'.repeat(64), relay: {protocol: 'irn'}, expiryTimestamp: 1900000000};
  const packages = load('./package-lock.json').packages;
  for (const relative of Object.keys(packages).filter(p => p.endsWith('/@walletconnect/utils'))) {
    const walletLoad = createRequire(path.join(root, relative, 'package.json'));
    const {parseUri, formatUri} = walletLoad('.');
    const uri = formatUri(original);
    assert.ok(uri.startsWith('wc:' + original.topic + '@2?'));
    const parsed = parseUri(uri);
    // Existing upstream parseUri strips wc: before constructing this field.
    assert.equal(parsed.protocol, '');
    for (const key of ['topic', 'version', 'symKey', 'expiryTimestamp']) assert.equal(parsed[key], original[key]);
    assert.deepEqual(parsed.relay, original.relay);
    assert.equal(parseUri(uri + '&unused=' + '%FF'.repeat(1200)).topic, original.topic);
    if (packages[relative].dependencies?.['query-string']) {
      assert.equal(createRequire(walletLoad.resolve('query-string')).resolve('decode-uri-component'), load.resolve('decode-uri-component'));
    }
  }
});
