(function () {
  'use strict';
  const KEY='__xpathBatchController_v1';
  if(globalThis[KEY]) { globalThis[KEY].toggle(); return; }
  const C=globalThis.XPathBatchCore;
  let tableController=null,tableMode=false;
  const host=document.createElement('div');
  host.setAttribute('data-xpath-batch-ui','');
  host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
  const shadow=host.attachShadow({mode:'closed'});
  const style=document.createElement('style');
  style.textContent=`:host{color-scheme:light}*{box-sizing:border-box} .panel{position:fixed;right:18px;top:18px;width:390px;max-width:calc(100vw - 36px);max-height:calc(100vh - 36px);overflow:auto;pointer-events:auto;background:#fff;color:#182238;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 12px 48px #0f172a38;font:13px/1.5 system-ui,sans-serif;padding:16px}h2{font-size:17px;margin:0 0 10px}p{margin:7px 0}button,select,textarea,input{font:inherit}button,select{border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#182238;padding:6px 9px}button{cursor:pointer}button:hover{background:#e0ecff}button:disabled{opacity:.45;cursor:not-allowed}.primary{background:#155eef;color:#fff}.primary:hover{background:#154cca}.row{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}.muted{color:#53647d;font-size:12px}.warn{color:#8a3c04;background:#fff6e6;padding:8px;border-radius:6px;white-space:pre-wrap}.status{color:#174d8e;white-space:pre-wrap}textarea{display:block;width:100%;resize:vertical;min-height:58px;border:1px solid #b8c7dc;border-radius:6px;padding:7px;color:#182238;background:#fff}select{max-width:100%;width:100%}label{display:block;margin:8px 0}label.inline{display:flex;align-items:center;gap:6px}.box{position:fixed;pointer-events:none;border:2px solid #13a67d;background:#13a67d12}.current{border-color:#155eef;background:#155eef18}.hover{border:2px dashed #f79009;background:#f790091f}.sample{border-color:#7b61ff;background:#7b61ff15}.badge{position:absolute;top:0;left:0;background:#155eef;color:white;font:11px system-ui;padding:1px 3px}.close{margin-left:auto}.head{display:flex;align-items:start;gap:6px}.sample-path{font:11px/1.4 ui-monospace,monospace;overflow-wrap:anywhere}.preview{min-height:120px;font:12px/1.5 ui-monospace,monospace}.collapsed{display:none}`;
  shadow.append(style);
  function node(tag,text,parent,cls) {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;(parent||panel).append(e);return e;}
  const overlays=document.createElement('div');shadow.append(overlays);
  const panel=document.createElement('section');panel.className='panel';panel.setAttribute('aria-label','XPath 批量文字提取');shadow.append(panel);
  const head=node('div',undefined,panel,'head');node('h2','XPath 批量文字提取 1.2.1',head);
  const close=node('button','关闭',head,'close');close.title='关闭面板并清除所有高亮';
  node('p','选中两个不同条目的同一字段，即可批量提取。',panel,'muted');
  const actions=node('div',undefined,panel,'row');
  const pick=node('button','开始拾取',actions,'primary');const reset=node('button','重选 / 清除',actions);
  const status=node('p','点击“开始拾取”，再点击网页中的字段',panel,'status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const paths=node('div',undefined,panel,'sample-path');
  node('label','候选 XPath');const candidates=node('select');candidates.setAttribute('aria-label','候选 XPath');
  node('label','XPath（支持 /@href、/@src、/@id、/@class、/text()）');const input=node('textarea');input.setAttribute('aria-label','XPath 表达式');input.spellcheck=false;
  const evalRow=node('div',undefined,panel,'row');const evaluate=node('button','重新评估',evalRow);const copyPath=node('button','复制 XPath',evalRow);
  const visibleLabel=node('label',undefined,panel,'inline');const visible=node('input',undefined,visibleLabel);visible.type='checkbox';visible.checked=true;visibleLabel.append(document.createTextNode('仅导出可见节点（按所属元素判断）'));
  const highlightLabel=node('label',undefined,panel,'inline');const highlights=node('input',undefined,highlightLabel);highlights.type='checkbox';highlights.checked=true;highlightLabel.append(document.createTextNode('高亮全部匹配节点的所属元素'));
  const numberLabel=node('label',undefined,panel,'inline');const numbers=node('input',undefined,numberLabel);numbers.type='checkbox';numbers.checked=false;numbers.setAttribute('aria-label','预览显示序号');numberLabel.append(document.createTextNode('预览显示序号（复制文本不含序号）'));
  const count=node('p','尚无结果');const warning=node('p','',panel,'warn');warning.hidden=true;
  node('label','值预览（每行一个节点，空值保留）');const preview=node('textarea','',panel,'preview');preview.readOnly=true;preview.setAttribute('aria-label','匹配文字预览');
  const exportRow=node('div',undefined,panel,'row');const copyText=node('button','复制所有文本',exportRow);const csv=node('button','导出 CSV',exportRow);
  node('p','仅当前主文档 DOM；不含 iframe / Shadow DOM，不自动滚动或翻页。动态页面变化后请重新评估。Esc 退出拾取。',panel,'muted');
  let picking=false,samples=[],matched=[],result=[],texts=[],inferred=null,hover=null,frame=0,disposed=false,dirty=false,validationTimer=0,copySerial=0;
  document.documentElement.append(host);
  function say(s){status.textContent=s;}
  function warn(items){warning.textContent=items.filter(Boolean).join('\n');warning.hidden=!warning.textContent;}
  function renderPreview(){preview.value=texts.map((s,i)=>(numbers.checked?(i+1)+'. ':'')+s).join('\n');}
  function updateButtons(){copyText.disabled=csv.disabled=!result.length||dirty;copyPath.disabled=!input.value.trim();}
  function stop(){picking=false;hover=null;pick.textContent='开始拾取';draw();}
  function clear(){stop();samples=[];matched=[];result=[];texts=[];inferred=null;dirty=false;paths.replaceChildren();candidates.replaceChildren();input.value='';preview.value='';count.textContent='尚无结果';warn([]);say('已清除，可重新拾取两个样本或手动输入 XPath');updateButtons();draw();}
  function renderPaths(){paths.replaceChildren();samples.forEach((el,i)=>node('p',(i+1)+'. '+C.absoluteXPath(el),paths));}
  function assess(){
    dirty=false; matched=[];result=[];texts=[];preview.value='';
    try{
      if(!input.value.trim())throw new Error('请输入 XPath');
      const all=C.evaluateValueXPath(document,input.value).filter(node=>{const el=C.ownerElement(node);return el!==host&&!el.contains(host);});
      matched=all;result=all.filter(el=>!visible.checked||C.isValueVisible(el));
      texts=result.map(C.extractValue);renderPreview();
      count.textContent='XPath 匹配 '+all.length+' 个；当前导出 '+result.length+' 个';
      const current=inferred?.candidates.find(c=>c.xpath===input.value);
      const notices=[...(inferred?.warnings||[]),...(current?.warnings||[])];
      const matchSet=new Set(result.map(C.ownerElement));
      if(result.some(el=>{for(let p=C.ownerElement(el).parentElement;p;p=p.parentElement)if(matchSet.has(p))return true;return false;}))notices.push('结果包含互相嵌套的元素，导出文字可能重复');
      if(result.length>1000)notices.push('匹配较多：文字完整导出，高亮仅显示前 1000 个；建议收窄 XPath');
      if(all.length!==result.length)notices.push('已过滤隐藏元素 '+(all.length-result.length)+' 个');
      warn(notices);say('已评估，请核对预览后复制或导出');
    }catch(e){count.textContent='评估失败';warn([e.message]);say('请修改 XPath 后重试');}
    updateButtons();draw();
  }
  function draw(){
    if(disposed||frame)return;
    frame=requestAnimationFrame(()=>{frame=0;overlays.replaceChildren();
      const drawOne=(el,cls,label)=>{if(!el?.isConnected)return;const r=el.getBoundingClientRect();if(!r.width||!r.height)return;
        let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
        for(let parent=el.parentElement;parent;parent=parent.parentElement){
          // Root scrolling/propagated body overflow is clipped by the viewport above,
          // not by a document rect whose top moves negatively during page scrolling.
          if(parent===document.documentElement||parent===document.scrollingElement)continue;
          if(parent===document.body){const rootCSS=getComputedStyle(document.documentElement);if((rootCSS.overflowX||rootCSS.overflow||'visible')==='visible'&&(rootCSS.overflowY||rootCSS.overflow||'visible')==='visible')continue;}
          const css=getComputedStyle(parent);const clipX=/^(auto|scroll|hidden|clip)$/.test(css.overflowX||css.overflow);const clipY=/^(auto|scroll|hidden|clip)$/.test(css.overflowY||css.overflow);if(clipX||clipY){const pr=parent.getBoundingClientRect();const sx=parent.offsetWidth>0?pr.width/parent.offsetWidth:1,sy=parent.offsetHeight>0?pr.height/parent.offsetHeight:1;const pl=pr.left+parent.clientLeft*sx,pt=pr.top+parent.clientTop*sy;if(clipX){left=Math.max(left,pl);right=Math.min(right,pl+parent.clientWidth*sx);}if(clipY){top=Math.max(top,pt);bottom=Math.min(bottom,pt+parent.clientHeight*sy);}}}
        if(right<=left||bottom<=top)return;const box=document.createElement('div');box.className='box '+cls;box.style.cssText=`left:${left}px;top:${top}px;width:${right-left}px;height:${bottom-top}px;`;if(label)node('span',label,box,'badge');overlays.append(box);};
      if(tableMode&&tableController){const entries=tableController.getHighlightEntries?.()||tableController.getHighlights().map(element=>({element,current:false}));entries.slice(0,1000).forEach(entry=>drawOne(entry.element,entry.current?'current':'',''));tableController.getSamples().forEach((e,i)=>drawOne(e,'sample',String(i+1)));const currentHover=tableController.getHover?.();if(currentHover)drawOne(currentHover,'hover','拾取');}
      else{if(highlights.checked&&!dirty)result.slice(0,1000).forEach(e=>drawOne(C.ownerElement(e),'',''));if(!dirty)samples.forEach((e,i)=>drawOne(e,'sample',String(i+1)));if(picking&&hover)drawOne(hover,'hover','拾取');}
    });
  }
  function inUI(e){return e.composedPath().includes(host);}
  function target(e){const el=e.composedPath()[0];return el?.nodeType===1?el:null;}
  function onMove(e){if(!picking||inUI(e))return;hover=target(e);draw();}
  function onClick(e){
    if(!picking||inUI(e))return;
    e.preventDefault();e.stopImmediatePropagation();const el=target(e);
    if(!el||el.getRootNode()!==document||el.shadowRoot){say('暂不支持 Shadow DOM 内部字段，请选普通 DOM 元素');return;}
    if(samples.some(sample=>!sample.isConnected)){clear();picking=true;pick.textContent='退出拾取';say('页面中的原样本已失效，已重新开始选取');}
    if(samples.includes(el)){say('已选过此元素，请选另一个条目');return;}
    matched=[];result=[];texts=[];inferred=null;dirty=false;candidates.replaceChildren();input.value='';preview.value='';count.textContent='等待样本推断';warn([]);updateButtons();
    samples.push(el);renderPaths();draw();
    if(samples.length===1){say('已选第一个字段，请点击另一个条目的相同字段');return;}
    stop();
    try{inferred=C.inferCandidates(samples[0],samples[1]);}catch(error){warn(['无法推断：'+error.message]);say('请重选或手动输入 XPath');return;}
    candidates.replaceChildren();
    inferred.candidates.forEach((c,i)=>{const o=node('option',c.label,candidates);o.value=String(i);});
    if(inferred.candidates.length){input.value=inferred.candidates[0].xpath;assess();}
    else {warn(inferred.warnings);say('无法可靠推断，请重选或手动输入 XPath');updateButtons();}
  }
  function blockPointer(e){if(picking&&!inUI(e)){e.preventDefault();e.stopImmediatePropagation();}}
  function key(e){if(e.key==='Escape'&&picking){e.preventDefault();stop();say('已退出拾取；可继续拾取或清除样本');}}
  function sameNodes(a,b){return a.length===b.length&&a.every((el,i)=>el===b[i]);}
  function validateSnapshot(){
    if(disposed||!result.length||dirty)return !dirty&&!!result.length;
    try{
      const now=C.evaluateValueXPath(document,input.value).filter(node=>{const el=C.ownerElement(node);return el!==host&&!el.contains(host);});
      const exported=now.filter(el=>!visible.checked||C.isValueVisible(el));
      if(sameNodes(now,matched)&&sameNodes(exported,result)&&exported.every((el,i)=>C.extractValue(el)===texts[i]))return true;
    }catch{} // Invalidated XPath or replaced nodes must never export a stale snapshot.
    dirty=true;count.textContent+='（匹配内容已变化）';say('匹配元素、可见性或文字已变化，请重新评估后导出');updateButtons();draw();return false;
  }
  // Coalesce arbitrary page mutations into at most one validation per 120 ms.
  // Geometry-only changes redraw without destroying the validated matches.
  function scheduleValidation(){
    draw();if(disposed||dirty||!result.length||validationTimer)return;
    validationTimer=setTimeout(()=>{validationTimer=0;validateSnapshot();draw();},120);
  }
  function changed(records){if(records.every(r=>r.target===host||host.contains(r.target)))return;scheduleValidation();tableController?.onMutation(records);}
  function onResize(){scheduleValidation();tableController?.onResize();}
  const observer=new MutationObserver(changed);observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
  document.addEventListener('pointermove',onMove,true);document.addEventListener('click',onClick,true);['pointerdown','pointerup','mousedown','mouseup','auxclick'].forEach(type=>document.addEventListener(type,blockPointer,true));document.addEventListener('keydown',key,true);window.addEventListener('scroll',draw,true);window.addEventListener('resize',onResize);
  pick.onclick=()=>{if(picking){stop();say('已退出拾取');return;}if(samples.length!==1)clear();else{matched=[];result=[];texts=[];inferred=null;dirty=false;candidates.replaceChildren();input.value='';preview.value='';count.textContent='等待第二个样本';warn([]);updateButtons();draw();}picking=true;pick.textContent='退出拾取';say(samples.length?'请选第二个条目的相同字段':'拾取中：点击第一个字段，Esc 退出');};
  reset.onclick=clear;evaluate.onclick=assess;candidates.onchange=()=>{input.value=inferred.candidates[Number(candidates.value)].xpath;assess();};visible.onchange=assess;highlights.onchange=draw;numbers.onchange=renderPreview;
  input.oninput=()=>{dirty=true;result=[];texts=[];preview.value='';count.textContent='表达式已修改，请重新评估';updateButtons();draw();};
  async function copy(value,isCurrent){const serial=++copySerial;const valid=()=>!disposed&&!tableMode&&serial===copySerial&&isCurrent();try{await navigator.clipboard.writeText(value);if(valid())say('已复制到剪贴板');}catch{if(!valid())return;say('剪贴板不可用，请选中下方原文后按 Ctrl/Cmd+C；切换序号选项可恢复预览');preview.value=value;preview.focus();preview.select();}}
  copyPath.onclick=()=>{const value=input.value;copy(value,()=>input.value===value);};copyText.onclick=()=>{if(validateSnapshot()){const original=result;copy(texts.join('\n'),()=>result===original&&validateSnapshot());}};
  csv.onclick=()=>{if(!validateSnapshot())return;const blob=new Blob([C.toCSV(texts)],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='xpath-text-'+new Date().toISOString().slice(0,10)+'.csv';shadow.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);say('已请求下载 CSV；如被浏览器拦截，请使用复制所有文本');};
  function dispose(){disposed=true;tableController?.dispose();observer.disconnect();if(validationTimer)clearTimeout(validationTimer);if(frame)cancelAnimationFrame(frame);document.removeEventListener('pointermove',onMove,true);document.removeEventListener('click',onClick,true);['pointerdown','pointerup','mousedown','mouseup','auxclick'].forEach(type=>document.removeEventListener(type,blockPointer,true));document.removeEventListener('keydown',key,true);window.removeEventListener('scroll',draw,true);window.removeEventListener('resize',onResize);host.remove();delete globalThis[KEY];}
  if(globalThis.XPathBatchTableUI&&globalThis.XPathBatchTable){
    const existing=Array.from(panel.children).slice(2),singleGroup=node('div',undefined,panel);
    existing.forEach(el=>singleGroup.append(el));
    const modeRow=node('div',undefined,panel,'row');panel.insertBefore(modeRow,singleGroup);
    const singleMode=node('button','单字段',modeRow,'primary'),multiMode=node('button','多字段表格',modeRow);
    const tableGroup=node('div',undefined,panel);tableGroup.hidden=true;
    tableController=globalThis.XPathBatchTableUI.mount({container:tableGroup,host,onUpdate:draw});tableController.setActive(false);
    function setMode(multi){stop();tableMode=multi;singleGroup.hidden=multi;tableGroup.hidden=!multi;singleMode.className=multi?'':'primary';multiMode.className=multi?'primary':'';panel.style.width=multi?'620px':'390px';tableController.setActive(multi);draw();}
    singleMode.onclick=()=>setMode(false);multiMode.onclick=()=>setMode(true);
  }
  close.onclick=dispose;globalThis[KEY]={toggle:dispose};updateButtons();
})();
