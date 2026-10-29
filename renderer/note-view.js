/* Source-aware viewport transfer between Markdown preview and its textarea. */
(() => {
  'use strict';
  const textSources = new WeakMap();
  const selectionByEditor = new WeakMap();
  const previewAnchors = new WeakMap();
  function markText(node, start) {
    if (node?.nodeType === Node.TEXT_NODE && Number.isFinite(start)) textSources.set(node, start);
    return node;
  }
  function rangeRect(node, offset) {
    const range = document.createRange();
    const at = Math.max(0, Math.min(node.length - 1, offset));
    range.setStart(node, at); range.setEnd(node, Math.min(node.length, at + 1));
    return range.getBoundingClientRect();
  }
  function mirror(editor) {
    const style = getComputedStyle(editor), root = document.createElement('div');
    root.className = 'note-text-measure'; root.setAttribute('aria-hidden', 'true');
    for (const key of ['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','letterSpacing','lineHeight','wordSpacing','textIndent','tabSize','wordBreak','overflowWrap','paddingTop','paddingRight','paddingBottom','paddingLeft','textAlign','direction']) root.style[key] = style[key];
    Object.assign(root.style, {width:editor.clientWidth+'px',whiteSpace:'pre-wrap',boxSizing:'border-box'});
    const text = document.createTextNode(editor.value+'\u200b'); root.append(text); document.body.append(root);
    const bounds = root.getBoundingClientRect();
    const rectAt = offset => rangeRect(text, Math.min(editor.value.length, Math.max(0,offset)));
    function atY(y) {
      let low=0, high=editor.value.length;
      while(low<high) { const mid=(low+high)>>1;if(rectAt(mid).bottom-bounds.top<=y) low=mid+1;else high=mid; }
      return low;
    }
    return {root,text,style,bounds,rectAt,atY,destroy:()=>root.remove()};
  }
  function textNodes(preview, hidden = false) {
    const result=[],walker=document.createTreeWalker(preview,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) {
      const node=walker.currentNode;
      if(textSources.has(node)&&node.length&&(hidden?!node.parentElement.closest('[hidden]')||node.parentElement.closest('[hidden]')===preview:node.parentElement?.checkVisibility()))result.push(node);
    }
    return result;
  }
  function capturePreview(preview) {
    const bounds=preview.getBoundingClientRect();
    const top=bounds.top+parseFloat(getComputedStyle(preview).paddingTop||0);
    for(const node of textNodes(preview)) {
      if(rangeRect(node,node.length-1).bottom<=top)continue;
      let low=0,high=node.length-1;
      while(low<high){const mid=(low+high)>>1;if(rangeRect(node,mid).bottom<=top)low=mid+1;else high=mid;}
      const rect=rangeRect(node,low);
      return {offset:textSources.get(node)+low,y:rect.top-bounds.top};
    }
    return {offset:0,y:0};
  }
  function captureEditor(editor) {
    const m=mirror(editor);
    try {const offset=m.atY(editor.scrollTop);return {offset,y:m.rectAt(offset).top-m.bounds.top-editor.scrollTop};}
    finally {m.destroy();}
  }
  function restoreEditor(editor,anchor) {
    const m=mirror(editor);
    try {editor.scrollTop=m.rectAt(anchor.offset).top-m.bounds.top-anchor.y;}
    finally {m.destroy();}
  }
  function nearest(preview,offset,hidden=false) {
    let best=null,distance=Infinity;
    for(const node of textNodes(preview,hidden)) {
      const start=textSources.get(node),index=Math.max(0,Math.min(node.length-1,offset-start));
      const delta=Math.abs(start+index-offset);
      if(delta<distance){best={node,index,offset:start+index};distance=delta;}if(delta===0)break;
    }
    return best;
  }
  function restorePreview(preview,anchor) {
    const best=nearest(preview,anchor.offset);
    if(best)preview.scrollTop+=rangeRect(best.node,best.index).top-preview.getBoundingClientRect().top-anchor.y;
  }
  function clickedOffset(event,preview) {
    if(!event)return null;
    const position=document.caretPositionFromPoint?.(event.clientX,event.clientY);
    if(position && preview.contains(position.offsetNode) && textSources.has(position.offsetNode)) return textSources.get(position.offsetNode)+position.offset;
    return null;
  }
  function transfer(editor,preview,toPreview,{focus=true,event=null,render=()=>{}}={}) {
    const same=toPreview ? !preview.hidden : !editor.hidden;
    if(same)return;
    let anchor=toPreview?captureEditor(editor):capturePreview(preview);
    const previous=previewAnchors.get(editor);
    // Markdown block spacing differs from raw text. If the reader has not
    // scrolled or changed the text before the original glyph, round-trip that
    // exact glyph rather than a neighbouring newline or list marker.
    const reuse=toPreview&&previous&&Math.abs(editor.scrollTop-previous.scrollTop)<1
      &&editor.value.slice(0,previous.anchor.offset+1)===previous.prefix;
    if(reuse)anchor={...previous.anchor};
    const clicked=toPreview?null:clickedOffset(event,preview);
    if(toPreview)selectionByEditor.set(editor,{start:editor.selectionStart,end:editor.selectionEnd,direction:editor.selectionDirection});
    if(toPreview){
      render();
      // Markers and line breaks have no preview glyph. Keep the nearest
      // rendered glyph at its original position in the editor instead.
      const best=nearest(preview,anchor.offset,true);
      if(!reuse&&best&&best.offset!==anchor.offset){const m=mirror(editor);try{anchor.offset=best.offset;anchor.y=m.rectAt(best.offset).top-m.bounds.top-editor.scrollTop;}finally{m.destroy();}}
    }
    editor.hidden=toPreview;preview.hidden=!toPreview;
    if(focus) {
      if(toPreview)preview.focus({preventScroll:true});
      else {
        const saved=selectionByEditor.get(editor);
        editor.focus({preventScroll:true});
        const offset=clicked??saved?.start??anchor.offset;
        editor.setSelectionRange(offset,clicked==null?saved?.end??offset:offset,saved?.direction||'none');
      }
    }
    if(toPreview)restorePreview(preview,anchor);else {
      restoreEditor(editor,anchor);
      previewAnchors.set(editor,{anchor:{...anchor},scrollTop:editor.scrollTop,prefix:editor.value.slice(0,anchor.offset+1)});
    }
  }
  function snapshot(editor,preview,mode) {
    return {mode,anchor:mode==='preview'?capturePreview(preview):captureEditor(editor),start:editor.selectionStart,end:editor.selectionEnd,direction:editor.selectionDirection};
  }
  function restore(editor,preview,state) {
    if(!state)return;
    editor.setSelectionRange(state.start,state.end,state.direction);
    if(state.mode==='preview')restorePreview(preview,state.anchor);else restoreEditor(editor,state.anchor);
  }
  window.PomeNoteView={markText,mirror,transfer,snapshot,restore,captureEditor,capturePreview,restoreEditor,restorePreview};
})();
