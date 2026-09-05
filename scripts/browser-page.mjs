const READ_PAGE_DEFAULTS = Object.freeze({ max_chars: 20000, max_links: 100, max_citation_meta: 100 });
const READ_PAGE_LIMITS = Object.freeze({ max_chars: 200000, max_links: 1000, max_citation_meta: 1000 });

function invalidArgument(message) {
  return Object.assign(new Error(message), { code: 'INVALID_ARGUMENT', statusCode: 400 });
}

function boundedInteger(value, fallback, name, maximum) {
  const result = value === undefined ? fallback : value;
  if (!Number.isInteger(result) || result < 1 || result > maximum) {
    throw invalidArgument(`${name} must be an integer from 1 to ${maximum}`);
  }
  return result;
}

function validateReadPageOptions(options) {
  if (options === undefined) options = {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw invalidArgument('readPage body must be a JSON object');
  }
  const allowed = new Set(['selector', 'max_chars', 'max_links', 'max_citation_meta']);
  const unknown = Object.keys(options).filter(key => !allowed.has(key));
  if (unknown.length) throw invalidArgument(`unknown readPage field: ${unknown[0]}`);
  if (options.selector !== undefined && (typeof options.selector !== 'string' || !options.selector.trim() || options.selector.length > 2000)) {
    throw invalidArgument('selector must be a non-empty string of at most 2000 characters');
  }
  return {
    ...(options.selector === undefined ? {} : { selector: options.selector }),
    max_chars: boundedInteger(options.max_chars, READ_PAGE_DEFAULTS.max_chars, 'max_chars', READ_PAGE_LIMITS.max_chars),
    max_links: boundedInteger(options.max_links, READ_PAGE_DEFAULTS.max_links, 'max_links', READ_PAGE_LIMITS.max_links),
    max_citation_meta: boundedInteger(options.max_citation_meta, READ_PAGE_DEFAULTS.max_citation_meta,
      'max_citation_meta', READ_PAGE_LIMITS.max_citation_meta),
  };
}

