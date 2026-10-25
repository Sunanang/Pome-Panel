'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1300, height: 720, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const shots = process.env.POME_METADATA_SHOTS || path.join(__dirname, '../dist.noindex/metadata-races');
  fs.mkdirSync(shots, { recursive: true });
  const capture = async name => {
    await js(`document.fonts.ready;document.getElementById('ui-capsule-hint')?.querySelector('button')?.click()`);
    await new Promise(resolve => setTimeout(resolve, 450));
    fs.writeFileSync(path.join(shots, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
    await js(`(async () => {
      window.linkReplies=[];window.noteReplies=[];window.testUnhandled='';
      window.addEventListener('unhandledrejection',event=>window.testUnhandled=String(event.reason));
      window.notchAPI={inspectLink:()=>new Promise(resolve=>linkReplies.push(resolve)),organizeMaterial:()=>new Promise(resolve=>noteReplies.push(resolve))};
      window.addTestLink=url=>{const input=document.getElementById('link-add');input.value=url;input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));};
      window.readTestLinks=()=>JSON.parse(localStorage.getItem('notch-link-groups'));
      await setMode(true);await setActiveTab('links');
      addTestLink('https://example.com/first');
      document.querySelector('[data-action="edit-link"]').click();
      const edit=document.querySelector('.link-title-edit');edit.value='我手动保存的标题';edit.dispatchEvent(new Event('change',{bubbles:true}));
      linkReplies.shift()({ok:true,title:'Learn automatic title'});
    })()`);
    await js(`new Promise(resolve=>setTimeout(resolve,0))`);
    assert.equal(await js(`readTestLinks().flatMap(group=>group.links)[0].title`), '我手动保存的标题');
    const draft = await js(`(async () => {
      addTestLink('https://example.org/second');
      const rows=[...document.querySelectorAll('.link-item')];window.editingLinkRow=rows.find(row=>row.querySelector('.link-open span').textContent.includes('example.org'));
      editingLinkRow.querySelector('[data-action="edit-link"]').click();window.metadataDraft=document.querySelector('.link-title-edit');
      metadataDraft.value='还没有提交的重命名';metadataDraft.setSelectionRange(3,7);metadataDraft.focus();
      linkReplies.shift()({ok:true,title:'Learn obsolete rename'});await new Promise(resolve=>setTimeout(resolve,0));
      return {connected:metadataDraft.isConnected,same:document.querySelector('.link-title-edit')===metadataDraft,value:metadataDraft.value,start:metadataDraft.selectionStart,end:metadataDraft.selectionEnd};
    })()`);
    assert.deepEqual(draft, { connected: true, same: true, value: '还没有提交的重命名', start: 3, end: 7 });
    await capture('link-rename-preserved');
    await js(`metadataDraft.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('link-add').focus();`);
    const moved = await js(`(async () => {
      document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection',{detail:{links:[]}}));
      addTestLink('https://example.net/moved');const groups=readTestLinks(),id=groups.flatMap(g=>g.links)[0].id;
      groups.push({id:'manual-group',name:'手动收藏',links:[]});
      const moved=NotchDomain.moveLinkToGroup(groups,id,'manual-group');
      document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection',{detail:{links:moved}}));
      linkReplies.shift()({ok:true,title:'Learn generated title'});await new Promise(resolve=>setTimeout(resolve,0));
      return readTestLinks().find(group=>group.links.length).id;
    })()`);
    assert.equal(moved, 'manual-group');
    const noteDraft = await js(`(async () => {
      localStorage.setItem(NOTE_ARCHIVE_KEY,JSON.stringify([{id:'metadata-note',title:'',content:'原始正文',createdAt:1,updatedAt:1}]));
      selectedNoteId='metadata-note';await setActiveTab('notes');renderNotesLibrary();setNotesDetailMode('edit');
      window.noteDraft=document.getElementById('notes-editor');noteDraft.focus();noteDraft.value='刚刚输入、仍在去抖等待的正文';noteDraft.dispatchEvent(new Event('input',{bubbles:true}));
      noteReplies.shift()({ok:true,title:'旧正文生成标题'});await new Promise(resolve=>setTimeout(resolve,0));
      return {same:noteDraft===document.getElementById('notes-editor'),connected:noteDraft.isConnected,text:document.getElementById('notes-editor').value,stored:loadNoteArchive()[0].content};
    })()`);
    assert.deepEqual(noteDraft, { same: true, connected: true, text: '刚刚输入、仍在去抖等待的正文', stored: '刚刚输入、仍在去抖等待的正文' });
    await capture('note-draft-preserved');
    const oldReply = await js(`(async () => {
      flushNotesEditorSave();
      localStorage.setItem(NOTE_ARCHIVE_KEY,JSON.stringify([{id:'note-old',title:'',content:'A 的正文',createdAt:1,updatedAt:1},{id:'note-current',title:'B 的手动标题',titleSource:'user',content:'B 的正文',createdAt:2,updatedAt:2}]));
      selectedNoteId='note-old';renderNotesLibrary();selectedNoteId='note-current';renderNotesLibrary();
      window.currentNoteEditor=document.getElementById('notes-editor');noteReplies.at(-1)({ok:true,title:'A 的生成标题'});await new Promise(resolve=>setTimeout(resolve,0));
      return {title:document.querySelector('.notes-detail-title').value,same:document.getElementById('notes-editor')===currentNoteEditor,old:loadNoteArchive().find(note=>note.id==='note-old').title};
    })()`);
    assert.deepEqual(oldReply, { title: 'B 的手动标题', same: true, old: 'A 的生成标题' });
    const credentialState = await js(`(async () => {
      window.credentialReads=[];window.credentialSaves=[];
      window.fixtureCredentials=['a','b'].map(id=>({id,service:'测试服务 '+id,account:'fixture-'+id,password:'fixture-only',passwordMask:'********'}));
      notchAPI.listCredentials=async()=>({ok:true,items:fixtureCredentials});
      notchAPI.getCredential=id=>new Promise(resolve=>credentialReads.push({id,resolve}));
      notchAPI.saveCredential=payload=>new Promise(resolve=>credentialSaves.push({payload,resolve}));
      window.clickCredential=id=>document.querySelector('#credential-list [data-id="'+id+'"] .credential-copy').click();
      window.setCredentialDraft=value=>{const input=document.querySelector('.credential-item.editing input[name="service"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
      document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection',{detail:{notes:[]}}));
      await setActiveTab('credentials');await new Promise(resolve=>setTimeout(resolve,0));
      clickCredential('a');clickCredential('b');
      credentialReads[1].resolve({ok:true,item:fixtureCredentials[1]});await new Promise(resolve=>setTimeout(resolve,0));
      setCredentialDraft('B 的编辑草稿');
      credentialReads[0].resolve({ok:true,item:fixtureCredentials[0]});await new Promise(resolve=>setTimeout(resolve,0));
      const afterOldRead={id:document.querySelector('.credential-item.editing').dataset.id,value:document.querySelector('.credential-item.editing input[name="service"]').value};
      document.querySelector('.credential-item.editing').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      clickCredential('a');credentialReads.at(-1).resolve({ok:true,item:fixtureCredentials[0]});await new Promise(resolve=>setTimeout(resolve,0));
      setCredentialDraft('A 的新编辑草稿');credentialSaves[0].resolve({ok:true});await new Promise(resolve=>setTimeout(resolve,0));
      return {afterOldRead,id:document.querySelector('.credential-item.editing').dataset.id,value:document.querySelector('.credential-item.editing input[name="service"]').value};
    })()`);
    assert.deepEqual(credentialState, { afterOldRead: { id: 'b', value: 'B 的编辑草稿' }, id: 'a', value: 'A 的新编辑草稿' });
    await capture('credential-latest-edit-preserved');
    const cancelledCredential = await js(`(async () => {
      clickCredential('b');const old=credentialReads.at(-1);
      document.querySelector('[data-credential-cancel]').click();await new Promise(resolve=>setTimeout(resolve,0));
      old.resolve({ok:true,item:fixtureCredentials[1]});await new Promise(resolve=>setTimeout(resolve,0));
      const cancelled=!document.querySelector('.credential-item.editing');
      clickCredential('a');const pending=credentialReads.at(-1);await setActiveTab('notes');
      pending.resolve({ok:true,item:fixtureCredentials[0]});await new Promise(resolve=>setTimeout(resolve,0));
      return {cancelled,closed:!document.querySelector('.credential-item.editing')};
    })()`);
    assert.deepEqual(cancelledCredential, { cancelled: true, closed: true });
    assert.equal(await js(`window.testUnhandled`), '');assert.deepEqual(errors, []);
    console.log('Link metadata and generated note titles preserve drafts; credential reads and saves respect the current editing session');
  } finally { win.destroy(); }
}
main().then(() => app.quit(), error => { console.error(error); app.exit(1); });
