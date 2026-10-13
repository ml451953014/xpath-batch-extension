/* Row-aligned multi-field extraction. Pure DOM/XPath; no network, models, or storage. */
(function (root) {
  'use strict';
  const core = root.XPathBatchCore || (typeof module !== 'undefined' && module.exports ? require('./core.js') : null);
  if (!core) throw new Error('请先加载 XPathBatchCore');
  const HTML = 'http://www.w3.org/1999/xhtml';
  const sameTag = (a, b) => a.localName === b.localName && a.namespaceURI === b.namespaceURI;
  const tagStep = el => el.namespaceURI === HTML ? el.localName : '*[local-name()=' + core.xpathLiteral(el.localName) + ' and namespace-uri()=' + core.xpathLiteral(el.namespaceURI || '') + ']';
  const position = el => Array.from(el.parentElement ? el.parentElement.children : []).filter(e => sameTag(e, el)).indexOf(el) + 1;
  const commonClasses = (a, b) => Array.from(a.classList).filter(token => b.classList.contains(token));
  const classPred = tokens => tokens.map(token => '[contains(concat(" ",normalize-space(@class)," "),' + core.xpathLiteral(' ' + token + ' ') + ')]').join('');
  const distinct = strings => Array.from(new Set(strings));

  function requireElement(el, doc) {
    if (!el || el.nodeType !== 1 || !el.ownerDocument || el.getRootNode() !== el.ownerDocument || (doc && el.ownerDocument !== doc)) {
      throw new Error('样本和记录必须属于同一主文档的普通 DOM，不能使用脱离文档的元素或 Shadow DOM');
    }
  }

  function checkSamples(a, b) {
    requireElement(a);
    requireElement(b, a.ownerDocument);
    if (a === b) throw new Error('请选择两个不同记录中的同一字段，不能重复选择同一个元素');
    if (a.contains(b) || b.contains(a)) throw new Error('两个样本互相嵌套，请选择不同记录中的同一字段');
  }

  function checkedRows(rows, doc) {
    if (!Array.isArray(rows)) throw new Error('记录集合必须是元素数组');
    const found = new Set();
    for (const row of rows) {
      requireElement(row, doc || (rows[0] && rows[0].ownerDocument));
      if (found.has(row)) throw new Error('记录集合包含重复元素');
      found.add(row);
    }
    const ordered = rows.slice().sort((a, b) => a === b ? 0 : (a.compareDocumentPosition(b) & 2 ? 1 : -1));
    // In document order every ancestor precedes its descendants. A stack is not
    // necessary: any nested row is detected against the preceding outer row.
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i - 1].contains(ordered[i])) throw new Error('记录集合包含互相嵌套的元素，请把记录 XPath 限定到同一层级');
    }
    return ordered;
  }

  function pathFrom(row, sample) {
    if (row === sample) return [];
    if (!row.contains(sample)) throw new Error('字段样本不属于指定记录');
    const path = [];
    for (let el = sample; el !== row; el = el.parentElement) path.unshift(el);
    return path;
  }

  // Tokenization keeps literal values opaque. In particular, a URL or '..' in
  // an attribute value cannot be mistaken for an escaping XPath step.
  function tokensOf(xpath) {
    const tokens = [];
    for (let i = 0; i < xpath.length;) {
      const tail = xpath.slice(i);
      if (/^\s/.test(tail)) { i++; continue; }
      const quote = xpath[i];
      if (quote === '"' || quote === "'") {
        const end = xpath.indexOf(quote, i + 1);
        if (end === -1) throw new Error('字段 XPath 的引号没有闭合');
        tokens.push({ value: xpath.slice(i, end + 1), literal: true });
        i = end + 1;
        continue;
      }
      const match = tail.match(/^(?:\/\/|\.\.|::|!=|<=|>=|[\p{L}_][\p{L}\p{N}_.-]*(?::(?!:)[\p{L}_*][\p{L}\p{N}_.-]*)?|\d+(?:\.\d*)?|\.\d+|.)/u);
      tokens.push({ value: match[0], literal: false });
      i += match[0].length;
    }
    return tokens;
  }

  function validateFieldXPath(xpath) {
    if (typeof xpath !== 'string' || !xpath.trim()) throw new Error('字段 XPath 不能为空');
    if (/^(?:count|string|boolean|number)\s*\(/.test(xpath.trim())) throw new Error('字段 XPath 不支持 count()/string()/boolean()/number() 等标量结果，请使用返回元素、属性或文本节点的行内路径');
    const tokens = tokensOf(xpath.trim());
    const allowedAxes = new Set(['child', 'self', 'descendant', 'descendant-or-self', 'attribute']);
    // XPath operator words are also legal element/attribute names. A name
    // after /, //, ::, @, [ or ( begins an operand; after a completed operand
    // it is an operator. Compute the distinction left-to-right so paths such
    // as ./and/div remain valid without allowing [and div /outside].
    const operatorWords = new Set(['and', 'or', 'div', 'mod']);
    const symbolicOperators = new Set(['/', '//', '|', '+', '-', '=', '!=', '<', '>', '<=', '>=']);
    const operandStarts = new Set(['@', '::', '(', '[', ',']);
    const operatorTokens = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i], prev = tokens[i - 1];
      operatorTokens[i] = !token.literal && (symbolicOperators.has(token.value) ||
        ((operatorWords.has(token.value) || token.value === '*') && !!prev &&
          (prev.literal || (!operandStarts.has(prev.value) && !operatorTokens[i - 1]))));
    }
    let brackets = 0;
    let parens = 0;
    let branchStart = true;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const value = token.value;
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      if (branchStart) {
        if (value !== '.' || token.literal || (next && !['/', '//', '|'].includes(next.value))) {
          throw new Error('每个字段 XPath 分支必须是以 .、./ 或 .// 开头的行内相对路径');
        }
        branchStart = false;
      }
      if (token.literal) continue;
      if (value === '..') throw new Error('字段 XPath 不能通过 .. 离开记录');
      if (value === '::') {
        const axis = prev && prev.value;
        if (!allowedAxes.has(axis)) throw new Error('字段 XPath 不能使用可能离开记录的轴');
      }
      if ((value === '/' || value === '//') && (!prev || prev.literal || !(/^[\p{L}_]/u.test(prev.value) || ['.', '*', ']', ')'].includes(prev.value)) || operatorTokens[i - 1])) {
        throw new Error('字段 XPath 不能包含绝对路径');
      }
      if (next && next.value === '(' && /^[\p{L}_]/u.test(value)) {
        if (value === 'id' || value === 'key' || value === 'document') throw new Error('字段 XPath 不能使用跨记录查找函数');
        if (brackets === 0 && ['comment', 'processing-instruction', 'node'].includes(value)) throw new Error('字段 XPath 只能返回元素、属性或文本节点');
      }
      if (value === '[') brackets++;
      if (value === ']') { brackets--; if (brackets < 0) throw new Error('字段 XPath 的方括号不匹配'); }
      if (value === '(') parens++;
      if (value === ')') { parens--; if (parens < 0) throw new Error('字段 XPath 的括号不匹配'); }
      if (value === '|') {
        if (brackets || parens) throw new Error('字段 XPath 不支持嵌套的 union；请分别写完整的行内相对路径');
        branchStart = true;
      }
    }
    if (brackets || parens || branchStart) throw new Error('字段 XPath 表达式不完整');
    return xpath.trim();
  }

  function validateColumnXPath(xpath) {
    if (typeof xpath !== 'string' || !xpath.trim()) throw new Error('字段 XPath 不能为空');
    const path = xpath.trim();
    // A page XPath is evaluated once against the document and checked by its
    // resulting nodes' record ownership. Relative paths retain the stricter
    // syntax guard: no absolute subexpressions or upward traversal are allowed.
    return path.startsWith('/') ? path : validateFieldXPath(path);
  }

  function extractValue(node) {
    return node.nodeType === 1 ? core.extractText(node) : (node.nodeType === 2 ? node.value : node.nodeValue) || '';
  }

  function fieldNodes(doc, context, xpath) {
    let snapshot;
    try { snapshot = doc.evaluate(xpath, context, null, 7, null); }
    catch (error) { throw new Error('字段 XPath 无效或返回标量；必须返回元素、属性或文本节点集：' + error.message); }
    const matches = [];
    for (let i = 0; i < snapshot.snapshotLength; i++) {
      const node = snapshot.snapshotItem(i);
      if (!core.ownerElement(node)) throw new Error('字段 XPath 只能返回元素、属性或文本节点，不能返回数值、布尔值或其他节点');
      matches.push(node);
    }
    return matches;
  }

  function fieldMatches(doc, row, xpath) {
    const matches = fieldNodes(doc, row, xpath);
    for (const node of matches) {
      const owner = core.ownerElement(node);
      if (owner !== row && !row.contains(owner)) throw new Error('字段 XPath 的结果越过了当前记录，已停止提取');
    }
    return matches;
  }

  function pageFieldMatches(doc, allRows, xpath) {
    const byRow = new Map(allRows.map(row => [row, []]));
    for (const node of fieldNodes(doc, doc, xpath)) {
      let owner = core.ownerElement(node);
      while (owner && !byRow.has(owner)) owner = owner.parentElement;
      if (!owner) throw new Error('全页面字段 XPath 命中了记录集合之外的节点，可能跨列表或模块，已停止提取；请收窄字段 XPath 或确认记录 XPath');
      byRow.get(owner).push(node);
    }
    return byRow;
  }

  function inferField(rows, a, b) {
    checkSamples(a, b);
    const ordered = checkedRows(rows, a.ownerDocument);
    const owners = sample => ordered.filter(row => row === sample || row.contains(sample));
    const ownerA = owners(a), ownerB = owners(b);
    if (ownerA.length !== 1 || ownerB.length !== 1) throw new Error('两个字段样本都必须属于已经确认的记录集合，不能跨列表选择');
    if (ownerA[0] === ownerB[0]) throw new Error('请在两个不同记录中选择同一字段');
    const pathA = pathFrom(ownerA[0], a), pathB = pathFrom(ownerB[0], b);
    if (pathA.length !== pathB.length || pathA.some((el, i) => !sameTag(el, pathB[i]))) throw new Error('字段样本的相对层级或标签不一致，无法可靠推断');
    const warnings = [];
    let xpath = '.';
    for (let i = 0; i < pathA.length; i++) {
      const left = pathA[i], right = pathB[i], shared = commonClasses(left, right);
      if (shared.length) {
        xpath += '/' + tagStep(left) + classPred(shared);
      } else {
        if (i === pathA.length - 1 && left.classList.length && right.classList.length) throw new Error('字段样本没有共同类名，可能选中了不同字段，请重新选择或手动填写');
        if (position(left) !== position(right)) throw new Error('字段位置不同且缺少共同类名，无法可靠推断');
        const leftCount = Array.from(left.parentElement.children).filter(el => sameTag(el, left)).length;
        const rightCount = Array.from(right.parentElement.children).filter(el => sameTag(el, right)).length;
        if (leftCount !== rightCount) throw new Error('样本父级的同标签子元素数量不同，无法安全使用位置推断；请选择有共同类名的字段或手动填写 XPath');
        // Guard every positional step, not just the leaf. If an earlier field
        // or wrapper is absent, a later sibling must not shift into its place.
        xpath += '/self::*[count(' + tagStep(left) + ')=' + leftCount + ']/' + tagStep(left) + '[' + position(left) + ']';
        warnings.push('部分路径缺少共同类名，使用带同标签数量守卫的同标签位置；数量变化时留空，同数量但顺序或语义变化仍需逐行核对');
      }
    }
    validateFieldXPath(xpath);
    const aMatches = fieldMatches(a.ownerDocument, ownerA[0], xpath);
    const bMatches = fieldMatches(a.ownerDocument, ownerB[0], xpath);
    if (!aMatches.includes(a) || !bMatches.includes(b)) throw new Error('推断的字段 XPath 未覆盖两个样本，请手动填写');
    const ambiguous = ordered.reduce((count, row) => count + (fieldMatches(a.ownerDocument, row, xpath).length > 1 ? 1 : 0), 0);
    if (ambiguous) warnings.push('该字段在 ' + ambiguous + ' 条记录中匹配多个元素；歧义单元格将留空，请收窄字段 XPath');
    warnings.push('两点采样不能证明字段语义相同；请检查全部预览');
    return { xpath, warnings: distinct(warnings) };
  }

  function recordInteriorWarnings(pathA, pathB) {
    const rowWarnings = [];
    // Only clearly identifiable inner records justify rejection. Ordinary td/th
    // and div field wrappers may repeat within a perfectly valid table row.
    for (const path of [pathA, pathB]) {
      for (const el of path.slice(1, -1)) {
        const peers = Array.from(el.parentElement.children).filter(peer => peer !== el && sameTag(peer, el) && (!el.classList.length || commonClasses(el, peer).length));
        if (!peers.length || /^(td|th)$/i.test(el.localName)) continue;
        const isRecord = /^(article|li|tr)$/i.test(el.localName) || /^(row|listitem)$/.test(el.getAttribute('role') || '') || Array.from(el.classList).some(token => /^(record|row|card|item|entry|result)$/.test(token));
        if (isRecord) throw new Error('样本之间隔着内部重复记录，可能跨了不同列表或嵌套层级，请重新选择');
        rowWarnings.push('候选记录内部含重复包装层，无法仅凭两个样本判断是否跨列表，请特别确认记录范围');
      }
    }
    return rowWarnings;
  }

  function inferRows(a, b) {
    checkSamples(a, b);
    // A shared outer table must not disguise two different nested table modules.
    const tableA = a.closest('table'), tableB = b.closest('table');
    if (tableA !== tableB) throw new Error('两个样本属于不同表格或嵌套表格，请选择同一列表里的两条记录');
    let common = a.parentElement;
    while (common && !common.contains(b)) common = common.parentElement;
    if (!common || /^(html|body)$/i.test(common.localName)) throw new Error('样本共同祖先过宽，可能来自不同模块，请重新选择');
    if (tableA && common.localName === 'tr') throw new Error('两个样本位于同一表格记录行，请选择不同行的同一字段');
    // Some forums use one tbody per post instead of one shared tbody. The
    // wrapper is not a different list: infer the actual tr records across direct
    // tbody siblings of this same table, never merge an entire tbody into a row.
    if (common.localName === 'table') {
      const rowA = a.closest('tr'), rowB = b.closest('tr');
      const groupA = rowA && rowA.parentElement, groupB = rowB && rowB.parentElement;
      if (rowA && rowB && rowA !== rowB && groupA !== groupB &&
          groupA?.localName === 'tbody' && groupB?.localName === 'tbody' &&
          groupA.parentElement === common && groupB.parentElement === common &&
          rowA.closest('table') === common && rowB.closest('table') === common) {
        const groupClasses = commonClasses(groupA, groupB), rowClasses = commonClasses(rowA, rowB);
        const rowXPath = core.absoluteXPath(common) + '/' + tagStep(groupA) + classPred(groupClasses) + '/' + tagStep(rowA) + classPred(rowClasses);
        const rows = checkedRows(core.evaluateXPath(a.ownerDocument, rowXPath), a.ownerDocument);
        if (!rows.includes(rowA) || !rows.includes(rowB)) throw new Error('记录 XPath 未覆盖两个样本');
        const interiorWarnings = recordInteriorWarnings([rowA, ...pathFrom(rowA, a)], [rowB, ...pathFrom(rowB, b)]);
        const field = inferField(rows, a, b);
        const warnings = [
          '已识别同一表格内多个 tbody 包装层，以每个 tr 作为独立记录，不会把多行合并为一条记录',
          ...interiorWarnings,
          ...field.warnings,
          '请确认记录范围不包含表头、汇总或广告行，再添加其余字段'
        ];
        return { rowXPath, fieldXPath: field.xpath, rows, warnings: distinct(warnings) };
      }
    }
    const pathA = pathFrom(common, a), pathB = pathFrom(common, b);
    if (pathA.length !== pathB.length || pathA.some((el, i) => !sameTag(el, pathB[i]))) throw new Error('样本的层级或标签不一致，无法确定相同层级的记录');
    const rowA = pathA[0], rowB = pathB[0];
    if (rowA === rowB) throw new Error('请选择两个不同记录');
    const shared = commonClasses(rowA, rowB);
    if (rowA.classList.length && rowB.classList.length && !shared.length) throw new Error('候选记录没有共同类名，可能来自不同模块，请重新选择');
    if (/^(html|body|main|nav|ul|ol|table|thead|tbody|tfoot)$/i.test(rowA.localName)) throw new Error('样本位于不同列表或模块中，请选择同一列表里的两条记录');
    const rowWarnings = recordInteriorWarnings(pathA, pathB);
    const rowXPath = core.absoluteXPath(common) + '/' + tagStep(rowA) + classPred(shared);
    const rows = checkedRows(core.evaluateXPath(a.ownerDocument, rowXPath), a.ownerDocument);
    if (!rows.includes(rowA) || !rows.includes(rowB)) throw new Error('记录 XPath 未覆盖两个样本');
    const field = inferField(rows, a, b);
    const warnings = rowWarnings.concat(field.warnings);
    if (!shared.length) warnings.unshift('记录没有共同类名，仅按同层标签匹配，可能包含广告或其他模块，请确认记录范围');
    if (pathA.length === 1) warnings.unshift('样本直接相邻，请确认每个匹配元素确实是一条完整记录');
    warnings.push('请先确认记录 XPath，再添加其余字段');
    return { rowXPath, fieldXPath: field.xpath, rows, warnings: distinct(warnings) };
  }

  function evaluateTable(doc, rowXPath, columns, visibleOnly = true) {
    if (!doc || doc.nodeType !== 9 || typeof doc.evaluate !== 'function') throw new Error('需要支持 XPath 的主文档');
    if (typeof rowXPath !== 'string' || !rowXPath.trim()) throw new Error('记录 XPath 不能为空');
    if (!Array.isArray(columns)) throw new Error('字段配置必须是数组');
    const paths = columns.map(column => {
      if (!column || typeof column.name !== 'string') throw new Error('每个字段都需要字符串名称');
      return validateColumnXPath(column.xpath);
    });
    let allRows;
    try { allRows = checkedRows(core.evaluateXPath(doc, rowXPath), doc); }
    catch (error) { throw new Error('记录 XPath 无效：' + error.message); }
    // Associate every page-level match with the full confirmed record set
    // before visibility filtering. A hidden record is valid ownership, but a
    // hidden node outside the record set must never be silently discarded.
    const pageMatches = new Map();
    for (const xpath of paths) {
      if (xpath.startsWith('/') && !pageMatches.has(xpath)) pageMatches.set(xpath, pageFieldMatches(doc, allRows, xpath));
    }
    const rowElements = visibleOnly ? allRows.filter(core.isVisible) : allRows;
    // Validate malformed/scalar selectors even when no visible records exist.
    if (!rowElements.length && doc.documentElement) for (const xpath of paths) {
      if (!pageMatches.has(xpath)) fieldMatches(doc, doc.documentElement, xpath);
    }
    let ambiguousCount = 0;
    let missingCount = 0;
    const rows = rowElements.map(element => ({
      element,
      cells: paths.map(xpath => {
        const found = pageMatches.has(xpath) ? pageMatches.get(xpath).get(element) : fieldMatches(doc, element, xpath);
        const matches = visibleOnly ? found.filter(core.isValueVisible) : found;
        if (matches.length > 1) { ambiguousCount++; return { value: '', status: 'ambiguous', matches }; }
        if (!matches.length) { missingCount++; return { value: '', status: 'missing', matches }; }
        return { value: extractValue(matches[0]), status: 'ok', matches };
      }),
    }));
    const warnings = [];
    if (pageMatches.size) warnings.push('全页面字段 XPath 已按节点所属记录归属到行，不按匹配顺序拼接；缺值留空，同一行多命中视为歧义');
    if (!rowElements.length) warnings.push('没有匹配的' + (visibleOnly ? '可见' : '') + '记录');
    if (missingCount) warnings.push(missingCount + ' 个字段单元格缺失，已保留为空，不会从其他记录补值');
    if (ambiguousCount) warnings.push(ambiguousCount + ' 个字段单元格匹配多个元素，已留空，请收窄 XPath');
    if (!visibleOnly) warnings.push('已包含隐藏匹配；元素文本忽略隐藏后代，显式属性和文本节点保留原始值');
    return { rowElements, rows, warnings, ambiguousCount };
  }

  function toTableCSV(columns, rows) {
    if (!Array.isArray(columns) || !Array.isArray(rows)) throw new Error('CSV 需要字段配置数组和 evaluateTable 返回的 rows 数组');
    const quote = value => {
      const string = value == null ? '' : String(value);
      return '"' + (/^[\s\u0000-\u001f]*[=+\-@]/.test(string) ? "'" + string : string).replace(/"/g, '""') + '"';
    };
    const lines = [columns.map(column => {
      if (!column || typeof column.name !== 'string') throw new Error('CSV 字段名称必须是字符串');
      return quote(column.name);
    }).join(',')];
    for (const row of rows) {
      if (!row || !Array.isArray(row.cells) || row.cells.length !== columns.length) throw new Error('CSV 每条记录的单元格数量必须与字段数量一致');
      lines.push(row.cells.map(cell => {
        if (!cell || !['ok', 'missing', 'ambiguous'].includes(cell.status)) throw new Error('CSV 单元格必须含有效 status');
        return quote(cell.status === 'ok' ? cell.value : '');
      }).join(','));
    }
    return '\uFEFF' + lines.join('\r\n');
  }

  const api = { inferRows, inferField, evaluateTable, toTableCSV };
  root.XPathBatchTable = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