// This function is serialized and evaluated in the selected page. It only reads
// the light DOM in the current frame; it never mutates the document.
function readPageInDocument(options) {
  const headingLimit = 100;
  const candidateLimit = 200;
  const candidateTextLimit = 5000;
  const candidateNodeLimit = 500;
  const automaticNodeLimit = 10000;
  const selectorNodeLimit = 50000;
  const headNodeLimit = 5000;
  const finalTextNodeLimit = 50000;
  const itemTextLimit = 4096;
  const itemNodeLimit = 2000;
  const linkUrlLimit = 8192;
  const citationNameLimit = 256;
  const citationValueLimit = 4096;
  const titleLimit = 4096;
  const pageUrlLimit = 8192;
  const langLimit = 256;
  const identityAttributeLimit = 256;
  const generatedSelectorLimit = 257;
  const textNodeWorkLimit = 65536;
  const ignoredTags = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'NAV', 'ASIDE', 'FORM', 'IFRAME',
    'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'FOOTER',
  ]);
  const ignoredRoles = new Set(['navigation', 'complementary', 'contentinfo', 'search', 'dialog', 'alertdialog']);
  const ignoredName = /(?:^|[-_\s])(nav|menu|sidebar|toolbar|breadcrumb|advert|ads?|promo|cookie|share|social|pagination)(?:$|[-_\s])/i;
  const blockTags = new Set([
    'ADDRESS', 'ARTICLE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'LI', 'MAIN', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
    'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
  ]);

  const boundString = (value, limit) => {
    const string = typeof value === 'string' ? value : value == null ? '' : String(value);
    return { value: string.slice(0, limit), truncated: string.length > limit };
  };
  const boundClass = value => {
    const bounded = boundString(value, identityAttributeLimit);
    if (bounded.truncated && bounded.value && !/\s$/.test(bounded.value)) {
      bounded.value = bounded.value.replace(/\S+$/, '');
    }
    return bounded;
  };

  const clean = value => String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/[\t\f\v ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  const styleOf = element => {
    try { return getComputedStyle(element); }
    catch { return element.style || {}; }
  };

  const isHidden = element => {
    if (!element || element.nodeType !== 1) return false;
    const style = styleOf(element);
    const opacity = Number.parseFloat(style.opacity);
    return element.hidden || element.hasAttribute?.('hidden') ||
      String(element.getAttribute?.('aria-hidden') || '').toLowerCase() === 'true' ||
      style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
      Number.isFinite(opacity) && opacity <= 0;
  };

  const isIgnored = element => {
    if (!element || element.nodeType !== 1) return false;
    if (ignoredTags.has(element.tagName)) return true;
    const role = boundString(element.getAttribute?.('role') || '', identityAttributeLimit).value.toLowerCase();
    if (ignoredRoles.has(role)) return true;
    const id = boundString(element.id || '', identityAttributeLimit).value;
    const className = boundClass(typeof element.className === 'string' ? element.className : '').value;
    return ignoredName.test(`${id} ${className}`);
  };

  const excludedFromDocument = element => {
    for (let current = element; current; current = current.parentElement) {
      if (isHidden(current) || isIgnored(current)) return true;
    }
    return false;
  };

  const visibleRegion = element => {
    if (!element || excludedFromDocument(element)) return false;
    const rect = element.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0 && element.getClientRects?.().length > 0);
  };

  const textFrom = (root, limit, nodeLimit) => {
    let output = '';
    let visited = 0;
    let truncated = false;
    const maximum = limit + 1;
    const append = value => {
      if (output.length >= maximum) { truncated = true; return false; }
      const available = maximum - output.length;
      if (value.length > available) {
        output += value.slice(0, available);
        truncated = true;
        return false;
      }
      output += value;
      return true;
    };
    const appendText = value => {
      const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
      const available = Math.max(0, maximum - output.length);
      const workLimit = Math.min(textNodeWorkLimit, Math.max(1024, available * 2 + 1024));
      const sample = raw.slice(0, workLimit);
      if (raw.length > sample.length) truncated = true;
      const normalized = sample.replace(/\s+/g, ' ').trim();
      if (!normalized) return true;
      const separator = output && !/[\s\n]$/.test(output) ? ' ' : '';
      return append(separator + normalized);
    };
    const appendBreak = () => !output || output.endsWith('\n') ? true : append('\n');
    const stack = [{ node: root, entered: false, index: 0, block: false }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (!frame.entered) {
        visited++;
        if (visited > nodeLimit) { truncated = true; break; }
        const node = frame.node;
        if (!node) { stack.pop(); continue; }
        if (node.nodeType === 3) {
          appendText(node.nodeValue || '');
          stack.pop();
          if (output.length >= maximum) { truncated = true; break; }
          continue;
        }
        // Ancestors already passed this check before their children entered the
        // stack, so checking only the current node keeps deep trees linear.
        if (node.nodeType !== 1 || isHidden(node) || isIgnored(node)) { stack.pop(); continue; }
        frame.entered = true;
        frame.block = blockTags.has(node.tagName);
        if (frame.block && !appendBreak()) break;
      }
      const children = frame.node.childNodes || [];
      if (frame.index < children.length) {
        stack.push({ node: children[frame.index++], entered: false, index: 0, block: false });
      } else {
        if (frame.block && !appendBreak()) break;
        stack.pop();
      }
    }
    if (stack.length) truncated = true;
    const text = clean(output);
    return { text: text.slice(0, limit), truncated: truncated || text.length > limit };
  };

  const describe = element => {
    const id = boundString(element.id || '', identityAttributeLimit);
    if (id.value) {
      const selector = boundString(`#${id.value}`, generatedSelectorLimit);
      return { selector: selector.value, truncated: id.truncated || selector.truncated };
    }
    const name = (element.tagName || 'region').toLowerCase();
    const className = boundClass(typeof element.className === 'string' ? element.className : '');
    const firstClass = className.value.trim().split(/\s+/)[0] || '';
    const selector = boundString(firstClass ? `${name}.${firstClass}` : name, generatedSelectorLimit);
    return { selector: selector.value, truncated: className.truncated || selector.truncated };
  };

  // Depth-first traversal stays proportional to an explicit element budget and
  // skips hidden/chrome subtrees before their descendants are materialized.
  const walkElements = (start, nodeLimit, visit, skipRootExclusions = false, applyExclusions = true) => {
    if (!start) return { truncated: false, visited: 0 };
    const stack = [{ node: start, entered: false, index: 0 }];
    let visited = 0;
    let truncated = false;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const node = frame.node;
      if (!frame.entered) {
        visited++;
        if (visited > nodeLimit) { truncated = true; break; }
        if (!node || node.nodeType !== 1) { stack.pop(); continue; }
        const element = node;
        if (applyExclusions && (!skipRootExclusions || element !== start) &&
            (isHidden(element) || isIgnored(element))) { stack.pop(); continue; }
        const decision = visit(element);
        if (decision === 'stop') { truncated = true; break; }
        if (decision === 'skip') { stack.pop(); continue; }
        frame.entered = true;
      }
      const children = node.childNodes || [];
      if (frame.index < children.length) {
        stack.push({ node: children[frame.index++], entered: false, index: 0 });
      } else {
        stack.pop();
      }
    }
    return { truncated, visited };
  };

  const pageTitle = boundString(document.title || '', titleLimit);
  const pageUrl = boundString(location.href || '', pageUrlLimit);
  const pageLang = boundString(document.documentElement?.lang ||
    document.documentElement?.getAttribute?.('lang') || '', langLimit);

  let root;
  let extraction;
  let candidateScanTruncated = false;
  let extractionSelectorTruncated = false;
  if (options.selector !== undefined) {
    const matches = [];
    try {
      // Validate once before walking. Element.matches does not allocate the
      // complete match set for arbitrary selectors.
      document.documentElement.matches(options.selector);
    }
    catch (error) { return { error: error.message, code: 'INVALID_SELECTOR', selector: options.selector }; }
    const selectorScan = walkElements(document.documentElement, selectorNodeLimit, element => {
      if (element.matches(options.selector)) {
        matches.push(element);
        if (matches.length >= 2) return 'stop';
      }
      return undefined;
    }, true, false);
    const details = { selector: options.selector, match_count: matches.length,
      ...(selectorScan.truncated ? { match_count_truncated: true } : {}) };
    if (selectorScan.truncated && matches.length < 2) {
      return { error: `Selector scan exceeded ${selectorNodeLimit} DOM nodes: ${options.selector}`,
        code: 'SELECTOR_SCAN_LIMIT', selector_scan_truncated: true, ...details };
    }
    if (matches.length === 0) return { error: `No element found: ${options.selector}`, code: 'ELEMENT_NOT_FOUND', ...details };
    if (matches.length > 1) return { error: `Selector matched multiple elements: ${options.selector}`, code: 'SELECTOR_AMBIGUOUS', ...details };
    if (!visibleRegion(matches[0])) return { error: `Element is not visible: ${options.selector}`, code: 'ELEMENT_NOT_VISIBLE', ...details };
    root = matches[0];
    extraction = { method: 'selector', selector: options.selector };
  } else {
    const semanticClasses = new Set(['article', 'article-body', 'post', 'post-content', 'content', 'main-content']);
    const semanticIds = new Set(['content', 'main']);
    const semanticCandidate = element => {
      if (element.tagName === 'ARTICLE' || element.tagName === 'MAIN') return true;
      const role = boundString(element.getAttribute?.('role') || '', identityAttributeLimit).value.toLowerCase();
      if (role === 'main') return true;
      const id = boundString(element.id || '', identityAttributeLimit).value;
      if (semanticIds.has(id)) return true;
      const className = boundClass(typeof element.className === 'string' ? element.className : '').value;
      return className.split(/\s+/).some(name => semanticClasses.has(name));
    };
    const candidates = [];
    const candidateScan = walkElements(document.body, automaticNodeLimit, element => {
      if (semanticCandidate(element) && visibleRegion(element)) {
        if (candidates.length >= candidateLimit) return 'stop';
        candidates.push(element);
      }
      return undefined;
    });
    candidateScanTruncated = candidateScan.truncated;
    const scored = candidates.map((element, index) => {
      const sample = textFrom(element, candidateTextLimit, candidateNodeLimit);
      const role = boundString(element.getAttribute?.('role') || '', identityAttributeLimit).value.toLowerCase();
      const semanticBonus = element.tagName === 'ARTICLE' ? 400 : element.tagName === 'MAIN' || role === 'main' ? 250 : 100;
      return { element, index, text_length: sample.text.length,
        score: sample.text.length + semanticBonus };
    }).filter(candidate => candidate.text_length > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);
    root = scored[0]?.element || document.body;
    if (scored.length) {
      const described = describe(root);
      extractionSelectorTruncated = described.truncated;
      extraction = { method: 'semantic', selector: described.selector };
    } else {
      extraction = { method: 'body', selector: 'body' };
    }
  }

  extraction = { ...extraction, heuristic: true, scope: 'current_frame_light_dom',
    candidate_scan_truncated: candidateScanTruncated };

  if (!root) return { error: 'Document body is unavailable', code: 'ELEMENT_NOT_FOUND', selector: 'body', match_count: 0 };
  if (extraction.method === 'body' && excludedFromDocument(root)) {
    return { error: 'Document body is not visible', code: 'ELEMENT_NOT_VISIBLE', selector: 'body', match_count: 1 };
  }

  const completeText = textFrom(root, options.max_chars, finalTextNodeLimit);
  const headings = [];
  let headingsTruncated = false;
  const links = [];
  const seenLinks = new Set();
  let linksTruncated = false;
  const collectionScan = walkElements(root, automaticNodeLimit, element => {
    // querySelectorAll historically excluded the extraction root itself.
    if (element === root) return undefined;
    const match = /^H([1-6])$/.exec(element.tagName || '');
    const role = boundString(element.getAttribute?.('role') || '', identityAttributeLimit).value.toLowerCase();
    if (match || role === 'heading') {
      if (headings.length >= headingLimit) {
        headingsTruncated = true;
      } else {
        const extracted = textFrom(element, itemTextLimit, itemNodeLimit);
        if (extracted.text) {
          const ariaLevel = Number(boundString(element.getAttribute?.('aria-level') || '', 16).value);
          headings.push({ level: match ? Number(match[1]) : Number.isInteger(ariaLevel) && ariaLevel > 0 ? ariaLevel : 0,
            text: extracted.text });
          if (extracted.truncated) headingsTruncated = true;
        }
      }
    }

    if (element.tagName === 'A' && element.hasAttribute?.('href')) {
      const href = boundString(element.href || element.getAttribute?.('href') || '', linkUrlLimit);
      if (href.truncated) {
        linksTruncated = true;
        return undefined;
      }
      let url;
      try { url = new URL(href.value, pageUrl.value); }
      catch { return undefined; }
      if (!['http:', 'https:'].includes(url.protocol) || seenLinks.has(url.href)) return undefined;
      if (url.href.length > linkUrlLimit) {
        linksTruncated = true;
        return undefined;
      }
      if (links.length >= options.max_links) {
        linksTruncated = true;
        return undefined;
      }
      seenLinks.add(url.href);
      const extracted = textFrom(element, itemTextLimit, itemNodeLimit);
      links.push({ text: extracted.text, url: url.href });
      if (extracted.truncated) linksTruncated = true;
    }
    return undefined;
  }, true);
  if (collectionScan.truncated) {
    headingsTruncated = true;
    linksTruncated = true;
  }

  const citationMeta = {};
  let citationMetaCount = 0;
  let citationMetaTruncated = false;
  const citationScan = walkElements(document.head, headNodeLimit, meta => {
    if (meta.tagName !== 'META' || !meta.hasAttribute?.('name')) return undefined;
    const boundedName = boundString(meta.getAttribute?.('name') || '', citationNameLimit);
    if (boundedName.truncated) {
      citationMetaTruncated = true;
      return undefined;
    }
    const name = boundedName.value.trim().toLowerCase();
    if (!name.startsWith('citation_')) return undefined;
    const boundedContent = boundString(meta.getAttribute?.('content') || '', citationValueLimit);
    const content = boundedContent.value.trim();
    if (boundedContent.truncated) citationMetaTruncated = true;
    if (!content) return undefined;
    const values = citationMeta[name] || [];
    if (values.includes(content)) return undefined;
    if (citationMetaCount >= options.max_citation_meta) {
      citationMetaTruncated = true;
      return 'stop';
    }
    if (!citationMeta[name]) citationMeta[name] = values;
    values.push(content);
    citationMetaCount++;
    return undefined;
  }, true, false);
  if (citationScan.truncated) citationMetaTruncated = true;

  return {
    title: pageTitle.value,
    url: pageUrl.value,
    lang: pageLang.value,
    text: completeText.text,
    headings,
    links,
    citation_meta: citationMeta,
    extraction,
    truncated: {
      title: pageTitle.truncated,
      url: pageUrl.truncated,
      lang: pageLang.truncated,
      text: completeText.truncated,
      headings: headingsTruncated,
      links: linksTruncated,
      citation_meta: citationMetaTruncated,
      extraction_selector: extractionSelectorTruncated,
    },
  };
}

