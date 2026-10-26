import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, ArrowRight, CaretDown, CaretLeft, CaretRight, CaretUp, ArrowCounterClockwise, Play, X, SquaresFour, ListChecks, NotePencil, PlugsConnected, Globe } from '@phosphor-icons/react';
import { useLanguage } from './i18n/context.jsx';
import { readmeFilename } from './i18n/core.mjs';

const REPO = 'https://github.com/Sunanang/Pome-Panel';
const sections = [
  { id:'top', label:'nav.overview' },
  { id:'experience', label:'nav.experience' },
  { id:'workspace', label:'nav.workspace' },
  { id:'local', label:'nav.local' },
];
const tabIcons = { home:SquaresFour, todo:ListChecks, notes:NotePencil };
const edgeIcons = { top:CaretUp, right:CaretRight, bottom:CaretDown, left:CaretLeft };
const tabs = [{id:'home'}, {id:'todo'}, {id:'notes'}];

function TextLines({ value, title=false }) {
  return value.split('\n').map((line,index)=><Fragment key={index}>{index>0&&<br/>}{title&&index>0?<span>{line}</span>:line}</Fragment>);
}

function LanguagePicker() {
  const {t,languages,locale,preference,selectPreference}=useLanguage();
  return <div className="language-picker">
    <Globe size={16} aria-hidden="true"/>
    <select id="site-language" aria-label={t('language.label')} title={languages.find(row=>row.id===locale)?.name} value={preference} onChange={event=>selectPreference(event.target.value)}>
      <option value="system">{t('language.auto')}</option>
      {languages.map(row=><option key={row.id} value={row.id} lang={row.id}>{row.name}</option>)}
    </select>
    <CaretDown size={12} aria-hidden="true"/>
  </div>;
}

function Header({ onDownload }) {
  const {t,locale}=useLanguage();
  const [current,setCurrent]=useState('top');
  const header=useRef(null), nav=useRef(null);
  useEffect(()=>{
    let frame=0;
    const update=()=>{
      frame=0;
      const marker=header.current.getBoundingClientRect().bottom+Math.min(120,innerHeight*.15);
      let active='top';
      for(const {id} of sections.slice(1)){
        if(document.getElementById(id)?.getBoundingClientRect().top<=marker)active=id;
      }
      setCurrent(active);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);addEventListener('hashchange',schedule);
    update();
    return ()=>{cancelAnimationFrame(frame);removeEventListener('scroll',schedule);removeEventListener('resize',schedule);removeEventListener('hashchange',schedule);};
  },[locale]);
  useLayoutEffect(()=>{
    const el=nav.current;
    const position=()=>{
      const active=el.querySelector('[aria-current="location"]');
      if(!active)return;
      el.style.setProperty('--active-x',`${active.offsetLeft}px`);
      el.style.setProperty('--active-width',`${active.offsetWidth}px`);
      el.dataset.ready='true';
    };
    const observer=new ResizeObserver(position);observer.observe(el);position();
    return ()=>observer.disconnect();
  },[current,locale]);
  return <header className="site-header" ref={header}>
    <a className="brand" href="#top" aria-label={t('nav.homeLabel')}><img src="/assets/pome-icon.png" alt=""/><span>Pome Panel</span></a>
    <nav className="header-nav" ref={nav} aria-label={t('nav.label')}>
      <span className="nav-highlight" aria-hidden="true"/>
      {sections.map(s=><a key={s.id} className="nav-link" href={'#'+s.id} aria-current={current===s.id?'location':undefined}>{t(s.label)}</a>)}
      <a className="nav-external" href={REPO} target="_blank" rel="noreferrer">GitHub<ArrowUpRight size={13} aria-hidden="true"/></a>
    </nav>
    <div className="header-actions"><LanguagePicker/><button className="nav-cta" aria-label={t('action.getShort')} onClick={onDownload}><span className="nav-cta-label">{t('action.getShort')}</span><ArrowDown size={14} aria-hidden="true"/></button></div>
  </header>;
}

