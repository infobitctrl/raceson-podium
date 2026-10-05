import { croatianMessages, englishMessages, type TranslationKey } from "@/shared/i18n/messages";
import {
  croatianApplicationCopy,
  croatianApplicationTemplateCopy,
} from "@/shared/i18n/applicationCopyTranslations";

type TemplateRule = {
  pattern: RegExp;
  placeholders: string[];
  template: string;
  literalLength: number;
  localizedPlaceholders: Set<string>;
};

// Legacy captures are opaque data unless a specific interface enum is known.
const legacyInterfaceValueTemplates = new Set([
  "Checkpoint marked {value1}",
  "Participant marked {value1}.",
  "Incident moved to {value1}",
  "The season status is {value1}. Permanent deletion is limited to leagues whose seasons are still unpublished drafts.",
  "This participant is already marked {value1}.",
  "Participant status corrected to {value1}.",
  "Transfer or remove the protected {value1} data before deleting this organization.",
]);
const legacyCountSuffix = /^ (?:members|runners|athletes|races|courses|clubs|events|rounds|results|registrations|participants|organizations|points|spots|entries|finishes|seasons)\b/;
const numberCapture = "([+-]?\\d[\\d.,]*(?: \\d{3})*[kKmM]?|[—–-])";

const userFacingAttributes = [
  "alt",
  "aria-description",
  "aria-label",
  "label",
  "placeholder",
  "title",
] as const;

function messagePriority(key: TranslationKey) {
  if (key.startsWith("common.")) return 0;
  if (key.startsWith("nav.")) return 1;
  return 2;
}