export function buildReadPageExpression(options = {}) {
  const validated = validateReadPageOptions(options);
  return `(${readPageInDocument.toString()})(${JSON.stringify(validated)})`;
}

const ELEMENT_ACTIONS = new Set([
  'click', 'coordinates', 'revalidateCoordinates', 'finishClick',
  'fill', 'insertText', 'inspect',
]);
const ELEMENT_TEXT_LIMIT = 100000;

function validateElementActionOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw invalidArgument('element action options must be an object');
  }
  const allowed = new Set(['selector', 'action', 'text', 'guard_id']);
  const unknown = Object.keys(options).filter(key => !allowed.has(key));
  if (unknown.length) throw invalidArgument(`unknown element action field: ${unknown[0]}`);
  if (typeof options.selector !== 'string' || !options.selector.trim() || options.selector.length > 2000) {
    throw invalidArgument('selector must be a non-empty string of at most 2000 characters');
  }
  if (!ELEMENT_ACTIONS.has(options.action)) throw invalidArgument('unsupported element action');
  const guardedActions = new Set(['coordinates', 'revalidateCoordinates', 'finishClick']);
  if (options.guard_id !== undefined && (typeof options.guard_id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(options.guard_id))) {
    throw invalidArgument('guard_id must contain 1 to 100 safe characters');
  }
  if (['revalidateCoordinates', 'finishClick'].includes(options.action) && !options.guard_id) {
    throw invalidArgument('guard_id is required for guarded action completion');
  }
  if (options.guard_id !== undefined && !guardedActions.has(options.action)) {
    throw invalidArgument('guard_id is not accepted by this action');
  }
  if (options.action === 'fill' || options.action === 'insertText') {
    if (typeof options.text !== 'string' || options.text.length > ELEMENT_TEXT_LIMIT) {
      throw invalidArgument(`action text must be a string of at most ${ELEMENT_TEXT_LIMIT} characters`);
    }
  } else if (options.text !== undefined) {
    throw invalidArgument('text is only accepted by fill or insertText actions');
  }
  return { selector: options.selector, action: options.action,
    ...(['fill', 'insertText'].includes(options.action) ? { text: options.text } : {}),
    ...(options.guard_id === undefined ? {} : { guard_id: options.guard_id }) };
}

