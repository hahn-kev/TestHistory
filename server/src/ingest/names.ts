export interface NameRule {
  match: string;
  rewrite: string;
}

export interface CompiledRule {
  re: RegExp;
  rewrite: string;
}

/** Validate + compile a rule set; throws on invalid regex (used by PUT/preview). */
export function compileRules(rules: NameRule[]): CompiledRule[] {
  return rules.map((r) => ({ re: new RegExp(r.match), rewrite: r.rewrite }));
}

/**
 * Apply ordered rules to `suite::name`, each transforming the previous result,
 * then re-split on the first `::`. Empty rule set = verbatim passthrough.
 */
export function applyRules(compiled: CompiledRule[], suite: string, name: string): { suite: string; name: string } {
  if (compiled.length === 0) return { suite, name };
  let combined = `${suite}::${name}`;
  for (const c of compiled) combined = combined.replace(c.re, c.rewrite);
  const idx = combined.indexOf('::');
  if (idx < 0) return { suite: '', name: combined };
  return { suite: combined.slice(0, idx), name: combined.slice(idx + 2) };
}