function useReducedMotion() {
  const [reduced,setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>setReduced(media.matches);
    media.addEventListener('change',update);
    return ()=>media.removeEventListener('change',update);
  },[]);
  return reduced;
}

function Story({ reduced }) {
  const {t,locale}=useLanguage();
  const section=useRef(null), surface=useRef(null);
  const [phase,setPhase]=useState(0), [manual,setManual]=useState(null), [edge,setEdge]=useState('top');
  const opened=manual ?? (reduced || phase>0);
  useEffect(()=>{
    let frame=0;
    const paint=()=>{
      frame=0;
      const rect=section.current.getBoundingClientRect();
      const distance=Math.max(1,rect.height-innerHeight);
      const headerHeight=document.querySelector('.site-header').getBoundingClientRect().height;
      const p=Math.min(1,Math.max(0,(headerHeight-rect.top)/distance));
      setPhase(p<.18?0:p<.72?1:2);
      surface.current.style.setProperty('--scroll-open',reduced?1:Math.min(1,Math.max(0,(p-.1)/.35)));
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(paint);};
    addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);paint();
    return ()=>{cancelAnimationFrame(frame);removeEventListener('scroll',schedule);removeEventListener('resize',schedule);};
  },[reduced,locale]);
  return <section id="experience" className="story" ref={section} aria-label={t('story.region')}>
    <div className="story-sticky">
      <div className="section-top"><span className="eyebrow">{t('story.eyebrow')}</span><span className="muted">{t('story.prompt')}</span></div>
      <div className="story-heading"><h2><TextLines value={t('story.title')} title/></h2><p><TextLines value={t('story.description')}/></p></div>
      <div className={`demo-desktop edge-${edge} ${opened?'is-open':''} ${manual!==null?'manual':''}`} ref={surface}>
        <img className="desktop-scene" src="/assets/edge-scene.png" alt="" loading="lazy"/>
        <span className="desktop-label">{t('story.desktop')}</span>
        <button className="capsule-hit" aria-label={t(opened?'story.closeDemo':'story.openDemo')} aria-expanded={opened} onClick={()=>setManual(!opened)}><span className="capsule"/></button>
        <div className="unfold-panel" aria-hidden={!opened}><img src={`/assets/product/${locale}/home.png`} alt={t('story.imageAlt')} loading="lazy"/></div>
        <div className="desktop-hint">{t(opened?'story.hintOpen':'story.hintClosed')}</div>
      </div>
      <div className="story-controls">
        <div className="edge-switch" role="group" aria-label={t('story.edges')}>{[['top','story.top'],['right','story.right'],['bottom','story.bottom'],['left','story.left']].map(([id,name])=>{const Icon=edgeIcons[id];return <button key={id} aria-pressed={edge===id} onClick={()=>{setEdge(id);setManual(false);}}><Icon size={14} aria-hidden="true"/><span>{t(name)}</span></button>;})}</div>
        <div className="story-actions"><button className="story-toggle" aria-expanded={opened} onClick={()=>setManual(!opened)}><span>{t(opened?'story.close':'story.open')}</span><CaretDown className="state-caret" size={16} style={{'--caret-angle':`${({top:0,right:90,bottom:180,left:-90}[edge])+(opened?180:0)}deg`}} aria-hidden="true"/></button>{manual!==null&&<button className="muted restore-button" onClick={()=>setManual(null)}><ArrowCounterClockwise size={15} aria-hidden="true"/><span>{t('story.restore')}</span></button>}</div>
        <span className="demo-mark">{t('story.caption')}</span>
      </div>
    </div>
  </section>;
}