// Selection, actionability inspection, and any page-side action happen in one
// evaluation so the target cannot silently fall back to the first match.
function actOnElementInDocument(options) {
  const guardKey = options.guard_id ? `__academic_search_action_guard_${options.guard_id}` : null;
  const cleanupGuard = state => {
    for (const [type, listener] of state?.listeners || []) {
      try { document.removeEventListener(type, listener, true); }
      catch { /* The page may have replaced its event methods. */ }
    }
    if (guardKey) {
      try { delete globalThis[guardKey]; }
      catch { globalThis[guardKey] = undefined; }
    }
  };

  if (options.action === 'finishClick') {
    const state = guardKey ? globalThis[guardKey] : null;
    if (!state || state.kind !== 'click') {
      return { error: 'Click target changed', code: 'ELEMENT_CHANGED',
        selector: options.selector, match_count: 0, dispatch_target_verified: false };
    }
    cleanupGuard(state);
    if (state.wrong_target) {
      return { error: `Pointer dispatch reached another element: ${options.selector}`, code: 'ELEMENT_OCCLUDED',
        ...state.identity, dispatch_target_verified: false, wrong_event: state.wrong_event };
    }
    return { ...state.identity,
      dispatch_target_verified: state.mousedown === true && state.mouseup === true && state.click === true };
  }

  let elements;
  try { elements = Array.from(document.querySelectorAll(options.selector)); }
  catch (error) { return { error: error.message, code: 'INVALID_SELECTOR', selector: options.selector }; }
  const candidates = elements.slice(0, 5).map(element => ({
    tag: element.tagName,
    id: element.id || '',
    text: String(element.textContent || '').trim().slice(0, 100),
  }));
  const details = { selector: options.selector, match_count: elements.length, candidates };
  if (elements.length === 0) return { error: `未找到元素: ${options.selector}`, code: 'ELEMENT_NOT_FOUND', ...details };
  if (elements.length > 1) return { error: `选择器匹配多个元素: ${options.selector}`, code: 'SELECTOR_AMBIGUOUS', ...details };
  const element = elements[0];
  const identity = { ...candidates[0], ...details };
  if (options.action === 'inspect') {
    return { ...identity, tag: element.tagName, type: element.getAttribute?.('type') || element.type || '' };
  }

  const ancestorHas = predicate => {
    for (let current = element; current; current = current.parentElement) if (predicate(current)) return true;
    return false;
  };
  const styleOf = candidate => {
    try { return getComputedStyle(candidate); }
    catch { return candidate.style || {}; }
  };
  if (!element.isConnected) return { error: `Element is detached: ${options.selector}`, code: 'ELEMENT_DETACHED', ...identity };
  let nativeDisabled = false;
  try { nativeDisabled = element.matches?.(':disabled') === true; }
  catch { /* A non-Element test double cannot be natively disabled. */ }
  if (element.disabled === true || element.hasAttribute?.('disabled') || nativeDisabled || ancestorHas(current => current.getAttribute?.('aria-disabled') === 'true')) {
    return { error: `Element is disabled: ${options.selector}`, code: 'ELEMENT_DISABLED', ...identity };
  }
  if (ancestorHas(current => current.inert === true || current.hasAttribute?.('inert'))) {
    return { error: `Element is inert: ${options.selector}`, code: 'ELEMENT_INERT', ...identity };
  }
  const hiddenByAncestor = ancestorHas(current => {
    const currentStyle = styleOf(current);
    const opacity = Number.parseFloat(currentStyle.opacity);
    return current.hidden === true || current.hasAttribute?.('hidden') ||
      String(current.getAttribute?.('aria-hidden') || '').toLowerCase() === 'true' ||
      currentStyle.display === 'none' || currentStyle.visibility === 'hidden' || currentStyle.visibility === 'collapse' ||
      Number.isFinite(opacity) && opacity <= 0;
  });
  const style = styleOf(element);
  const rect = element.getBoundingClientRect?.();
  const visible = !hiddenByAncestor &&
    rect && rect.width > 0 && rect.height > 0 && element.getClientRects?.().length > 0;
  if (!visible) return { error: `Element is not visible: ${options.selector}`, code: 'ELEMENT_NOT_VISIBLE', ...identity };

  const tag = element.tagName;
  const type = String(element.getAttribute?.('type') || element.type || '').toLowerCase();
  const unsupportedInputTypes = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);
  const textInputTypes = new Set(['', 'text', 'search', 'tel', 'url', 'email', 'password']);
  if (options.action === 'fill') {
    if (!['INPUT', 'TEXTAREA'].includes(tag) || tag === 'INPUT' && unsupportedInputTypes.has(type)) {
      return { error: `Element cannot be filled: ${options.selector}`, code: 'INVALID_ELEMENT', ...identity };
    }
    if (element.readOnly) return { error: `Element is read-only: ${options.selector}`, code: 'ELEMENT_READONLY', ...identity };
    let prototype = Object.getPrototypeOf(element);
    let setter;
    while (prototype && !setter) {
      setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      prototype = Object.getPrototypeOf(prototype);
    }
    if (setter) setter.call(element, options.text);
    else element.value = options.text;
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return { ...identity, status: 'dispatched', outcome_verified: false,
      immediate_value_verified: String(element.value) === options.text };
  }

  if (options.action === 'insertText') {
    const contentEditable = element.isContentEditable === true ||
      ['', 'true', 'plaintext-only'].includes(String(element.getAttribute?.('contenteditable')).toLowerCase());
    const textControl = tag === 'TEXTAREA' || tag === 'INPUT' && textInputTypes.has(type);
    if (!textControl && !contentEditable) {
      return { error: `Element is not editable: ${options.selector}`, code: 'INVALID_ELEMENT', ...identity,
        insert_target_verified: false };
    }
    if (textControl && element.readOnly) {
      return { error: `Element is read-only: ${options.selector}`, code: 'ELEMENT_READONLY', ...identity,
        insert_target_verified: false };
    }
    try { element.focus({ preventScroll: true }); }
    catch { element.focus(); }
    const focused = () => document.activeElement === element || element.contains?.(document.activeElement);
    if (!focused()) {
      return { error: `Element did not receive focus: ${options.selector}`, code: 'FOCUS_FAILED',
        ...identity, focus_verified: false, insert_target_verified: false };
    }
    const inputEvent = (eventType, cancelable) => {
      if (typeof InputEvent === 'function') {
        return new InputEvent(eventType, { bubbles: true, composed: true, cancelable,
          inputType: 'insertText', data: options.text });
      }
      const event = new Event(eventType, { bubbles: true, composed: true, cancelable });
      try {
        Object.defineProperties(event, {
          inputType: { value: 'insertText' }, data: { value: options.text },
        });
      } catch { /* Older pages still receive a standard input event. */ }
      return event;
    };
    const beforeInput = inputEvent('beforeinput', true);
    if (!element.dispatchEvent(beforeInput)) {
      return { error: `Input was canceled by the page: ${options.selector}`, code: 'INPUT_CANCELED',
        ...identity, status: 'blocked', focus_verified: focused(), insert_target_verified: false,
        insertion_method: 'exact_target_dom_edit', keyboard_semantics: false };
    }
    if (!element.isConnected || !focused()) {
      return { error: `Element lost focus before insertion: ${options.selector}`, code: 'FOCUS_LOST',
        ...identity, status: 'blocked', focus_verified: false, insert_target_verified: false,
        insertion_method: 'exact_target_dom_edit', keyboard_semantics: false };
    }
    if (textControl && element.readOnly) {
      return { error: `Element became read-only before insertion: ${options.selector}`, code: 'ELEMENT_READONLY',
        ...identity, status: 'blocked', focus_verified: true, insert_target_verified: false,
        insertion_method: 'exact_target_dom_edit', keyboard_semantics: false };
    }

    let immediateTextVerified = false;
    if (textControl) {
      const before = String(element.value || '');
      const rawStart = Number.isInteger(element.selectionStart) ? element.selectionStart : before.length;
      const rawEnd = Number.isInteger(element.selectionEnd) ? element.selectionEnd : rawStart;
      const start = Math.max(0, Math.min(before.length, rawStart));
      const end = Math.max(start, Math.min(before.length, rawEnd));
      const expected = before.slice(0, start) + options.text + before.slice(end);
      let usedRangeText = false;
      if (typeof element.setRangeText === 'function') {
        try {
          element.setRangeText(options.text, start, end, 'end');
          usedRangeText = true;
        } catch { /* Some text-like input types expose but reject selection APIs. */ }
      }
      if (!usedRangeText) {
        let prototype = Object.getPrototypeOf(element);
        let setter;
        while (prototype && !setter) {
          setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
          prototype = Object.getPrototypeOf(prototype);
        }
        if (setter) setter.call(element, expected); else element.value = expected;
        try { element.setSelectionRange?.(start + options.text.length, start + options.text.length); }
        catch { /* Some text-like controls do not expose selection APIs. */ }
      }
      immediateTextVerified = String(element.value) === expected;
    } else {
      const ownerDocument = element.ownerDocument || document;
      const selection = ownerDocument.getSelection?.();
      let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const inTarget = node => node === element || element.contains?.(node);
      if (!range || !inTarget(range.startContainer) || !inTarget(range.endContainer)) {
        range = ownerDocument.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
      }
      range.deleteContents();
      if (options.text) {
        const inserted = ownerDocument.createTextNode(options.text);
        range.insertNode(inserted);
        range.setStartAfter(inserted);
        range.collapse(true);
        immediateTextVerified = inserted.parentNode === element || element.contains?.(inserted.parentNode);
      } else {
        immediateTextVerified = true;
      }
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (selection && (!inTarget(selection.anchorNode) || !inTarget(selection.focusNode))) {
        return { error: `Editable selection escaped the target: ${options.selector}`, code: 'FOCUS_LOST',
          ...identity, status: 'blocked', focus_verified: false, insert_target_verified: false,
          insertion_method: 'exact_target_dom_edit', keyboard_semantics: false };
      }
    }
    element.dispatchEvent(inputEvent('input', false));
    return { ...identity, status: 'dispatched', outcome_verified: false, focus_verified: true,
      insert_target_verified: true, immediate_text_verified: immediateTextVerified,
      insertion_method: 'exact_target_dom_edit', keyboard_semantics: false };
  }

  const pointerDetails = () => {
    const pointerRect = element.getBoundingClientRect();
    const pointerStyle = styleOf(element);
    if (pointerRect.width <= 0 || pointerRect.height <= 0) {
      return { error: `Element has no pointer area: ${options.selector}`, code: 'ELEMENT_NOT_VISIBLE', ...identity };
    }
    if (pointerStyle.pointerEvents === 'none') {
      return { error: `Element does not accept pointer events: ${options.selector}`, code: 'POINTER_EVENTS_DISABLED', ...identity };
    }
    const x = pointerRect.x + pointerRect.width / 2;
    const y = pointerRect.y + pointerRect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit !== element && !element.contains?.(hit)) {
      return { error: `Element center is occluded: ${options.selector}`, code: 'ELEMENT_OCCLUDED', ...identity };
    }
    return { x, y };
  };

  if (options.action === 'revalidateCoordinates') {
    const state = guardKey ? globalThis[guardKey] : null;
    if (!state || state.kind !== 'click' || state.element !== element) {
      return { error: `Element changed before pointer dispatch: ${options.selector}`, code: 'ELEMENT_CHANGED',
        ...identity, dispatch_target_verified: false };
    }
    const pointer = pointerDetails();
    if (pointer.error) return { ...pointer, dispatch_target_verified: false };
    if (Math.abs(pointer.x - state.x) > 0.5 || Math.abs(pointer.y - state.y) > 0.5) {
      return { error: `Element coordinates changed before pointer dispatch: ${options.selector}`, code: 'ELEMENT_CHANGED',
        ...identity, x: pointer.x, y: pointer.y, dispatch_target_verified: false };
    }
    return { ...pointer, ...identity };
  }

  element.scrollIntoView({ block: 'center', inline: 'center' });
  const pointer = pointerDetails();
  if (pointer.error) return pointer;
  const { x, y } = pointer;
  if (options.action === 'click') {
    element.click();
    return { clicked: true, status: 'dispatched', outcome_verified: false, ...identity };
  }
  if (guardKey) {
    const previous = globalThis[guardKey];
    if (previous) cleanupGuard(previous);
    const state = { kind: 'click', element, identity, x, y, listeners: [], wrong_target: false,
      mousedown: false, mouseup: false, click: false };
    const observe = type => event => {
      const targetMatches = event.target === element || element.contains?.(event.target);
      const coordinatesMatch = !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) ||
        Math.abs(event.clientX - state.x) <= 2 && Math.abs(event.clientY - state.y) <= 2;
      if (targetMatches && coordinatesMatch) {
        state[type] = true;
        return;
      }
      state.wrong_target = true;
      state.wrong_event = { type, tag: event.target?.tagName || '', id: event.target?.id || '',
        client_x: event.clientX, client_y: event.clientY };
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      event.stopPropagation?.();
    };
    for (const type of ['mousedown', 'mouseup', 'click']) {
      const listener = observe(type);
      state.listeners.push([type, listener]);
      document.addEventListener(type, listener, true);
    }
    Object.defineProperty(globalThis, guardKey, { value: state, configurable: true });
  }
  return { x, y, ...identity };
}