function orderedTranslationKeys() {
  return (Object.keys(englishMessages) as TranslationKey[])
    .sort((left, right) => messagePriority(left) - messagePriority(right));
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePortalEntityTerms(value: string) {
  const protectedPhrases: string[] = [];
  const protect = (match: string) => {
    const token = `__RACESON_PORTAL_TERM_${protectedPhrases.length}__`;
    protectedPhrases.push(match);
    return token;
  };

  return value
    .replace(/\bTrack the\b|\bTrack expected\b|\bTrack participation\b|\bTrack entries\b|\btrack its\b|\btracks only\b/g, protect)
    .replace(/\bCourses\b/g, "Routes")
    .replace(/\bcourses\b/g, "routes")
    .replace(/\bCourse\b/g, "Route")
    .replace(/\bcourse\b/g, "route")
    .replace(/\bTracks\b/g, "Routes")
    .replace(/\btracks\b/g, "routes")
    .replace(/\bTrack\b/g, "Route")
    .replace(/\btrack\b/g, "route")
    .replace(/\bEvents\b/g, "Races")
    .replace(/\bevents\b/g, "races")
    .replace(/\bEvent\b/g, "Race")
    .replace(/\bevent\b/g, "race")
    .replace(/\ban race\b/g, "a race")
    .replace(/\bRoutes\s*(?:&|and)\s*routes\b/g, "Routes")
    .replace(/\broutes\s*(?:&|and)\s*routes\b/g, "routes")
    .replace(/\bRace races\b/g, "Races")
    .replace(/\brace races\b/g, "races")
    .replace(/\bRace race\b/g, "Race")
    .replace(/\brace race\b/g, "race")
    .replace(/__RACESON_PORTAL_TERM_(\d+)__/g, (_, index) => protectedPhrases[Number(index)]);
}

function buildExactTranslations() {
  // Some legacy template-catalog entries are plain labels. They still need to
  // participate in exact matching; template rules intentionally skip them.
  const applicationCopy = new Map<string, string>([
    ...Object.entries(croatianApplicationTemplateCopy).filter(([english]) => !english.includes("{")),
    ...Object.entries(croatianApplicationCopy),
  ]);
  const translations = new Map(applicationCopy);
  for (const [english, croatian] of applicationCopy) {
    const normalized = normalizePortalEntityTerms(english);
    if (!translations.has(normalized)) translations.set(normalized, croatian);
  }
  for (const key of orderedTranslationKeys()) {
    const english = englishMessages[key];
    const croatian = croatianMessages[key];
    if (!english || !croatian || english === croatian || english.includes("{")) continue;
    if (!translations.has(english)) translations.set(english, croatian);
  }
  return translations;
}

function buildTemplateRules() {
  const seen = new Set<string>();
  const rules: TemplateRule[] = [];

  const templates: Array<[string, string]> = orderedTranslationKeys()
    .map((key): [string, string] => [englishMessages[key], croatianMessages[key]])
    .concat(Object.entries(croatianApplicationTemplateCopy))
    .flatMap(([english, croatian]) => {
      const normalized = normalizePortalEntityTerms(english);
      return normalized === english
        ? [[english, croatian]]
        : [[english, croatian], [normalized, croatian]];
    });

  for (const [english, croatian] of templates) {
    if (!english || !croatian || english === croatian || !english.includes("{")) continue;
    const signature = english.replace(/\{\w+\}/g, "{}");
    if (seen.has(signature)) continue;

    const placeholders: string[] = [];
    let cursor = 0;
    let expression = "^";
    let literalLength = 0;
    for (const match of english.matchAll(/\{(\w+)\}/g)) {
      const literal = english.slice(cursor, match.index);
      expression += escapeRegularExpression(literal);
      // Older JSX copy uses a separate interpolation for the English plural
      // suffix. It may be empty, "s", or "es", never arbitrary text. A broad
      // capture here also matched Croatian words such as "startovi" as stars.
      const isPluralSuffix = /[a-z]$/i.test(literal)
        && !croatian.includes(`{${match[1]}}`);
      const isCount = match[1] === "count" || (
        /^value\d+$/.test(match[1])
        && legacyCountSuffix.test(english.slice((match.index ?? 0) + match[0].length))
      );
      expression += isPluralSuffix ? "(s|es|)" : isCount ? numberCapture : "(.+?)";
      literalLength += literal.length;
      placeholders.push(match[1]);
      cursor = (match.index ?? 0) + match[0].length;
    }
    const trailingLiteral = english.slice(cursor);
    expression += `${escapeRegularExpression(trailingLiteral)}$`;
    literalLength += trailingLiteral.length;

    if (literalLength < 2 || !placeholders.length) continue;
    seen.add(signature);
    rules.push({
      pattern: new RegExp(expression),
      placeholders,
      template: croatian,
      literalLength,
      localizedPlaceholders: new Set(placeholders.filter((name) => (
        ["status", "state", "role"].includes(name)
        || (name === "value1" && legacyInterfaceValueTemplates.has(english))
      ))),
    });
  }

  return rules.sort((left, right) => right.literalLength - left.literalLength);
}

const exactTranslations = buildExactTranslations();
const templateRules = buildTemplateRules();
const localizedExactTranslations = new Set(exactTranslations.values());
const localizedTemplatePatterns = [
  ...orderedTranslationKeys().map((key) => croatianMessages[key]),
  ...Object.values(croatianApplicationTemplateCopy),
].flatMap((template) => {
  if (typeof template !== "string" || !template.includes("{")) return [];
  let cursor = 0;
  let expression = "^";
  let literalLength = 0;
  for (const match of template.matchAll(/\{\w+\}/g)) {
    const literal = template.slice(cursor, match.index);
    expression += `${escapeRegularExpression(literal)}.+?`;
    literalLength += literal.length;
    cursor = (match.index ?? 0) + match[0].length;
  }
  const trailingLiteral = template.slice(cursor);
  expression += `${escapeRegularExpression(trailingLiteral)}$`;
  literalLength += trailingLiteral.length;
  return literalLength >= 4 ? [new RegExp(expression)] : [];
});

// Both hits and misses recur across cards and observer deliveries. Keep this
// bounded and avoid retaining large organizer-authored strings in the cache.
const translationCache = new Map<string, string>();
const MAX_CACHED_TRANSLATIONS = 1024;
const MAX_CACHED_TEXT_LENGTH = 2048;

function translateUncached(value: string) {
  const leadingWhitespace = value.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = value.match(/\s*$/)?.[0] ?? "";
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return value;
  if (localizedExactTranslations.has(normalized)) return value;

  const exact = exactTranslations.get(normalized)
    ?? exactTranslations.get(normalizePortalEntityTerms(normalized));
  if (exact) return `${leadingWhitespace}${exact}${trailingWhitespace}`;

  // Organizer-authored route overviews can be assembled from several stable,
  // application-owned sentences. Translate every known sentence while leaving
  // any custom organizer copy untouched.
  const sentences = normalized.split(/(?<=[.!?])\s+/);
  if (sentences.length > 1) {
    let translatedSentenceCount = 0;
    const translatedSentences = sentences.map((sentence) => {
      const translated = exactTranslations.get(sentence);
      if (translated) translatedSentenceCount += 1;
      return translated ?? sentence;
    });
    if (translatedSentenceCount > 0) {
      return `${leadingWhitespace}${translatedSentences.join(" ")}${trailingWhitespace}`;
    }
  }

  // Registration controls combine stable round IDs with a numeric route count.
  // Translate only that count, rather than widening numeric captures to names.
  const roundRoutes = /^(R\d+(?: · R\d+)* · )(\d[\d.,]* routes)$/.exec(normalized);
  if (roundRoutes) {
    return `${leadingWhitespace}${roundRoutes[1]}${translateApplicationCopyToCroatian(roundRoutes[2])}${trailingWhitespace}`;
  }
  if (localizedTemplatePatterns.some((pattern) => pattern.test(normalized))) return value;

  for (const rule of templateRules) {
    const match = rule.pattern.exec(normalized);
    if (!match) continue;
    const replacements = new Map(rule.placeholders.map((placeholder, index) => {
      const captured = match[index + 1];
      return [placeholder, rule.localizedPlaceholders.has(placeholder)
        ? exactTranslations.get(captured) ?? captured
        : captured];
    }));
    const translated = rule.template.replace(/\{(\w+)\}/g, (placeholder, name: string) => (
      replacements.get(name) ?? placeholder
    ));
    return `${leadingWhitespace}${translated}${trailingWhitespace}`;
  }

  return value;
}

export function translateApplicationCopyToCroatian(value: string) {
  const cached = translationCache.get(value);
  if (cached !== undefined) {
    translationCache.delete(value);
    translationCache.set(value, cached);
    return cached;
  }
  const translated = translateUncached(value);
  if (value.length <= MAX_CACHED_TEXT_LENGTH && translated.length <= MAX_CACHED_TEXT_LENGTH) {
    translationCache.set(value, translated);
    if (translationCache.size > MAX_CACHED_TRANSLATIONS) {
      translationCache.delete(translationCache.keys().next().value!);
    }
  }
  return translated;
}

function elementSkipsAttributeLocalization(element: Element | null) {
  return Boolean(element?.closest(
    '[data-i18n-skip], [translate="no"], script, style, noscript, code, pre, [contenteditable="true"]',
  ));
}

function elementSkipsLocalization(element: Element | null) {
  return elementSkipsAttributeLocalization(element) || Boolean(element?.closest("textarea"));
}

export function installCroatianDocumentLocalization(root: HTMLElement) {
  type Translation = { source: string; translated: string };
  const originalText = new WeakMap<Text, Translation>();
  const originalAttributes = new WeakMap<Element, Map<string, Translation>>();
  const autoFitElements = new WeakMap<Element, string>();

  const markElementForLocaleFit = (element: Element) => {
    if (element.hasAttribute("data-locale-fit")) return;
    const className = element.getAttribute("class") ?? "";
    const role = element.getAttribute("role");
    let fit: "control" | "pill" | "table-heading" | null = null;
    if (className.includes("rounded-full") || role === "status") fit = "pill";
    else if (element.tagName === "TH" || role === "columnheader") fit = "table-heading";
    else if (element.tagName === "BUTTON" || role === "button" || role === "tab") fit = "control";
    if (!fit) return;
    autoFitElements.set(element, fit);
    element.setAttribute("data-locale-fit", fit);
  };

  const translateTextNode = (node: Text) => {
    if (elementSkipsLocalization(node.parentElement)) return;
    const current = node.data;
    if (current === originalText.get(node)?.translated) return;
    const translated = translateApplicationCopyToCroatian(current);
    if (translated === current) {
      originalText.delete(node);
      return;
    }
    originalText.set(node, { source: current, translated });
    node.data = translated;
    if (node.parentElement) markElementForLocaleFit(node.parentElement);
  };

  const translateAttributes = (element: Element, attributes: readonly string[] = userFacingAttributes) => {
    if (elementSkipsAttributeLocalization(element)) return;
    for (const attribute of attributes) {
      const current = element.getAttribute(attribute);
      if (!current) continue;
      if (current === originalAttributes.get(element)?.get(attribute)?.translated) continue;
      const translated = translateApplicationCopyToCroatian(current);
      if (translated === current) {
        originalAttributes.get(element)?.delete(attribute);
        continue;
      }
      const originals = originalAttributes.get(element) ?? new Map<string, Translation>();
      originals.set(attribute, { source: current, translated });
      originalAttributes.set(element, originals);
      element.setAttribute(attribute, translated);
      markElementForLocaleFit(element);
    }
  };

  const translateTree = (node: Node) => {
    if (node instanceof Text) {
      translateTextNode(node);
      return;
    }
    if (!(node instanceof Element)) return;
    if (elementSkipsAttributeLocalization(node)) return;
    translateAttributes(node);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (descendant) => descendant instanceof Element && elementSkipsAttributeLocalization(descendant)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let descendant = walker.nextNode();
    while (descendant) {
      if (descendant instanceof Text) translateTextNode(descendant);
      else if (descendant instanceof Element) translateAttributes(descendant);
      descendant = walker.nextNode();
    }
  };

  const restoreNode = (node: Node) => {
    if (node instanceof Text) {
      const previous = originalText.get(node);
      if (previous && node.data === previous.translated) node.data = previous.source;
      originalText.delete(node);
    } else if (node instanceof Element) {
      for (const [attribute, previous] of originalAttributes.get(node) ?? []) {
        if (node.getAttribute(attribute) === previous.translated) node.setAttribute(attribute, previous.source);
      }
      originalAttributes.delete(node);
      const fit = autoFitElements.get(node);
      if (fit && node.getAttribute("data-locale-fit") === fit) node.removeAttribute("data-locale-fit");
      autoFitElements.delete(node);
    }
  };

  const restoreTree = (node: Node) => {
    restoreNode(node);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let descendant = walker.nextNode();
    while (descendant) {
      restoreNode(descendant);
      descendant = walker.nextNode();
    }
  };

  const coveredByTree = (node: Node | null, trees: Set<Node>): boolean => {
    for (let current = node; current; current = current.parentNode) {
      if (trees.has(current)) return true;
      if (current === root) break;
    }
    return false;
  };

  const restoreRemovedTrees = (mutations: MutationRecord[]) => {
    const removedTrees = new Set<Node>();
    for (const mutation of mutations) {
      for (const removed of mutation.removedNodes) {
        if (!root.contains(removed)) removedTrees.add(removed);
      }
    }
    for (const removed of removedTrees) {
      if (!coveredByTree(removed.parentNode, removedTrees)) restoreTree(removed);
    }
  };

  translateTree(root);

  const observer = new MutationObserver((mutations) => {
    restoreRemovedTrees(mutations);
    const trees = new Set<Node>();
    const attributes = new Map<Element, Set<string>>();
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        trees.add(mutation.target);
      } else if (mutation.type === "attributes" && mutation.target instanceof Element && mutation.attributeName) {
        const names = attributes.get(mutation.target) ?? new Set<string>();
        names.add(mutation.attributeName);
        attributes.set(mutation.target, names);
      } else {
        mutation.addedNodes.forEach((node) => trees.add(node));
      }
    }
    for (const tree of trees) {
      if (root.contains(tree) && !coveredByTree(tree.parentNode, trees)) translateTree(tree);
    }
    for (const [element, names] of attributes) {
      if (root.contains(element) && !coveredByTree(element, trees)) translateAttributes(element, [...names]);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...userFacingAttributes],
  });

  return () => {
    const pending = observer.takeRecords();
    observer.disconnect();
    restoreRemovedTrees(pending);
    restoreTree(root);
  };
}