export function App(){
  const {t,locale}=useLanguage();
  const reduced=useReducedMotion();
  const [tab,setTab]=useState(0), [download,setDownload]=useState(false), [nas,setNas]=useState(false);
  const dialog=useRef(null),lastFocus=useRef(null);
  useEffect(()=>{
    if(download){lastFocus.current=document.activeElement;dialog.current.showModal();}
    else if(dialog.current?.open){dialog.current.close();lastFocus.current?.focus();}
  },[download]);
  const changeTab=i=>setTab((i+tabs.length)%tabs.length);
  return <>
    <Header onDownload={()=>setDownload(true)}/>
    <main id="top">
      <section className="hero">
        <img className="hero-scene" src="/assets/edge-scene.png" alt={t('hero.imageAlt')} fetchPriority="high"/>
        <div className="hero-content"><span className="eyebrow">{t('hero.eyebrow')}</span>
          <h1><TextLines value={t('hero.title')} title/></h1>
          <p className="hero-description"><TextLines value={t('hero.description')}/></p>
          <div className="hero-actions"><button className="button primary" onClick={()=>setDownload(true)}><span>{t('action.get')}</span><ArrowDown size={17} aria-hidden="true"/></button><a className="button quiet" href="#experience"><Play size={15} aria-hidden="true"/><span>{t('action.explore')}</span></a></div>
          <span className="platforms">{t('hero.platforms')}</span>
        </div>
        <a className="hero-product" href="#workspace" aria-label={t('nav.workspace')}><img src={`/assets/product/${locale}/home.png`} alt={t('story.imageAlt')} fetchPriority="high"/><span>{t('hero.productLabel')}</span></a>
        <div className="hero-bottom"><span>{t('hero.motto')}</span><a className="scroll-cue" href="#experience"><span>{t('action.scroll')}</span><ArrowDown size={14} aria-hidden="true"/></a><span>{t('hero.bottom')}</span></div>
      </section>
      <div className="intro-line"><span>{t('intro.title')}</span><p><TextLines value={t('intro.description')}/></p><span className="small-label">{t('intro.eyebrow')}</span></div>
      <Story reduced={reduced}/>
      <section className="workspace-section" id="workspace">
        <div className="section-top"><span className="eyebrow">{t('workspace.eyebrow')}</span><span className="muted">{t('workspace.kicker')}</span></div>
        <div className="workspace-title"><h2><TextLines value={t('workspace.title')} title/></h2><p><TextLines value={t('workspace.description')}/></p></div>
        <div className="workspace-switch" role="tablist" aria-label={t('workspace.tabs')} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const i=(tab+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;setTab(i);document.getElementById('tab-'+tabs[i].id)?.focus();}}}>
          {tabs.map((page,i)=>{const Icon=tabIcons[page.id];return <button key={page.id} id={'tab-'+page.id} role="tab" aria-selected={tab===i} aria-controls={'panel-'+page.id} tabIndex={tab===i?0:-1} onClick={()=>setTab(i)}><Icon size={17} aria-hidden="true"/><span>{t('tabs.'+page.id+'.name')}</span></button>;})}
        </div>
        <div className="workspace-stage">{tabs.map((page,i)=><div id={'panel-'+page.id} role="tabpanel" aria-labelledby={'tab-'+page.id} hidden={tab!==i} key={page.id}><img src={'/assets/product/'+locale+'/'+page.id+'.png'} alt={t('workspace.imageAlt',{page:t('tabs.'+page.id+'.name')})} loading="lazy"/></div>)}</div>
        <div className="workspace-caption"><div><h3>{t('tabs.'+tabs[tab].id+'.title')}</h3><p>{t('tabs.'+tabs[tab].id+'.copy')}</p></div><div className="next-prev"><button className="icon-button" aria-label={t('action.prev')} title={t('action.prev')} onClick={()=>changeTab(tab-1)}><CaretLeft size={19} aria-hidden="true"/></button><span>0{tab+1} / 03</span><button className="icon-button" aria-label={t('action.next')} title={t('action.next')} onClick={()=>changeTab(tab+1)}><CaretRight size={19} aria-hidden="true"/></button></div></div>
      <p className="product-language-note">{t('workspace.note')}</p></section>
      <section className="local-section" id="local">
        <div className="section-top"><span className="eyebrow">{t('local.eyebrow')}</span><span className="muted">{t('local.kicker')}</span></div>
        <div className="local-grid"><div><h2><TextLines value={t('local.title')} title/></h2><p><TextLines value={t('local.description')}/></p><button className="connection-button" aria-pressed={nas} onClick={()=>setNas(!nas)}><PlugsConnected size={17} aria-hidden="true"/><span>{t(nas?'local.disconnect':'local.connect')}</span><ArrowRight size={15} aria-hidden="true"/></button></div>
          <div className={'connection-scene '+(nas?'connected':'')} aria-live="polite"><span className="small-label">{t(nas?'local.mode.nas':'local.mode.local')}</span><img src="/assets/pome-icon.png" alt="Pome Panel"/><h3>{t(nas?'local.headline.nas':'local.headline.local')}</h3><p>{t(nas?'local.copy.nas':'local.copy.local')}</p><span className="connection-status">{t(nas?'local.status.nas':'local.status.local')}</span><small>{t('local.demo')}</small></div>
        </div>
      </section>
      <section className="closing"><span className="eyebrow">{t('closing.eyebrow')}</span><h2><TextLines value={t('closing.title')} title/></h2><button className="button primary" onClick={()=>setDownload(true)}><span>{t('action.get')}</span><ArrowDown size={17} aria-hidden="true"/></button><p>{t('closing.description')}</p></section>
      <section className="faq" aria-label={t('faq.region')}><h3>{t('faq.title')}</h3>
        <details><summary><span>{t('faq.nas.question')}</span><CaretDown size={18} aria-hidden="true"/></summary><p>{t('faq.nas.answer')}</p></details>
        <details><summary><span>{t('faq.platform.question')}</span><CaretDown size={18} aria-hidden="true"/></summary><p>{t('faq.platform.answer')}</p></details>
        <details><summary><span>{t('faq.demo.question')}</span><CaretDown size={18} aria-hidden="true"/></summary><p>{t('faq.demo.answer')}</p></details>
      </section>
    </main>
    <footer><a className="brand" href="#top"><img src="/assets/pome-icon.png" alt=""/><span>Pome Panel</span></a><span>{t('footer.tagline')}</span><div><a href={REPO} target="_blank" rel="noreferrer">GitHub</a><a href={REPO+'/blob/dev/LICENSE'} target="_blank" rel="noreferrer">{t('footer.license')}</a><a href="https://github.com/xiaopu-ai/TO-DO-Panel" target="_blank" rel="noreferrer">{t('footer.credit')}</a></div></footer>
    <dialog ref={dialog} className="download-dialog" onCancel={e=>{e.preventDefault();setDownload(false);}} onClick={e=>{if(e.target===dialog.current)setDownload(false);}} aria-labelledby="download-title"><div className="dialog-heading"><img src="/assets/pome-icon.png" alt=""/><button className="icon-button" aria-label={t('action.closeDownload')} title={t('action.close')} onClick={()=>setDownload(false)}><X size={19} aria-hidden="true"/></button></div><span className="eyebrow">{t('download.eyebrow')}</span><h2 id="download-title">{t('download.title')}</h2><p>{t('download.description')}</p><a className="button primary" href={REPO+'/releases'} target="_blank" rel="noreferrer"><span>{t('download.releases')}</span><ArrowUpRight size={17} aria-hidden="true"/></a><a className="button quiet" href={REPO+'/blob/dev/'+readmeFilename(locale)} target="_blank" rel="noreferrer"><span>{t('download.source')}</span><ArrowUpRight size={16} aria-hidden="true"/></a><small>{t('download.platforms')}</small></dialog>
  </>;
}
