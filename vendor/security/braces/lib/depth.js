'use strict';

// Keep all recursive walkers well below Node/browser call-stack limits. This
// fixed bound cannot be disabled through caller options.
const MAX_DEPTH = 128;

const checkDepth = depth => {
  if (depth > MAX_DEPTH) {
    const error = new SyntaxError(`Brace pattern nesting exceeds ${MAX_DEPTH}`);
    error.code = 'ERR_BRACES_DEPTH';
    throw error;
  }
};

// Also protect APIs accepting an AST directly, including lib/* entry points.
// Follow child edges only: parsed AST parent/prev edges intentionally cycle.
const checkAst = ast => {
  const pending = [[ast, 0]];
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (!node || !Array.isArray(node.nodes)) continue;
    checkDepth(depth);
    for (const child of node.nodes) pending.push([child, depth + 1]);
  }
};

module.exports = { checkDepth, checkAst };
