'use strict';

(function () {
  const tile = document.getElementById('home-almanac');
  if (!tile || !window.NotchAlmanac) return;

  const Almanac = window.NotchAlmanac;
  let timer = 0;
  let renderedKey = '';
  let previewDate = null;
  let cachedDay = null;

  function nowDate() {
    return previewDate ? new Date(previewDate.getTime()) : new Date();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function chip(label, kind) {
    return `<span class="almanac-chip almanac-chip-${kind}">${escapeHtml(label)}</span>`;
  }

  function tagRow(label, items, kind) {
    if (!items.length) return '';
    return `<div class="almanac-row almanac-row-${kind}"><span class="almanac-k">${escapeHtml(label)}</span><span class="almanac-v">${items.map((item) => `<i>${escapeHtml(item)}</i>`).join('')}</span></div>`;
  }

  function jieQiBlock(view) {
    const countdown = view.jieQiCountdown
      ? `<span class="almanac-jq-count">${escapeHtml(view.jieQiCountdown)}</span>`
      : '';
    const time = view.jieQiTiming
      ? `<time class="almanac-jq-time" datetime="${escapeHtml(view.jieQiTiming.dateTime)}"><span>${escapeHtml(view.jieQiTimeText)}</span><span>北京时间</span></time>`
      : '';
    return `<div class="almanac-jieqi"><div class="almanac-jq-top">${chip(view.jieQiLabel || '—', 'jieqi')}${countdown}</div>${time}</div>`;
  }

  function renderMini(view) {
    const day = view.day;
    return `<div class="almanac-mini">
      <div class="almanac-mini-top">
        <div class="almanac-daynum">${escapeHtml(day.solar.day)}</div>
        <div class="almanac-mini-meta">
          <span class="almanac-weekday">${escapeHtml(day.solar.weekdayLabel)}</span>
          <span class="almanac-lunar">${escapeHtml(day.lunar.monthDay)}</span>
        </div>
      </div>
      <div class="almanac-mini-foot">
        <span class="yi"><b>宜</b> ${escapeHtml(view.yiText)}</span>
        <span class="ji"><b>忌</b> ${escapeHtml(view.jiText)}</span>
      </div>
    </div>`;
  }

  function renderSmall(view) {
    const day = view.day;
    return `<div class="almanac-small">
      <div class="almanac-line almanac-date-line">
        <strong class="almanac-daynum">${escapeHtml(day.solar.day)}</strong>
        <span>${escapeHtml(day.solar.month)}月 · ${escapeHtml(day.solar.weekdayLabel)}</span>
      </div>
      <div class="almanac-line">${escapeHtml(day.lunar.yearLabel)} · ${escapeHtml(day.lunar.dayGanZhi)}</div>
      <div class="almanac-line">${jieQiBlock(view)}</div>
      ${tagRow('宜', view.yi, 'yi')}
      ${tagRow('忌', view.ji, 'ji')}
      <div class="almanac-line almanac-muted">${escapeHtml(day.chongSha)} · ${escapeHtml(day.naYin)}</div>
    </div>`;
  }

  function renderMedium(view) {
    const day = view.day;
    return `<div class="almanac-medium">
      <div class="almanac-medium-left">
        <div class="almanac-daynum">${escapeHtml(day.solar.day)}</div>
        <div class="almanac-weekday">${escapeHtml(day.solar.weekdayLabel)}</div>
        <div class="almanac-lunar">${escapeHtml(day.lunar.yearLabel)}</div>
        <div class="almanac-ganzhi">${escapeHtml(day.lunar.ganZhiLine)}</div>
      </div>
      <div class="almanac-medium-right">
        ${jieQiBlock(view)}
        ${tagRow('宜', view.yi, 'yi')}
        ${tagRow('忌', view.ji, 'ji')}
        <div class="almanac-meta-grid">
          <span><b>冲煞</b> ${escapeHtml(day.chongSha)}</span>
          <span><b>纳音</b> ${escapeHtml(day.naYin)}</span>
          <span><b>建除</b> ${escapeHtml(day.jianChu)}</span>
          <span><b>值神</b> ${escapeHtml(day.zhiShen)}</span>
        </div>
      </div>
    </div>`;
  }

  function renderLarge(view) {
    const day = view.day;
    return `<div class="almanac-large">
      <div class="almanac-large-head">
        <div class="almanac-large-date">
          <strong class="almanac-daynum">${escapeHtml(day.solar.day)}</strong>
          <div>
            <div class="almanac-weekday">${escapeHtml(day.solar.year)}年${escapeHtml(day.solar.month)}月 · ${escapeHtml(day.solar.weekdayLabel)}</div>
            <div class="almanac-lunar">${escapeHtml(day.lunar.yearLabel)} · ${escapeHtml(day.lunar.shengXiao)}年</div>
          </div>
        </div>
        ${jieQiBlock(view)}
      </div>
      <div class="almanac-meta-grid almanac-meta-wide">
        <span><b>干支</b> ${escapeHtml(day.lunar.ganZhiLine)}</span>
        <span><b>冲煞</b> ${escapeHtml(day.chongSha)}</span>
        <span><b>纳音</b> ${escapeHtml(day.naYin)}</span>
        <span><b>建除</b> ${escapeHtml(day.jianChu)}</span>
        <span><b>值神</b> ${escapeHtml(day.zhiShen)}</span>
        <span><b>星宿</b> ${escapeHtml(day.xiu)}</span>
      </div>
      ${tagRow('宜', view.yi, 'yi')}
      ${tagRow('忌', view.ji, 'ji')}
      <div class="almanac-dual">
        <div><b>吉神宜趋</b><span>${escapeHtml(view.jiShen.join(' '))}</span></div>
        <div><b>彭祖百忌</b><span>${escapeHtml(day.pengZu.line)}</span></div>
      </div>
      <div class="almanac-hours"><b>吉时<span class="almanac-hours-note">传统黄历 · 当地钟表时间</span></b>
        <div class="almanac-hour-list">${day.luckyHours.map((hour) => `<span class="almanac-hour"><em>${escapeHtml(hour.label)}</em><span>${escapeHtml(hour.startHm)}–${escapeHtml(hour.endHm)}</span></span>`).join('')}</div>
      </div>
    </div>`;
  }

  function render() {
    if (tile.hidden) {
      schedule();
      return;
    }
    const size = tile.dataset.widgetSize || 'medium';
    const date = nowDate();
    if (cachedDay?.key !== Almanac.civilKey(date)) cachedDay = Almanac.buildAlmanacDay(date);
    const day = cachedDay;
    const view = Almanac.formatForSize(day, size);
    renderedKey = `${day.key}:${size}`;
    const html = size === 'mini' ? renderMini(view)
      : size === 'small' ? renderSmall(view)
        : size === 'large' ? renderLarge(view)
          : renderMedium(view);
    tile.innerHTML = html;
    schedule();
  }

  function schedule() {
    window.clearTimeout(timer);
    const wait = previewDate ? 60_000 : Almanac.msUntilNextLocalMidnight(nowDate());
    timer = window.setTimeout(() => {
      renderedKey = '';
      render();
    }, Math.max(1000, wait));
  }

  function refreshIfNeeded() {
    const size = tile.dataset.widgetSize || 'medium';
    const key = `${Almanac.civilKey(nowDate())}:${size}`;
    if (key !== renderedKey) render();
    else schedule();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshIfNeeded();
  });
  window.addEventListener('focus', refreshIfNeeded);
  document.addEventListener('notch:modechange', (event) => {
    if (event.detail?.expanded) refreshIfNeeded();
  });
  document.addEventListener('notch:tabchange', (event) => {
    if (event.detail?.tab === 'home') refreshIfNeeded();
  });
  document.addEventListener('notch:home-layout-applied', refreshIfNeeded);

  const sizeObserver = new MutationObserver(refreshIfNeeded);
  sizeObserver.observe(tile, { attributes: true, attributeFilter: ['data-widget-size', 'hidden'] });

  window.PomeAlmanac = Object.freeze({
    render,
    setPreviewDate(value) {
      previewDate = value ? new Date(value) : null;
      render();
    },
  });

  render();
}());
