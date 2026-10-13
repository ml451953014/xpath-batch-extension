/* Pure DOM/XPath helpers. No network, storage, models, or page-script execution. */
(function (root) {
  'use strict';
  function xpathLiteral(value) {
    const s = String(value);
    if (!s.includes("'")) return "'" + s + "'";
    if (!s.includes('"')) return '"' + s + '"';
    return 'concat(' + s.split("'").map(p => "'" + p + "'").join(',"\'",') + ')';
  }
  function tagStep(el) {
    return el.namespaceURI === 'http://www.w3.org/1999/xhtml' ? el.localName : '*[local-name()=' + xpathLiteral(el.localName) + ' and namespace-uri()=' + xpathLiteral(el.namespaceURI || '') + ']';
  }
  function sameTag(a,b) { return a.localName === b.localName && a.namespaceURI === b.namespaceURI; }
  function index(el) { return Array.from(el.parentElement?.children || []).filter(e => sameTag(e, el)).indexOf(el) + 1; }
  function step(el) { return tagStep(el) + '[' + (index(el) || 1) + ']'; }
  function absoluteXPath(el) {
    if (!el || el.nodeType !== 1 || el.getRootNode() !== el.ownerDocument) throw new Error('仅支持主文档中的普通 DOM 元素，不支持 Shadow DOM');
    const parts=[]; for(let e=el;e;e=e.parentElement) parts.unshift(step(e));
    return '/' + parts.join('/');
  }
  function evaluateXPath(doc, xpath) {
    const result=doc.evaluate(xpath,doc,null,7,null), out=[];
    for(let i=0;i<result.snapshotLength;i++) { const n=result.snapshotItem(i); if(n.nodeType===1) out.push(n); else throw new Error('XPath 必须只返回元素，不能返回文本、属性或数值'); }
    return out;
  }
  function ownerElement(node) {
    if(!node)return null;
    if(node.nodeType===1)return node;
    if(node.nodeType===2)return node.ownerElement;
    if(node.nodeType===3||node.nodeType===4)return node.parentElement;
    return null;
  }
  function isValueVisible(node) {
    const owner=ownerElement(node);
    if(!owner||!isVisible(owner))return false;
    if((node.nodeType===3||node.nodeType===4)&&owner.localName==='details'&&!owner.hasAttribute('open'))return false;
    return true;
  }
  function evaluateValueXPath(doc,xpath,context=doc) {
    let result;
    try{result=doc.evaluate(xpath,context,null,7,null);}catch(error){throw new Error('XPath 必须返回元素、属性或文本节点集；不支持 string()/count()/boolean() 等标量。详情：'+error.message);}
    const out=[];
    for(let i=0;i<result.snapshotLength;i++){const node=result.snapshotItem(i);if(!ownerElement(node))throw new Error('仅支持元素、属性和文本节点，不支持注释或其他节点类型');out.push(node);}
    return out;
  }
  function extractValue(node) {
    if(node?.nodeType===1)return extractText(node);
    if(node?.nodeType===2)return node.value;
    if(node?.nodeType===3||node?.nodeType===4)return node.nodeValue || '';
    throw new Error('不支持此 XPath 结果类型');
  }
  function classes(a,b) { return Array.from(a.classList).filter(c=>b.classList.contains(c)).slice(0,4); }
  function classPred(tokens) { return tokens.map(c=>'[contains(concat(" ",normalize-space(@class)," "),'+xpathLiteral(' '+c+' ')+')]').join(''); }
  function chain(root,el) { const out=[]; for(let e=el;e&&e!==root;e=e.parentElement) out.unshift(e); return out; }
  function inferCandidates(a,b) {
    const warnings=[], candidates=[];
    if(!a||!b||a===b) return {candidates,warnings:['请选取两个不同条目的同一字段']};
    if(a.ownerDocument!==b.ownerDocument || a.getRootNode()!==a.ownerDocument || b.getRootNode()!==b.ownerDocument) return {candidates,warnings:['仅支持同一主文档的普通 DOM']};
    if(a.contains(b)||b.contains(a)) return {candidates,warnings:['两个样本互相嵌套，请选择不同条目的同一字段']};
    let common=a.parentElement; while(common&&!common.contains(b)) common=common.parentElement;
    if(!common || /^(html|body)$/i.test(common.localName)) return {candidates,warnings:['样本共同祖先过宽，可能属于不同模块；请重新选择']};
    const ca=chain(common,a), cb=chain(common,b), ra=ca[0], rb=cb[0];
    if(ca.length!==cb.length || ca.some((e,i)=>!sameTag(e,cb[i]))) return {candidates,warnings:['样本字段层级或标签不一致，无法可靠泛化；可手动输入 XPath']};
    const shared=ca.map((e,i)=>classes(e,cb[i]));
    const positionalEqual=ca.slice(1).every((e,i)=>index(e)===index(cb[i+1]));
    const semantic=shared.some(c=>c.length);
    if(!positionalEqual) warnings.push('样本字段位置不同，按共同类名尝试匹配；可能选中了不同字段，请特别核对');
    if(!positionalEqual && !shared[shared.length-1].length) return {candidates,warnings:['字段相对位置不同且缺少共同字段类名，无法可靠泛化']};
    const base=absoluteXPath(common);
    const wide=base+'/'+tagStep(ra)+ca.slice(1).map((e,i)=>'/'+(index(e)===index(cb[i+1])?step(e):tagStep(e)+classPred(shared[i+1]))).join('');
    const structure=base+'/'+tagStep(ra)+classPred(shared[0])+ca.slice(1).map((e,i)=>'/'+tagStep(e)+(shared[i+1].length?classPred(shared[i+1]):'['+index(e)+']')).join('');
    function add(label,xpath,kind,notes) {
      if(candidates.some(c=>c.xpath===xpath)) return;
      const matches=evaluateXPath(a.ownerDocument,xpath);
      if(matches.includes(a)&&matches.includes(b)) candidates.push({label:label+' · '+matches.length+' 项',xpath,kind,warnings:notes});
    }
    if(semantic) add('结构约束',structure,'structure',['共同类名是启发式约束，请核对广告及缺字段条目']);
    if(positionalEqual) add('同层位置泛化',wide,'positional',['依赖字段位置一致；缺字段或广告混排可能误匹配']);
    // Exact pair is always available as a conservative fallback, never presented as bulk inference.
    add('仅两个样本（最窄）',absoluteXPath(a)+' | '+absoluteXPath(b),'samples',['仅提取已选择的两个样本']);
    if(!semantic) warnings.push('缺少共同类名，仅能按 DOM 层级/位置泛化，广告或缺字段可能导致误匹配');
    if(ca.length===1) warnings.push('样本直接相邻，可能是同一条目内的不同字段；请核对是否选中了不同条目');
    warnings.push('两点采样不能证明字段语义相同；请检查全部预览后导出');
    return {candidates,warnings};
  }
  function isVisible(el) {
    for(let e=el;e;e=e.parentElement) {
      const style=e.ownerDocument.defaultView.getComputedStyle(e);
      if(e.localName==='details'&&!e.hasAttribute('open')&&e!==el){const summary=Array.from(e.children).find(child=>child.localName==='summary');if(!summary||!summary.contains(el))return false;}
      if(e.hidden||style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.opacity==='0'||style.contentVisibility==='hidden'||e.getAttribute('aria-hidden')==='true') return false;
    }
    return true;
  }
  function extractText(el) {
    // Preserve inline text adjacency; insert separators only at layout/block boundaries.
    const pieces=[];
    function visit(n) {
      if(n.nodeType===3){pieces.push(n.nodeValue);return;}
      if(n.nodeType!==1 || /^(script|style|noscript|template)$/i.test(n.localName) || !isVisible(n))return;
      if(n.localName==='details'&&!n.hasAttribute('open')){const summary=Array.from(n.children).find(child=>child.localName==='summary');if(summary)visit(summary);return;}
      if(n.localName==='br'){pieces.push('\n');return;}
      const display=n.ownerDocument.defaultView.getComputedStyle(n).display;
      const block=/^(block|flex|grid|table|list-item|flow-root)/.test(display) || (!display && /^(div|p|li|section|article|header|footer|main|h[1-6]|ul|ol|pre|blockquote)$/.test(n.localName));
      if(block)pieces.push('\n');
      for(const child of n.childNodes)visit(child);
      if(block)pieces.push('\n');
    }
    visit(el);
    return pieces.join('').replace(/\s+/g,' ').trim();
  }
  function toCSV(texts) {
    const cell=s=>'"'+(/^[\s\u0000-\u001f]*[=+\-@]/.test(String(s))?"'"+s:String(s)).replace(/"/g,'""')+'"';
    return '\uFEFF'+['序号,文本',...texts.map((s,i)=>(i+1)+','+cell(s))].join('\r\n');
  }
  const api={xpathLiteral,absoluteXPath,evaluateXPath,evaluateValueXPath,ownerElement,isValueVisible,extractValue,inferCandidates,isVisible,extractText,toCSV};
  root.XPathBatchCore=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})(globalThis);