export function buildElementActionExpression(options) {
  const validated = validateElementActionOptions(options);
  return `(${actOnElementInDocument.toString()})(${JSON.stringify(validated)})`;
}

const NAMED_KEYS = new Map([
  ['Enter', { code: 'Enter', virtualKeyCode: 13, text: '\r' }],
  ['Tab', { code: 'Tab', virtualKeyCode: 9 }],
  ['Escape', { code: 'Escape', virtualKeyCode: 27 }],
  ['Backspace', { code: 'Backspace', virtualKeyCode: 8 }],
  ['Delete', { code: 'Delete', virtualKeyCode: 46 }],
  ['Insert', { code: 'Insert', virtualKeyCode: 45 }],
  ['Home', { code: 'Home', virtualKeyCode: 36 }],
  ['End', { code: 'End', virtualKeyCode: 35 }],
  ['PageUp', { code: 'PageUp', virtualKeyCode: 33 }],
  ['PageDown', { code: 'PageDown', virtualKeyCode: 34 }],
  ['ArrowUp', { code: 'ArrowUp', virtualKeyCode: 38 }],
  ['ArrowDown', { code: 'ArrowDown', virtualKeyCode: 40 }],
  ['ArrowLeft', { code: 'ArrowLeft', virtualKeyCode: 37 }],
  ['ArrowRight', { code: 'ArrowRight', virtualKeyCode: 39 }],
]);

export function validatePressKey(key) {
  if (typeof key !== 'string' || key.length > 32) throw invalidArgument('key must be a supported named key or one Unicode character');
  if (NAMED_KEYS.has(key)) {
    const definition = NAMED_KEYS.get(key);
    return { key, code: definition.code, windowsVirtualKeyCode: definition.virtualKeyCode,
      nativeVirtualKeyCode: definition.virtualKeyCode,
      ...(definition.text === undefined ? {} : { text: definition.text, unmodifiedText: definition.text }) };
  }
  if (Array.from(key).length === 1) return { key, text: key };
  throw invalidArgument('key must be a supported named key or one Unicode character');
}
