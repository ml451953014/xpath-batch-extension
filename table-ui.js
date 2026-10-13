(function (root) {
  'use strict';

  function mount({container, host, onUpdate = function () {}}) {
    const T = root.XPathBatchTable;
    if (!T || !container || !host) throw new Error('多字段提取组件尚未准备好');
    const doc = container.ownerDocument, win = doc.defaultView;
    let active = false, disposed = false, picking = false, hover = null;
    let samples = [], rowXPath = '', rowElements = [], visibleOnly = true;
    let nextColumnId = 1;
    const makeColumn = () => {
      const number = nextColumnId++;
      return {id: 'field-' + number, defaultName: '字段 ' + number, name: '字段 ' + number, xpath: '', draftXPath: '', error: ''};
    };
    let columns = [makeColumn()], selectedId = columns[0].id;
    // Only committed rules appear in a snapshot. Stable IDs, rather than UI
    // indices, join preview cells to columns when unfinished columns are added.
    let snapshot = null, dirty = false, validationTimer = 0, copyRequest = 0;
    let inferenceWarnings = [], rowError = '';
    const listeners = [], downloads = new Map();
    const ui = doc.createElement('div');
    ui.className = 'xpath-table-ui';
    container.append(ui);
    function node(tag, text, parent = ui, className) {
      const el = doc.createElement(tag);
      if (text !== undefined) el.textContent = text;
      if (className) el.className = className;
      parent.append(el);
      return el;
    }
    function button(text, parent, className) {
      const el = node('button', text, parent, className);
      el.type = 'button';
      el.setAttribute('aria-label', text);
      return el;
    }
    const css = node('style');
    css.textContent = '.xpath-table-ui .table-wrap{overflow:auto;max-height:260px;border:1px solid #d7e0eb;border-radius:6px}.xpath-table-ui table{border-collapse:collapse;width:100%;font:12px/1.45 system-ui,sans-serif}.xpath-table-ui th,.xpath-table-ui td{border-bottom:1px solid #d7e0eb;border-right:1px solid #e6edf5;padding:6px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere;min-width:64px;max-width:250px}.xpath-table-ui th{background:#edf3ff;position:sticky;top:0}.xpath-table-ui td[data-status="ambiguous"]{color:#8a3c04;background:#fff6e6}.xpath-table-ui [data-status="pending"]{color:#68768b}.xpath-table-ui .field-name{width:100%;padding:6px;border:1px solid #b8c7dc;border-radius:6px;background:white;color:#182238}.xpath-table-ui .table-copy{width:100%;min-height:100px}.xpath-table-ui details{margin:10px 0;padding:8px;border:1px solid #d7e0eb;border-radius:6px}.xpath-table-ui summary{cursor:pointer;font-weight:600}.xpath-table-ui [hidden]{display:none!important}';
    node('p', '首列选两个不同记录中的同一字段，自动生成表格。已有记录范围后，新列可直接填写字段 XPath；已完成列会保留。', ui, 'muted');
    const fieldLabel = node('label', '字段列表');
    const fieldSelect = node('select');
    fieldSelect.setAttribute('aria-label', '多字段列表');
    fieldLabel.htmlFor = fieldSelect.id = 'xpath-table-field-select';
    const nameLabel = node('label', '当前字段名称');
    const nameInput = node('input', undefined, ui, 'field-name');
    nameInput.type = 'text';
    nameInput.setAttribute('aria-label', '当前字段名称');
    nameLabel.htmlFor = nameInput.id = 'xpath-table-field-name';
    const fieldInputLabel = node('label', '当前字段 XPath（文字或属性）');
    const fieldInput = node('textarea');
    // Keep the established accessible selector for existing integrations.
    fieldInput.setAttribute('aria-label', '当前字段相对 XPath');
    fieldInput.spellcheck = false;
    fieldInput.rows = 2;
    fieldInput.placeholder = '例如 ./@href 或 ./img/@src';
    fieldInputLabel.htmlFor = fieldInput.id = 'xpath-table-field-expression';
    const fieldHelp = node('p', '以每条记录为起点，可填 ./@href、./img/@src、./@id、./@class、./a/text()；也可粘贴页面 XPath，例如 //*[@id="dd-grid"]/a/@href，按所属记录对齐。支持元素、属性和文本节点，不支持 string()/count() 等标量。编辑只是草稿，应用成功后才替换当前列。', ui, 'muted');
    fieldHelp.id = 'xpath-table-field-help';
    fieldInput.setAttribute('aria-describedby', fieldHelp.id);
    const applyField = button('应用字段规则', ui);
    const actions = node('div', undefined, ui, 'row');
    const add = button('添加字段并拾取', actions);
    const remove = button('删除当前字段', actions);
    const pick = button('开始当前列拾取', actions, 'primary');
    const status = node('p', '请开始当前列拾取，点击两个不同记录中的同一字段', ui, 'status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-label', '多字段状态');
    const samplePaths = node('div', '', ui, 'sample-path');
    const rowCount = node('p', '尚未建立记录范围');
    rowCount.setAttribute('aria-label', '多字段记录数量');
    const count = node('p', '尚无表格结果');
    const warning = node('p', '', ui, 'warn');
    warning.hidden = true;
    const draftNote = node('p', '', ui, 'muted');
    draftNote.setAttribute('aria-label', '多字段草稿状态');
    node('label', '表格预览（缺值保留空单元格）');
    const preview = node('div', undefined, ui, 'table-wrap');
    preview.setAttribute('aria-label', '多字段表格预览');
    const table = node('table', undefined, preview);
    const exportReason = node('p', '', ui, 'muted');
    exportReason.setAttribute('aria-label', '多字段导出状态');
    const exportRow = node('div', undefined, ui, 'row');
    const copy = button('复制表格', exportRow);
    const csv = button('导出表格 CSV', exportRow);
    const fallback = node('textarea', undefined, ui, 'table-copy');
    fallback.readOnly = true;
    fallback.hidden = true;
    fallback.setAttribute('aria-label', '可复制的表格 TSV');

    const advanced = node('details');
    advanced.setAttribute('aria-label', '多字段高级设置');
    node('summary', '高级设置', advanced);
    advanced.append(samplePaths);
    const rowLabel = node('label', '记录行 XPath（只接受元素，更改影响整个表格）', advanced);
    const rowInput = node('textarea', undefined, advanced);
    rowInput.setAttribute('aria-label', '记录行 XPath');
    rowInput.spellcheck = false;
    rowLabel.htmlFor = rowInput.id = 'xpath-table-row-expression';
    const applyRows = button('应用记录范围', advanced);
    node('p', '记录范围填写每条记录的容器元素，不能填 /@href 等字段值。例如记录填 //*[@id="dd-grid"]/a，字段填 ./@href（请按当前页面修改）。应用成功后所有已完成列一起更新；失败保留原记录范围和原表格。', advanced, 'muted');
    const refresh = button('刷新数据', advanced);
    const visibleLabel = node('label', undefined, advanced, 'inline');
    const visible = node('input', undefined, visibleLabel);
    visible.type = 'checkbox';
    visible.checked = visibleOnly;
    visible.setAttribute('aria-label', '多字段仅提取可见记录');
    visibleLabel.append(doc.createTextNode('仅提取可见记录（隐藏字段按缺值处理）'));
    const numberLabel = node('label', undefined, advanced, 'inline');
    const numbers = node('input', undefined, numberLabel);
    numbers.type = 'checkbox';
    numbers.checked = false;
    numbers.setAttribute('aria-label', '多字段预览显示序号');
    numberLabel.append(doc.createTextNode('预览显示序号（复制和 CSV 不含序号）'));
    const highlightLabel = node('label', undefined, advanced, 'inline');
    const highlight = node('input', undefined, highlightLabel);
    highlight.type = 'checkbox';
    highlight.checked = true;
    highlight.setAttribute('aria-label', '高亮表格字段');
    highlightLabel.append(doc.createTextNode('高亮表格字段'));
    node('p', '仅当前主文档 DOM，不含 iframe / Shadow DOM；不自动滚动或翻页。实际页面内容变化后请刷新数据。Esc 退出拾取。', advanced, 'muted');

    function notify() { if (!disposed) onUpdate(); }
    function say(text) { status.textContent = text; }
    function listen(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      listeners.push(() => target.removeEventListener(type, fn, options));
    }
    function currentColumn() { return columns.find(col => col.id === selectedId); }
    function columnName(col) { return col.name.trim() || col.defaultName; }
    function configuredColumns() { return columns.filter(col => !!col.xpath); }
    function exportColumns() {
      return (snapshot?.columnIds || []).map(id => columns.find(col => col.id === id))
        .filter(Boolean).map(col => ({id: col.id, name: columnName(col), xpath: col.xpath}));
    }
    function invalidateCopy() {
      copyRequest++;
      fallback.hidden = true;
      fallback.value = '';
    }
    function renderSamples() {
      samplePaths.replaceChildren();
      samples.forEach((el, i) => node('p', (i + 1) + '. ' + (root.XPathBatchCore?.absoluteXPath(el) || el.localName), samplePaths));
    }
    function stop(clearSamples = true) {
      picking = false;
      hover = null;
      if (clearSamples) { samples = []; renderSamples(); }
      pick.textContent = '开始当前列拾取';
      pick.setAttribute('aria-pressed', 'false');
    }
    function exportBlocker() {
      if (dirty) return '页面匹配内容已变化，请在高级设置中刷新数据后导出';
      if (!rowXPath || !snapshot || !snapshot.columnIds.length) return '尚无已完成列，请拾取字段或应用字段规则';
      if (snapshot.ambiguousCount) return '已完成列存在多命中歧义，请修正字段规则后导出';
      if (!snapshot.rows.length) return '没有可导出的记录';
      return '';
    }
    function updateButtons() {
      const blocked = exportBlocker(), unfinished = columns.filter(col => !col.xpath).length;
      copy.disabled = csv.disabled = !!blocked;
      exportReason.textContent = (blocked || '可复制或导出 ' + configuredColumns().length + ' 个已完成列') + '；未完成 ' + unfinished + ' 列不参与导出';
      remove.disabled = false;
      fieldSelect.disabled = columns.length < 2;
      refresh.disabled = !rowXPath;
      applyField.disabled = !fieldInput.value.trim();
      applyRows.disabled = !rowInput.value.trim();
      const pendingFields = columns.filter(col => col.draftXPath.trim() !== col.xpath).length;
      const rowPending = rowInput.value.trim() !== rowXPath;
      draftNote.textContent = [rowPending ? '记录范围草稿未应用' : '', pendingFields ? pendingFields + ' 列字段草稿未应用' : '',
        rowPending || pendingFields ? '导出仍使用已完成列的原规则' : ''].filter(Boolean).join('；');
      draftNote.hidden = !draftNote.textContent;
    }
    function renderFields() {
      fieldSelect.replaceChildren();
      columns.forEach((col, i) => {
        const option = node('option', (i + 1) + '. ' + columnName(col) + (!col.xpath ? '（未配置）' : ''), fieldSelect);
        option.value = col.id;
      });
      fieldSelect.value = selectedId;
      nameInput.value = currentColumn().name;
      fieldInput.value = currentColumn().draftXPath;
      updateButtons();
    }
    function renderWarnings() {
      const messages = [...inferenceWarnings, ...(snapshot?.warnings || []), rowError, ...columns.map(col => col.error)];
      if (snapshot && snapshot.rows.length * snapshot.columnIds.length > 1000) messages.push('高亮仅显示前 1000 个字段，表格和导出保留全部记录');
      warning.textContent = Array.from(new Set(messages.filter(Boolean))).join('\n');
      warning.hidden = !warning.textContent;
    }
    function renderPreview() {
      table.replaceChildren();
      const head = node('tr', undefined, node('thead', undefined, table));
      if (numbers.checked) node('th', '序号', head).scope = 'col';
      columns.forEach(col => {
        const th = node('th', columnName(col) + (!col.xpath ? '（未完成）' : ''), head);
        th.scope = 'col';
        th.dataset.columnId = col.id;
      });
      const body = node('tbody', undefined, table);
      const indices = new Map((snapshot?.columnIds || []).map((id, index) => [id, index]));
      (snapshot?.rows || []).forEach((row, i) => {
        const tr = node('tr', undefined, body);
        if (numbers.checked) node('td', String(i + 1), tr);
        columns.forEach(col => {
          const index = indices.get(col.id), cell = index === undefined ? null : row.cells[index];
          const value = !cell ? '待配置' : cell.status === 'ambiguous' ? '歧义(' + cell.matches.length + ')' : cell.status === 'missing' ? '' : cell.value;
          const td = node('td', value, tr);
          td.dataset.status = cell ? cell.status : 'pending';
          td.dataset.columnId = col.id;
          if (!cell) td.title = col.error || '此列尚未完成，不参与复制和导出';
          else if (cell.status === 'missing') td.title = '此记录缺少该字段，导出为空单元格';
          else if (cell.status === 'ambiguous') td.title = '匹配了多个字段，请修正规则；不会自动选择第一个';
        });
      });
      rowCount.textContent = rowXPath ? '当前记录范围：' + rowElements.length + ' 行' : '尚未建立记录范围';
      if (dirty) count.textContent = '表格结果已过期，请刷新数据；原预览仅供参考';
      else if (!snapshot) count.textContent = '尚无表格结果';
      else {
        const missing = snapshot.rows.reduce((sum, row) => sum + row.cells.filter(cell => cell.status === 'missing').length, 0);
        count.textContent = snapshot.rows.length + ' 条记录 × ' + snapshot.columnIds.length + ' 个已完成列；缺值 ' + missing + ' 格；歧义 ' + snapshot.ambiguousCount + ' 格';
      }
    }
    function render() { renderFields(); renderPreview(); renderWarnings(); notify(); }
    function checkRows(result) {
      if (result.rowElements.some(el => el === host || el.contains(host) || el.getRootNode() !== doc)) throw new Error('记录行不能包含提取面板或来自主文档之外');
      return result;
    }
    function evaluate(xpath = rowXPath, cols = configuredColumns(), onlyVisible = visibleOnly) {
      const result = checkRows(T.evaluateTable(doc, xpath, cols.map(col => ({name: columnName(col), xpath: col.xpath})), onlyVisible));
      return {...result, columnIds: cols.map(col => col.id)};
    }
    function sameNodes(a, b) { return a.length === b.length && a.every((el, i) => el === b[i]); }
    function sameSnapshot(a, b) {
      if (!sameNodes(a.columnIds, b.columnIds) || !sameNodes(a.rowElements, b.rowElements) || a.rows.length !== b.rows.length) return false;
      return a.rows.every((row, i) => {
        const other = b.rows[i];
        return row.element === other.element && row.cells.length === other.cells.length && row.cells.every((cell, j) => {
          const next = other.cells[j];
          return cell.status === next.status && cell.value === next.value && sameNodes(cell.matches, next.matches);
        });
      });
    }
    function markDirty(message) {
      invalidateCopy();
      dirty = true;
      stop();
      say(message || '记录、字段命中、可见性或文字已变化，请在高级设置中刷新数据');
      renderPreview();
      updateButtons();
      notify();
    }
    function validateSnapshot() {
      if (disposed || dirty) return false;
      if (!rowXPath || !snapshot) return true;
      try { if (sameSnapshot(snapshot, evaluate())) return true; }
      catch (_) { /* A failed re-evaluation makes the old snapshot unsafe. */ }
      markDirty();
      return false;
    }
    function acceptSnapshot(result) {
      invalidateCopy();
      snapshot = result;
      rowElements = result.rowElements.slice();
      dirty = false;
      if (validationTimer) win.clearTimeout(validationTimer);
      validationTimer = 0;
    }
    function normalizedWarnings(warnings) {
      return (warnings || []).map(text => text.replace('请先确认记录 XPath，再添加其余字段', '请在预览中核对记录范围和字段内容'));
    }
    function commitField(xpath, warnings = [], inferredRows) {
      // Re-check the previous committed rules BEFORE evaluating a new rule: a
      // new column must never silently acknowledge changed existing DOM values.
      if (!validateSnapshot()) { say('页面内容已变化，请先刷新数据，再应用字段规则'); updateButtons(); return false; }
      const col = currentColumn(), path = xpath.trim();
      col.draftXPath = xpath;
      const candidateRowXPath = inferredRows || rowXPath;
      if (!candidateRowXPath) throw new Error('请先在两条记录卡片中拾取同一字段建立记录，或在高级设置中填写并应用只返回元素的记录范围；链接属于字段值，不能填在记录范围');
      const candidates = columns.map(item => item.id === col.id ? {...item, xpath: path} : item).filter(item => !!item.xpath);
      if (!path) throw new Error('字段 XPath 不能为空');
      const result = evaluate(candidateRowXPath, candidates);
      if (!result.rowElements.length) throw new Error('记录范围没有匹配到记录，未应用此规则');
      const index = result.columnIds.indexOf(col.id);
      const ambiguous = result.rows.filter(row => row.cells[index].status === 'ambiguous').length;
      if (ambiguous) throw new Error('当前字段在 ' + ambiguous + ' 条记录中存在多命中歧义，未应用；请收窄字段 XPath');
      col.xpath = path;
      col.draftXPath = path;
      col.error = '';
      if (inferredRows) { rowXPath = inferredRows; rowInput.value = rowXPath; rowError = ''; }
      inferenceWarnings = normalizedWarnings(warnings);
      acceptSnapshot(result);
      say('已完成字段“' + columnName(col) + '”，请核对表格后继续添加字段或导出');
      render();
      return true;
    }
    function applyFieldRule() {
      invalidateCopy();
      stop();
      try { commitField(currentColumn().draftXPath); }
      catch (error) {
        currentColumn().error = error.message;
        say('字段规则未应用：' + error.message + (currentColumn().xpath ? '；已保留原字段规则和列值' : configuredColumns().length ? '；其他已完成列仍可导出' : '；字段草稿已保留'));
        render();
      }
    }
    function applyRecordRange() {
      invalidateCopy();
      stop();
      try {
        const xpath = rowInput.value.trim();
        const result = evaluate(xpath);
        if (!result.rowElements.length) throw new Error('记录 XPath 没有匹配到记录');
        if (result.ambiguousCount) throw new Error('新记录范围内存在多命中歧义，请先修正字段规则');
        rowXPath = xpath;
        rowInput.value = xpath;
        rowError = '';
        inferenceWarnings = [];
        acceptSnapshot(result);
        say('已应用整个表格的记录范围，保留所有字段配置；请核对预览');
      } catch (error) {
        rowError = error.message;
        if (/只(?:返回|接受)元素|不能返回文本、属性/.test(rowError)) {
          rowError += '；链接属于字段值，请在“当前字段 XPath”填写。示例：记录 //*[@id="dd-grid"]/a，字段 ./@href（请按当前页面修改）';
        }
        validateSnapshot();
        say('记录范围未应用：' + rowError + '；原记录范围和字段配置已保留');
      }
      render();
    }
    function refreshData() {
      invalidateCopy();
      stop();
      if (!rowXPath) return;
      try {
        const result = evaluate();
        acceptSnapshot(result);
        say(result.ambiguousCount ? '已刷新数据，但已完成列存在歧义，请修正字段规则后导出' : '已刷新数据；未应用的草稿未改动，请核对表格后导出');
      } catch (error) {
        rowError = error.message;
        markDirty('刷新数据失败：' + error.message + '；导出已禁用');
      }
      render();
    }
    function startPick() {
      invalidateCopy();
      if (picking) { stop(); say('已退出拾取，已完成列及其规则保持不变'); updateButtons(); notify(); return; }
      if (!active || disposed) return;
      if (!validateSnapshot()) { say('页面内容已变化，请先在高级设置中刷新数据，再拾取字段'); return; }
      samples = [];
      hover = null;
      currentColumn().error = '';
      renderSamples();
      picking = true;
      pick.textContent = '退出当前列拾取';
      pick.setAttribute('aria-pressed', 'true');
      say('拾取中：点击第一个记录的当前字段，再点击另一个记录的同一字段；原表格会保留');
      renderWarnings();
      updateButtons();
      notify();
    }
    function inUI(event) { return event.composedPath().includes(host); }
    function target(event) { const el = event.composedPath()[0]; return el?.nodeType === 1 ? el : null; }
    function containingRecord(el) {
      const found = rowElements.filter(row => row === el || row.contains(el));
      return found.length === 1 ? found[0] : null;
    }
    function onMove(event) {
      if (!active || !picking || dirty) return;
      const el = inUI(event) ? null : target(event);
      hover = el && el.getRootNode() === doc && !el.shadowRoot ? el : null;
      notify();
    }
    function onClick(event) {
      if (!active || !picking || inUI(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      invalidateCopy();
      const el = target(event);
      if (!el || el.getRootNode() !== doc || el.shadowRoot) { say('暂不支持 Shadow DOM 内部字段，请选主文档的普通 DOM 元素'); return; }
      if (!validateSnapshot()) return;
      if (samples.some(sample => !sample.isConnected || sample.getRootNode() !== doc)) {
        samples = [];
        renderSamples();
        say('原样本已失效，请重新选择两个不同记录的同一字段');
      }
      if (samples.includes(el)) { say('已选择此元素，请点击另一个记录中的同一字段'); return; }
      if (rowXPath) {
        const record = containingRecord(el);
        if (!record) { say('此元素不在当前记录范围中，请选择记录内的字段'); return; }
        if (samples.length && record === containingRecord(samples[0])) { say('两个样本必须来自不同记录，请点击另一个记录的同一字段'); return; }
      }
      if (samples.length && samples[0].closest('table') !== el.closest('table')) { say('两个样本属于不同表格，请选择同一表格内的两个记录'); return; }
      samples.push(el);
      renderSamples();
      notify();
      if (samples.length < 2) { say('已选第一个字段，请点击另一个记录的同一字段'); return; }
      const picked = samples.slice();
      stop();
      try {
        if (!rowXPath) {
          const inferred = T.inferRows(picked[0], picked[1]);
          rowInput.value = inferred.rowXPath;
          currentColumn().draftXPath = inferred.fieldXPath;
          commitField(inferred.fieldXPath, inferred.warnings, inferred.rowXPath);
        } else {
          const inferred = T.inferField(rowElements, picked[0], picked[1]);
          currentColumn().draftXPath = inferred.xpath;
          commitField(inferred.xpath, inferred.warnings);
        }
      } catch (error) {
        currentColumn().error = error.message;
        say('无法可靠应用当前字段：' + error.message + '；已完成列保持不变，请重新采样或修改上方字段 XPath 草稿');
        render();
      }
      updateButtons();
      notify();
    }
    function blockPointer(event) {
      if (!active || !picking || inUI(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function scheduleValidation() {
      if (disposed) return;
      notify();
      if (dirty || !snapshot || validationTimer) return;
      validationTimer = win.setTimeout(() => { validationTimer = 0; validateSnapshot(); notify(); }, 120);
    }
    function sanitizeTSV(value) {
      let text = String(value ?? '');
      if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
      return /[\t\r\n"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }
    function toTSV() {
      return [exportColumns().map(col => col.name), ...snapshot.rows.map(row => row.cells.map(cell => cell.status === 'missing' ? '' : cell.value))]
        .map(row => row.map(sanitizeTSV).join('\t')).join('\n');
    }
    function canExportNow() {
      if (!validateSnapshot() || exportBlocker()) { updateButtons(); return false; }
      return true;
    }
    function configuration() { return JSON.stringify([rowXPath, visibleOnly, columns.map(col => [col.id, col.name, col.xpath])]); }
    async function copyTable() {
      if (!canExportNow()) return;
      const value = toTSV(), request = ++copyRequest, copiedSnapshot = snapshot, copiedConfiguration = configuration();
      // The clipboard write itself cannot be recalled. Its late completion must
      // never restore obsolete success or fallback text after any newer action.
      const stillCurrent = () => !disposed && active && request === copyRequest && !dirty && snapshot === copiedSnapshot &&
        configuration() === copiedConfiguration && validateSnapshot() && !exportBlocker();
      fallback.hidden = true;
      fallback.value = '';
      try {
        await win.navigator.clipboard.writeText(value);
        if (stillCurrent()) say('已复制表格 TSV（仅已完成列，首行为列名，缺值保留空单元格）');
      } catch (_) {
        if (!stillCurrent()) return;
        fallback.value = value;
        fallback.hidden = false;
        fallback.focus();
        fallback.select();
        say('剪贴板不可用，请选中下方 TSV 文本后按 Ctrl/Cmd+C');
      }
    }
    function downloadCSV() {
      invalidateCopy();
      if (!canExportNow()) return;
      try {
        const text = T.toTableCSV(exportColumns(), snapshot.rows);
        const blob = new win.Blob([text], {type: 'text/csv;charset=utf-8'});
        const url = win.URL.createObjectURL(blob);
        const anchor = node('a');
        anchor.href = url;
        anchor.download = 'xpath-table-' + new Date().toISOString().slice(0, 10) + '.csv';
        anchor.click();
        anchor.remove();
        const timer = win.setTimeout(() => { win.URL.revokeObjectURL(url); downloads.delete(url); }, 30000);
        downloads.set(url, timer);
        say('已请求下载表格 CSV（仅已完成列）；如被浏览器拦截，请使用“复制表格”');
      } catch (error) { say('CSV 下载失败：' + error.message + '；请使用“复制表格”'); }
    }
    function deleteColumn() {
      invalidateCopy();
      stop();
      validateSnapshot();
      const index = columns.findIndex(col => col.id === selectedId), removedId = selectedId;
      columns.splice(index, 1);
      if (!columns.length) {
        columns = [makeColumn()];
        rowXPath = '';
        rowInput.value = '';
        rowElements = [];
        snapshot = null;
        dirty = false;
        rowError = '';
        inferenceWarnings = [];
        if (validationTimer) win.clearTimeout(validationTimer);
        validationTimer = 0;
      } else if (snapshot) {
        const kept = snapshot.columnIds.map((id, i) => ({id, i})).filter(item => item.id !== removedId);
        const rows = snapshot.rows.map(row => ({...row, cells: kept.map(item => row.cells[item.i])}));
        snapshot = {...snapshot, columnIds: kept.map(item => item.id), rows,
          ambiguousCount: rows.reduce((sum, row) => sum + row.cells.filter(cell => cell.status === 'ambiguous').length, 0), warnings: []};
      }
      selectedId = columns[Math.min(index, columns.length - 1)].id;
      say(rowXPath ? '已删除当前字段，其他字段和记录范围已保留' : '已删除最后一个字段，请重新拾取字段建立表格');
      render();
    }
    function highlightEntries() {
      if (!active || disposed || dirty || !snapshot || !highlight.checked) return [];
      const owner = value => root.XPathBatchCore?.ownerElement ? root.XPathBatchCore.ownerElement(value) : value.nodeType === 1 ? value : value.ownerElement || value.parentElement;
      const entries = new Map();
      snapshot.rows.forEach(row => row.cells.forEach((cell, index) => cell.matches.forEach(match => {
        const element = owner(match);
        if (!element?.isConnected || element.nodeType !== 1) return;
        const current = snapshot.columnIds[index] === selectedId;
        if (entries.has(element)) entries.get(element).current ||= current;
        else entries.set(element, {element, current});
      })));
      return Array.from(entries.values()).slice(0, 1000);
    }

    listen(pick, 'click', startPick);
    listen(add, 'click', () => {
      invalidateCopy();
      stop();
      const emptyPlaceholder = !rowXPath && columns.length === 1 && !columns[0].xpath && !columns[0].draftXPath.trim();
      const col = emptyPlaceholder ? columns[0] : makeColumn();
      if (!emptyPlaceholder) columns.push(col);
      selectedId = col.id;
      render();
      startPick();
    });
    listen(remove, 'click', deleteColumn);
    listen(applyField, 'click', applyFieldRule);
    listen(applyRows, 'click', applyRecordRange);
    listen(refresh, 'click', refreshData);
    listen(fieldSelect, 'change', () => {
      if (!columns.some(col => col.id === fieldSelect.value)) return;
      invalidateCopy();
      stop();
      selectedId = fieldSelect.value;
      say('已选择字段“' + columnName(currentColumn()) + '”，已完成列保持不变');
      render();
    });
    listen(nameInput, 'input', () => {
      invalidateCopy();
      currentColumn().name = nameInput.value;
      renderFields();
      renderPreview();
      notify();
    });
    listen(fieldInput, 'input', () => {
      invalidateCopy();
      stop();
      currentColumn().draftXPath = fieldInput.value;
      currentColumn().error = '';
      say('字段草稿未应用；导出仍使用已完成列的原规则');
      updateButtons();
      renderWarnings();
      notify();
    });
    listen(rowInput, 'input', () => {
      invalidateCopy();
      stop();
      rowError = '';
      say('记录范围草稿未应用；导出仍使用原记录范围和已完成列');
      updateButtons();
      renderWarnings();
      notify();
    });
    listen(visible, 'change', () => {
      invalidateCopy();
      stop();
      if (!rowXPath) { visibleOnly = visible.checked; updateButtons(); return; }
      if (!validateSnapshot()) { visible.checked = visibleOnly; updateButtons(); return; }
      try {
        const result = evaluate(rowXPath, configuredColumns(), visible.checked);
        if (result.ambiguousCount) throw new Error('切换可见过滤后存在多命中歧义，原过滤设置已保留');
        visibleOnly = visible.checked;
        acceptSnapshot(result);
        say('已更新可见记录过滤，请核对预览');
      } catch (error) { visible.checked = visibleOnly; say(error.message); }
      render();
    });
    listen(highlight, 'change', notify);
    listen(numbers, 'change', renderPreview);
    listen(copy, 'click', copyTable);
    listen(csv, 'click', downloadCSV);
    listen(doc, 'pointermove', onMove, true);
    listen(doc, 'click', onClick, true);
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick'].forEach(type => listen(doc, type, blockPointer, true));
    listen(doc, 'keydown', event => {
      if (!active || !picking || event.key !== 'Escape') return;
      event.preventDefault();
      invalidateCopy();
      stop();
      say('已退出拾取，已完成列及其规则保持不变');
      updateButtons();
      notify();
    }, true);
    render();

    return {
      setActive(value) {
        if (disposed) return;
        active = !!value;
        if (!active) { invalidateCopy(); stop(); updateButtons(); }
        else validateSnapshot();
        notify();
      },
      getHighlights() { return highlightEntries().map(entry => entry.element); },
      getHighlightEntries: highlightEntries,
      getSamples() { return active && !disposed && !dirty ? samples.filter(el => el.isConnected) : []; },
      getHover() { return active && picking && !disposed && !dirty && hover?.isConnected ? hover : null; },
      onMutation(records) {
        if (disposed || !records.length || records.every(record => record.target === host || host.contains(record.target))) return;
        scheduleValidation();
      },
      onResize: scheduleValidation,
      dispose() {
        if (disposed) return;
        disposed = true;
        invalidateCopy();
        active = picking = false;
        hover = null;
        samples = [];
        snapshot = null;
        if (validationTimer) win.clearTimeout(validationTimer);
        validationTimer = 0;
        downloads.forEach((timer, url) => { win.clearTimeout(timer); win.URL.revokeObjectURL(url); });
        downloads.clear();
        listeners.forEach(removeListener => removeListener());
        ui.remove();
      }
    };
  }
  root.XPathBatchTableUI = {mount};
})(globalThis);
