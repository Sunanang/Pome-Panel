const pomeLocaleRendererSunWidget = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;
(function mountSunWidget() {
  const tile = document.getElementById('home-sun');
  const Sun = window.NotchSun;
  if (!tile || !Sun) return;

  const LOCATION_KEY = 'notch-sun-location-v1';
  const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.4-6-10.5a6 6 0 0 1 12 0C18 15.6 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2"/></svg>';
  const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  const COLORS = { night: '#3A4A6E', blue: '#438CFF', gold: '#FF9352', day: '#FFE3A8', core: '#FFE7B4' };
  const DOT = { blue: COLORS.blue, gold: COLORS.gold, day: COLORS.day };
  let previewNow = null;
  let panelOpen = false;
  let manualOpen = false;
  let arcSeq = 0;
  let timer = 0;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function loadLocation() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCATION_KEY) || 'null');
      if (!parsed || !Number.isFinite(Number(parsed.lat)) || !Number.isFinite(Number(parsed.lng))) return null;
      return {
        source: parsed.source === 'manual' ? 'manual' : 'city',
        id: parsed.id || '',
        en: parsed.source !== 'manual' ? (window.POME_CITIES || []).find?.(city => city.id === parsed.id)?.en : undefined,
        name: String(parsed.name || pomeLocaleRendererSunWidget.t("copy.customLocation.915d7b")),
        admin: String(parsed.admin || ''),
        lat: Number(parsed.lat),
        lng: Number(parsed.lng),
        tz: parsed.tz || null,
      };
    } catch (error) {
      return null;
    }
  }

  function defaultCity() {
    return Sun.suggestCity(cities(), Intl.DateTimeFormat().resolvedOptions().timeZone)
      || cities().find((city) => city.name === '上海' || city.en === 'Shanghai')
      || null;
  }

  function seedDefaultLocation() {
    const city = defaultCity();
    const next = city ? Sun.locationFromCity(city) : null;
    if (!next) return null;
    try {
      localStorage.setItem(LOCATION_KEY, JSON.stringify(next));
    } catch (error) {
      // Keep the in-memory default even if LocalStorage is unavailable.
    }
    return next;
  }

  // First launch should show Shanghai (or the timezone suggestion) immediately —
  // never the empty “set location” card. Clearing location in tests still works.
  let location = loadLocation() || seedDefaultLocation();

  function saveLocation(next, persist) {
    location = next;
    if (persist !== false) {
      try {
        if (next) localStorage.setItem(LOCATION_KEY, JSON.stringify(next));
        else localStorage.removeItem(LOCATION_KEY);
      } catch (error) {
        // 位置只活在当前会话里也可以继续显示。
      }
    }
    render();
  }

  function nowDate() {
    return previewNow ? new Date(previewNow.getTime()) : new Date();
  }

  function timeZoneFor(place) {
    return (place && place.tz) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }

  function cities() {
    return Array.isArray(window.POME_CITIES) ? window.POME_CITIES : [];
  }

  function durationHtml(parts) {
    return (parts || []).map((part) => `<b>${part.n}</b><i>${escapeHtml(part.u)}</i>`).join('');
  }

  function altAt(samples, minute) {
    if (!samples.length) return 0;
    if (minute <= samples[0][0]) return samples[0][1];
    const last = samples[samples.length - 1];
    if (minute >= last[0]) return last[1];
    let index = 0;
    while (index < samples.length - 2 && samples[index + 1][0] < minute) index += 1;
    const left = samples[index];
    const right = samples[index + 1];
    const span = right[0] - left[0] || 1;
    return left[1] + ((right[1] - left[1]) * (minute - left[0])) / span;
  }

  function arcSvg(model, size) {
    const spec = Sun.ARC[size] || Sun.ARC.medium;
    const id = `sunarc${arcSeq += 1}`;
    const { w, h, hy, kUp, clamp } = spec;
    const start = model.arc.start;
    const end = model.arc.end;
    const span = Math.max(1, end - start);
    const xOf = (minute) => ((minute - start) / span) * w;
    const yOf = (altitude) => hy - (altitude >= 0 ? altitude : clamp * Math.tanh(altitude / clamp)) * kUp;
    const points = [];
    for (let minute = start; minute <= end + 0.01; minute += 3) {
      points.push([xOf(minute), yOf(altAt(model.arc.samples, minute))]);
    }
    const line = `M${points.map((point) => `${point[0].toFixed(2)} ${point[1].toFixed(2)}`).join(' L')}`;
    const area = `${line} L${w} ${hy} L0 ${hy} Z`;
    const off = (minute) => Math.max(0, Math.min(1, (minute - start) / span));
    const stops = [];
    const pushStop = (minute, color) => {
      if (minute == null) return;
      stops.push(`<stop offset="${off(minute).toFixed(4)}" stop-color="${color}"/>`);
    };
    const marks = model.marks;
    if (model.polar === 'up') {
      stops.push(`<stop offset="0" stop-color="${COLORS.day}"/><stop offset="1" stop-color="${COLORS.day}"/>`);
    } else if (model.polar === 'down') {
      stops.push(`<stop offset="0" stop-color="${COLORS.night}"/><stop offset="1" stop-color="${COLORS.night}"/>`);
    } else {
      pushStop(marks.dawn == null ? start : marks.dawn - 6, COLORS.night);
      pushStop(marks.dawn == null ? start : marks.dawn + 6, COLORS.blue);
      pushStop(marks.sunrise == null ? start : marks.sunrise - 6, COLORS.blue);
      pushStop(marks.sunrise == null ? start : marks.sunrise + 6, COLORS.gold);
      pushStop(marks.goldenHourEnd == null ? start : marks.goldenHourEnd - 9, COLORS.gold);
      pushStop(marks.goldenHourEnd == null ? start : marks.goldenHourEnd + 9, COLORS.day);
      pushStop(marks.goldenHour == null ? end : marks.goldenHour - 9, COLORS.day);
      pushStop(marks.goldenHour == null ? end : marks.goldenHour + 9, COLORS.gold);
      pushStop(marks.sunset == null ? end : marks.sunset - 6, COLORS.gold);
      pushStop(marks.sunset == null ? end : marks.sunset + 6, COLORS.blue);
      pushStop(marks.dusk == null ? end : marks.dusk - 6, COLORS.blue);
      pushStop(marks.dusk == null ? end : marks.dusk + 6, COLORS.night);
    }
    const nx = xOf(model.nowMin);
    const nAlt = model.altitude;
    const ny = yOf(nAlt);
    const up = nAlt >= -0.83 && model.polar !== 'down';
    const r = spec.markerR;
    let dots = '';
    if (spec.dots) {
      Sun.EVENT_ORDER.forEach((key) => {
        const event = model.events[key];
        if (!event) return;
        dots += `<circle cx="${xOf(event.minute).toFixed(2)}" cy="${yOf(altAt(model.arc.samples, event.minute)).toFixed(2)}" r="${spec.dots}" fill="${DOT[event.dot]}" stroke="#16161A" stroke-width="1.6"/>`;
      });
    }
    let labels = '';
    if (spec.labels && model.solarNoon && model.events.sunrise && model.events.sunset) {
      const noonX = xOf(model.solarNoon.minute);
      const noonY = yOf(model.solarNoon.altitude);
      labels += ("<text x=\"" + (noonX.toFixed(1)) + "\" y=\"" + ((noonY - 11).toFixed(1)) + "\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"500\" fill=\"#A1A1A1\">" + (pomeLocaleRendererSunWidget.t("copy.noon.c5818b", { arg3: (escapeHtml(model.solarNoon.hm)), arg4: (Math.round(model.solarNoon.altitude)) })) + "</text>");
      labels += ("<text x=\"" + ((xOf(model.events.sunrise.minute) + 6).toFixed(1)) + "\" y=\"" + (hy + 16) + "\" font-size=\"10.5\" font-weight=\"500\" fill=\"#A1A1A1\">" + (pomeLocaleRendererSunWidget.t("copy.sunrise.b02283", { arg3: (escapeHtml(model.events.sunrise.hm)) })) + "</text>");
      labels += ("<text x=\"" + ((xOf(model.events.sunset.minute) - 6).toFixed(1)) + "\" y=\"" + (hy + 16) + "\" text-anchor=\"end\" font-size=\"10.5\" font-weight=\"500\" fill=\"#A1A1A1\">" + (pomeLocaleRendererSunWidget.t("copy.sunset.e8f4ac", { arg3: (escapeHtml(model.events.sunset.hm)) })) + "</text>");
    }
    // Design B：small/medium/large 把 HH:MM 挂在太阳旁；mini 太矮改走底部一行
    if (size !== 'mini') {
      const place = Sun.placeNowLabel({
        size,
        skySide: model.skySide,
        nx,
        ny,
        up,
        markerR: r,
        width: w,
      });
      const nowText = escapeHtml(model.nowHM || '--:--');
      labels += `<text class="sun-now${place.night ? ' is-night' : ''}" x="${place.x.toFixed(1)}" y="${place.y.toFixed(1)}" text-anchor="${place.anchor}" font-size="${place.fontSize}" font-weight="600">${nowText}</text>`;
    }
    const drop = spec.drop && up
      ? `<line x1="${nx.toFixed(2)}" y1="${(ny + r + 2).toFixed(2)}" x2="${nx.toFixed(2)}" y2="${hy}" stroke="rgba(255,231,180,.38)" stroke-width="1" stroke-dasharray="2 2.5"/>`
      : '';
    const marker = up
      ? `<circle class="sun-marker" cx="${nx.toFixed(2)}" cy="${ny.toFixed(2)}" r="${(r * 3.4).toFixed(2)}" fill="url(#${id}h)"/><circle cx="${nx.toFixed(2)}" cy="${ny.toFixed(2)}" r="${r}" fill="${COLORS.core}" stroke="rgba(20,20,24,.6)" stroke-width="1"/>`
      : `<circle class="sun-marker is-night" cx="${nx.toFixed(2)}" cy="${ny.toFixed(2)}" r="${r}" fill="#16161A" stroke="#A1A1A1" stroke-width="1.4"/>`;
    return ("<svg class=\"sun-arc\" width=\"" + (w) + "\" height=\"" + (h) + "\" viewBox=\"0 0 " + (w) + " " + (h) + "\" role=\"img\" aria-label=\"" + (pomeLocaleRendererSunWidget.attribute("copy.sunPath.21e265")) + "\" data-i18n-aria-label=\"copy.sunPath.21e265\">\n      <defs>\n        <linearGradient id=\"" + (id) + "g\" gradientUnits=\"userSpaceOnUse\" x1=\"0\" y1=\"0\" x2=\"" + (w) + "\" y2=\"0\">" + (stops.join('')) + "</linearGradient>\n        <linearGradient id=\"" + (id) + "v\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff\" stop-opacity=\".16\"/><stop offset=\"1\" stop-color=\"#fff\" stop-opacity=\".02\"/></linearGradient>\n        <mask id=\"" + (id) + "m\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"" + (w) + "\" height=\"" + (hy) + "\"><rect x=\"0\" y=\"" + (hy - 54 * kUp) + "\" width=\"" + (w) + "\" height=\"" + (54 * kUp) + "\" fill=\"url(#" + (id) + "v)\"/></mask>\n        <clipPath id=\"" + (id) + "up\"><rect x=\"-2\" y=\"-40\" width=\"" + (w + 4) + "\" height=\"" + (hy + 40) + "\"/></clipPath>\n        <clipPath id=\"" + (id) + "past\"><rect x=\"-4\" y=\"-40\" width=\"" + (nx + 4) + "\" height=\"" + (h + 80) + "\"/></clipPath>\n        <radialGradient id=\"" + (id) + "h\"><stop offset=\"0\" stop-color=\"" + (COLORS.core) + "\" stop-opacity=\".55\"/><stop offset=\".45\" stop-color=\"" + (COLORS.gold) + "\" stop-opacity=\".18\"/><stop offset=\"1\" stop-color=\"" + (COLORS.gold) + "\" stop-opacity=\"0\"/></radialGradient>\n      </defs>\n      <g clip-path=\"url(#" + (id) + "up)\"><path d=\"" + (area) + "\" fill=\"url(#" + (id) + "g)\" mask=\"url(#" + (id) + "m)\" opacity=\".9\"/></g>\n      <line x1=\"0\" y1=\"" + (hy) + "\" x2=\"" + (w) + "\" y2=\"" + (hy) + "\" stroke=\"rgba(255,255,255,.16)\" stroke-width=\"1\"/>\n      <path d=\"" + (line) + "\" fill=\"none\" stroke=\"url(#" + (id) + "g)\" stroke-width=\"" + (spec.sw) + "\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\".38\"/>\n      <path d=\"" + (line) + "\" fill=\"none\" stroke=\"url(#" + (id) + "g)\" stroke-width=\"" + (spec.sw) + "\" stroke-linecap=\"round\" stroke-linejoin=\"round\" clip-path=\"url(#" + (id) + "past)\"/>\n      " + (dots) + (drop) + (marker) + (labels) + "\n    </svg>");
  }

  function placeButton(name, compact) {
    const label = escapeHtml(name);
    if (compact) return ("<button class=\"sun-place sun-place-mini\" type=\"button\" data-sun-place aria-label=\"" + (pomeLocaleRendererSunWidget.attribute("copy.changeLocation.f4de01", { arg1: (label) })) + "\">" + (PIN) + "<span>" + (label) + "</span></button>");
    return ("<button class=\"sun-place\" type=\"button\" data-sun-place aria-label=\"" + (pomeLocaleRendererSunWidget.attribute("copy.changeLocation.f4de01", { arg1: (label) })) + "\">" + (PIN) + "<span>" + (label) + "</span>" + (CHEV) + "</button>");
  }

  function countdownBits(model) {
    if (model.polar === 'up') return { lead: pomeLocaleRendererSunWidget.t("copy.polarDay.389f33"), num: ("<b><span data-i18n=\"copy.allDay.0b97c8\">" + (pomeLocaleRendererSunWidget.t("copy.allDay.0b97c8")) + "</span></b>") };
    if (model.polar === 'down') return { lead: pomeLocaleRendererSunWidget.t("copy.polarNight.896aca"), num: ("<b><span data-i18n=\"copy.allDay.0b97c8\">" + (pomeLocaleRendererSunWidget.t("copy.allDay.0b97c8")) + "</span></b>") };
    if (!model.next) return { lead: pomeLocaleRendererSunWidget.t("copy.noMoreDaylightEventsToday.f1817d"), num: '' };
    return {
      lead: pomeLocaleRendererSunWidget.t("copy.until.bca998", { arg1: (escapeHtml(model.next.lead)) }),
      num: durationHtml(Sun.durationParts(model.next.delta)),
    };
  }

  function countdownBlock(model) {
    const bits = countdownBits(model);
    return `<div class="sun-count"><span class="lead">${bits.lead}</span>${bits.num ? `<div class="num">${bits.num}</div>` : ''}</div>`;
  }

  function durationInline(parts) {
    return (parts || []).map((part) => `${part.n}<i>${escapeHtml(part.u)}</i>`).join('');
  }

  function renderBody(model, size) {
    const place = placeButton(location.source === 'manual' ? location.name : Sun.cityLabel({ ...location, admin: '' }), size === 'mini');
    if (size === 'mini') {
      const miniLead = {
        dawn: pomeLocaleRendererSunWidget.t("copy.dawn.436dc0"),
        sunrise: pomeLocaleRendererSunWidget.t("copy.sunrise.3ca0d8"),
        goldenHourEnd: pomeLocaleRendererSunWidget.t("copy.goldenHour.020aea"),
        goldenHour: pomeLocaleRendererSunWidget.t("copy.goldenHour.020aea"),
        sunset: pomeLocaleRendererSunWidget.t("copy.sunset.67995f"),
        dusk: pomeLocaleRendererSunWidget.t("copy.dusk.451eb6"),
        tomorrowDawn: pomeLocaleRendererSunWidget.t("copy.dawnTomorrow.0a3920"),
      };
      const lead = model.polar === 'up'
        ? pomeLocaleRendererSunWidget.t("copy.polarDay.389f33")
        : model.polar === 'down'
          ? pomeLocaleRendererSunWidget.t("copy.polarNight.896aca")
          : model.next
            ? pomeLocaleRendererSunWidget.t("copy.until.bca998", { arg1: (escapeHtml(miniLead[model.next.key] || model.next.lead)) })
            : pomeLocaleRendererSunWidget.t("copy.sunriseSunset.224064");
      const num = model.polar ? ("<b><span data-i18n=\"copy.allDay.0b97c8\">" + (pomeLocaleRendererSunWidget.t("copy.allDay.0b97c8")) + "</span></b>") : model.next ? durationHtml(Sun.durationParts(model.next.delta)) : '';
      const rise = model.events.sunrise ? model.events.sunrise.hm : '--:--';
      const set = model.events.sunset ? model.events.sunset.hm : '--:--';
      const nowHM = model.nowHM || '--:--';
      return ("<div class=\"sun-mini-top\"><span class=\"lead\">" + (lead) + "</span>" + (place) + "</div>\n        <div class=\"sun-count\"><div class=\"num\">" + (num) + "</div></div>\n        <div class=\"sun-arc-wrap\">" + (arcSvg(model, size)) + "</div>\n        <div class=\"sun-mini-foot\"><span class=\"edge edge-rise\"><span class=\"lbl\"><span data-i18n=\"copy.sunrise.3ca0d8\">" + (pomeLocaleRendererSunWidget.t("copy.sunrise.3ca0d8")) + "</span></span><b>" + (escapeHtml(rise)) + "</b></span><span class=\"now\"><b>" + (escapeHtml(nowHM)) + "</b></span><span class=\"edge edge-set\"><span class=\"lbl\"><span data-i18n=\"copy.sunset.67995f\">" + (pomeLocaleRendererSunWidget.t("copy.sunset.67995f")) + "</span></span><b>" + (escapeHtml(set)) + "</b></span></div>");
    }
    if (size === 'small') {
      const rows = model.upcoming.map((item, index) => (
        `<li class="${index === 0 ? 'next' : ''}"><span>${escapeHtml(item.name)}</span><b>${escapeHtml(item.hm)}</b></li>`
      )).join('');
      return ("<div class=\"sun-head\"><span class=\"tile-label\"><span data-i18n=\"copy.sunriseSunset.224064\">" + (pomeLocaleRendererSunWidget.t("copy.sunriseSunset.224064")) + "</span></span>" + (place) + "</div>\n        " + (countdownBlock(model)) + "\n        <div class=\"sun-arc-wrap\">" + (arcSvg(model, size)) + "</div>\n        <ul class=\"sun-next-list\">" + (rows) + "</ul>");
    }
    if (size === 'medium') {
      const nextKey = model.next && model.next.key;
      const times = Sun.EVENT_ORDER.map((key, index) => {
        const event = model.events[key];
        if (!event) return '';
        const state = key === nextKey ? 'next' : event.delta <= 0 ? 'past' : '';
        return `<div class="sun-time ${state}${index === 5 ? ' end' : ''}"><span>${escapeHtml(event.name)}</span><b>${escapeHtml(event.hm)}</b></div>`;
      }).join('');
      const length = model.dayLengthParts ? durationInline(model.dayLengthParts) : '--';
      return ("<div class=\"sun-head\"><span class=\"tile-label\"><span data-i18n=\"copy.sunriseSunset.224064\">" + (pomeLocaleRendererSunWidget.t("copy.sunriseSunset.224064")) + "</span></span>" + (place) + "</div>\n        <div class=\"sun-hero\">" + (countdownBlock(model)) + "<div class=\"sun-daylen\"><span><span data-i18n=\"copy.daylightDuration.261de2\">" + (pomeLocaleRendererSunWidget.t("copy.daylightDuration.261de2")) + "</span></span><b>" + (length) + "</b></div></div>\n        <div class=\"sun-arc-wrap\">" + (arcSvg(model, size)) + "</div>\n        <div class=\"sun-times\">" + (times) + "</div>");
    }
    const nextKey = model.next && model.next.key;
    const row = (key) => {
      const event = model.events[key];
      if (!event) return '';
      const state = key === nextKey ? 'next' : event.delta <= 0 ? 'past' : '';
      const rel = event.delta <= 0 ? pomeLocaleRendererSunWidget.t("copy.passed.d1c296") : pomeLocaleRendererSunWidget.t("copy.in.228a09", { arg1: (Sun.durationText(event.delta)) });
      const gradient = {
        dawn: `${COLORS.night}, ${COLORS.blue}`,
        sunrise: `${COLORS.blue}, ${COLORS.gold}`,
        goldenHourEnd: `${COLORS.gold}, ${COLORS.day}`,
        goldenHour: `${COLORS.day}, ${COLORS.gold}`,
        sunset: `${COLORS.gold}, ${COLORS.blue}`,
        dusk: `${COLORS.blue}, ${COLORS.night}`,
      }[key] || `${COLORS.gold}, ${COLORS.day}`;
      return `<li class="${state}"><i class="chip" style="background:linear-gradient(90deg,${gradient})"></i><div class="nm"><span>${escapeHtml(event.name)}</span>${event.note ? `<small>${escapeHtml(event.note)}</small>` : ''}</div><div class="tm"><b>${escapeHtml(event.hm)}</b><small>${escapeHtml(rel)}</small></div></li>`;
    };
    let sub = '';
    if (model.sub && model.sub.kind === 'sunset') {
      sub = ("<span class=\"sub\"><span data-i18n=\"copy.sunset.67995f\">" + (pomeLocaleRendererSunWidget.t("copy.sunset.67995f")) + " </span><b>" + (escapeHtml(model.sub.hm)) + "</b> " + (pomeLocaleRendererSunWidget.t("copy.remaining.6ae7c6", { arg2: (durationInline(model.sub.parts)) })) + "</span>");
    } else if (model.sub && model.sub.kind === 'tomorrow') {
      sub = ("<span class=\"sub\"><span data-i18n=\"copy.sunriseTomorrow.f333d2\">" + (pomeLocaleRendererSunWidget.t("copy.sunriseTomorrow.f333d2")) + " </span><b>" + (escapeHtml(model.sub.hm)) + "</b></span>");
    }
    const bits = countdownBits(model);
    const delta = model.deltaVsYesterday;
    const deltaHtml = !delta
      ? '<b>--</b>'
      : ("<b>" + (delta.sign) + (delta.minutes) + "<i><span data-i18n=\"copy.min.b6a993\">" + (pomeLocaleRendererSunWidget.t("copy.min.b6a993")) + "</span></i>" + (delta.seconds ? ((delta.seconds) + "<i><span data-i18n=\"copy.sec.9dcdc2\">" + (pomeLocaleRendererSunWidget.t("copy.sec.9dcdc2")) + "</span></i>") : '') + "</b>");
    const length = model.dayLengthParts ? `<b>${durationInline(model.dayLengthParts)}</b>` : '<b>--</b>';
    return ("<div class=\"sun-head\"><span class=\"tile-label\"><span data-i18n=\"copy.sunriseSunset.224064\">" + (pomeLocaleRendererSunWidget.t("copy.sunriseSunset.224064")) + "</span><span class=\"date\">" + (escapeHtml(model.dateLabel)) + "</span></span>" + (place) + "</div>\n      <div class=\"sun-hero\"><div class=\"sun-count\"><span class=\"lead\">" + (bits.lead) + "</span>" + (bits.num ? `<div class="num">${bits.num}</div>` : '') + (sub) + "</div></div>\n      <div class=\"sun-arc-wrap\">" + (arcSvg(model, size)) + "</div>\n      <div class=\"sun-groups\">\n        <div class=\"sun-group\"><h4><span data-i18n=\"copy.morning.119af5\">" + (pomeLocaleRendererSunWidget.t("copy.morning.119af5")) + "</span></h4><ol>" + (['dawn', 'sunrise', 'goldenHourEnd'].map(row).join('')) + "</ol></div>\n        <div class=\"sun-group\"><h4><span data-i18n=\"copy.evening.1bd701\">" + (pomeLocaleRendererSunWidget.t("copy.evening.1bd701")) + "</span></h4><ol>" + (['goldenHour', 'sunset', 'dusk'].map(row).join('')) + "</ol></div>\n      </div>\n      <div class=\"sun-stats\">\n        <div><span><span data-i18n=\"copy.daylightDuration.261de2\">" + (pomeLocaleRendererSunWidget.t("copy.daylightDuration.261de2")) + "</span></span>" + (length) + "</div>\n        <div><span><span data-i18n=\"copy.comparedWithYesterday.4a18fa\">" + (pomeLocaleRendererSunWidget.t("copy.comparedWithYesterday.4a18fa")) + "</span></span>" + (deltaHtml) + "</div>\n        <div><span><span data-i18n=\"copy.sunriseTomorrow.f333d2\">" + (pomeLocaleRendererSunWidget.t("copy.sunriseTomorrow.f333d2")) + "</span></span><b>" + (escapeHtml(model.tomorrow.sunrise || '--:--')) + "</b></div>\n      </div>");
  }

  function emptyHtml(size) {
    const suggestion = Sun.suggestCity(cities(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    const suggest = suggestion
      ? ("<button class=\"sun-suggest\" type=\"button\" data-sun-suggest=\"" + (escapeHtml(suggestion.id)) + "\">" + (pomeLocaleRendererSunWidget.t("copy.suggested.329c8b", { arg2: (escapeHtml(Sun.cityLabel(suggestion))) })) + "</button>")
      : '';
    return ("<div class=\"sun-empty\">\n      <p><span data-i18n=\"copy.chooseACityForSunriseAndSunset.e180c5\">" + (pomeLocaleRendererSunWidget.t("copy.chooseACityForSunriseAndSunset.e180c5")) + "</span></p>\n      <div class=\"sun-empty-actions\">\n        " + (suggest) + "\n        <button class=\"sun-set\" type=\"button\" data-sun-place>" + (pomeLocaleRendererSunWidget.t("copy.setLocation.52980e", { arg2: (PIN) })) + "</button>\n      </div>\n    </div>");
  }

  function syncGlow() {
    const marker = tile.querySelector('.sun-marker');
    if (!marker) return;
    const tileRect = tile.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    if (!tileRect.width || !tileRect.height) return;
    const x = ((markerRect.left + markerRect.width / 2 - tileRect.left) / tileRect.width) * 100;
    const y = ((markerRect.top + markerRect.height / 2 - tileRect.top) / tileRect.height) * 100 + 12;
    tile.style.setProperty('--glow-x', `${x.toFixed(1)}%`);
    tile.style.setProperty('--glow-y', `${y.toFixed(1)}%`);
  }

  window.addEventListener('pome:language-changed', () => { render(); });

  function render() {
    const size = tile.dataset.widgetSize || 'medium';
    if (!location) {
      tile.dataset.phase = 'night';
      tile.dataset.skySide = 'west';
      tile.innerHTML = `<div class="sun-sky" aria-hidden="true"><img src="${Sun.skyAsset(size, 'night')}" alt="" draggable="false"></div>${emptyHtml(size)}`;
    } else {
      const model = Sun.buildSunModel({
        lat: location.lat,
        lng: location.lng,
        timeZone: timeZoneFor(location),
        now: nowDate(),
      });
      tile.dataset.phase = model.phase;
      tile.dataset.skySide = model.skySide;
      tile.innerHTML = `<div class="sun-sky" aria-hidden="true"><img src="${Sun.skyAsset(size, model.phase)}" alt="" draggable="false"></div>${renderBody(model, size)}`;
      requestAnimationFrame(syncGlow);
    }
    // Refresh the card without rebuilding/refocusing the user's open form.
    if (panelOpen) positionPanel();
    schedule();
  }

  function resultRows(query) {
    const list = cities();
    const matches = query ? Sun.searchCities(list, query, 8) : [];
    const suggestion = Sun.suggestCity(list, Intl.DateTimeFormat().resolvedOptions().timeZone);
    const rows = [];
    if (!query && suggestion && (!location || location.id !== suggestion.id)) {
      rows.push({ city: suggestion, hint: pomeLocaleRendererSunWidget.t("copy.suggested.abee49") });
    }
    matches.forEach((city) => rows.push({ city, hint: '' }));
    if (!rows.length) return ("<li class=\"sun-loc-empty\"><span data-i18n=\"copy.noMatchingCities.8f4f9c\">" + (pomeLocaleRendererSunWidget.t("copy.noMatchingCities.8f4f9c")) + "</span></li>");
    return rows.map(({ city, hint }) => {
      const selected = location && location.id === city.id;
      return `<li><button type="button" data-sun-city="${escapeHtml(city.id)}" class="${selected ? 'on' : ''}"><span>${escapeHtml(Sun.cityLabel(city))}${hint ? `<small>${hint}</small>` : ''}</span><small>${city.lat.toFixed(2)}°, ${city.lng.toFixed(2)}°</small></button></li>`;
    }).join('');
  }

  function canShowPanel() {
    const surface = document.getElementById('app');
    return surface?.classList.contains('expanded') && !surface.classList.contains('closing')
      && !tile.hidden && document.getElementById('tab-home')?.classList.contains('active');
  }

  function positionPanel() {
    if (!panelOpen) return;
    if (!canShowPanel()) { closePanel(); return; }
    const pop = document.getElementById('sun-location-popover');
    if (!pop) return;
    const style = getComputedStyle(pop);
    const gap = parseFloat(style.getPropertyValue('--sun-popover-gap'));
    const maxHeight = parseFloat(style.getPropertyValue('--sun-popover-height'));
    const panel = document.getElementById('panel').getBoundingClientRect();
    const bounds = {
      left: Math.max(gap, panel.left + gap),
      right: Math.min(window.innerWidth - gap, panel.right - gap),
      top: Math.max(gap, panel.top + gap),
      bottom: Math.min(window.innerHeight - gap, panel.bottom - gap),
    };
    const availableWidth = bounds.right - bounds.left;
    const availableHeight = bounds.bottom - bounds.top;
    if (availableWidth <= 0 || availableHeight <= 0) { closePanel(); return; }
    pop.style.maxWidth = `${availableWidth}px`;
    pop.style.maxHeight = `${Math.min(maxHeight, availableHeight)}px`;
    const rect = (tile.querySelector('[data-sun-place]') || tile).getBoundingClientRect();
    const { width, height } = pop.getBoundingClientRect();
    const below = bounds.bottom - rect.bottom - gap;
    const above = rect.top - gap - bounds.top;
    const top = below >= height || below >= above ? rect.bottom + gap : rect.top - gap - height;
    pop.style.left = `${Math.max(bounds.left, Math.min(bounds.right - width, rect.right - width))}px`;
    pop.style.top = `${Math.max(bounds.top, Math.min(bounds.bottom - height, top))}px`;
  }

  function openPanel(preset) {
    if (!canShowPanel()) return;
    panelOpen = true;
    let pop = document.getElementById('sun-location-popover');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'sun-location-popover';
      pop.className = 'sun-popover';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', pomeLocaleRendererSunWidget.t("copy.setSunriseAndSunsetLocation.bee9a1"));
      document.body.appendChild(pop);
    }
    const value = preset == null ? '' : preset;
    pop.innerHTML = ("<label class=\"sun-search\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" aria-hidden=\"true\"><circle cx=\"11\" cy=\"11\" r=\"6\"/><path d=\"m20 20-4.2-4.2\"/></svg><input id=\"sun-city-query\" type=\"text\" placeholder=\"" + (pomeLocaleRendererSunWidget.attribute("copy.searchCities.a40a92")) + "\" data-i18n-placeholder=\"copy.searchCities.a40a92\" autocomplete=\"off\" spellcheck=\"false\" aria-label=\"" + (pomeLocaleRendererSunWidget.attribute("copy.searchCities.a40a92")) + "\" data-i18n-aria-label=\"copy.searchCities.a40a92\" value=\"" + (escapeHtml(value)) + "\"></label>\n      <ul id=\"sun-city-results\">" + (resultRows(value)) + "</ul>\n      <div class=\"sep\"></div>\n      <button class=\"sun-manual-toggle\" type=\"button\" data-sun-manual aria-expanded=\"" + (manualOpen ? 'true' : 'false') + "\"><span data-i18n=\"copy.canTFindMyCity.ba0eac\">" + (pomeLocaleRendererSunWidget.t("copy.canTFindMyCity.ba0eac")) + "</span></button>\n      <form class=\"sun-manual\" data-sun-manual-form " + (manualOpen ? '' : 'hidden') + ">\n        <label><span data-i18n=\"copy.latitude.9c11bd\">" + (pomeLocaleRendererSunWidget.t("copy.latitude.9c11bd")) + "</span><input name=\"lat\" inputmode=\"decimal\" placeholder=\"31.23\" aria-label=\"" + (pomeLocaleRendererSunWidget.attribute("copy.latitude.9c11bd")) + "\" data-i18n-aria-label=\"copy.latitude.9c11bd\"></label>\n        <label><span data-i18n=\"copy.longitude.69f788\">" + (pomeLocaleRendererSunWidget.t("copy.longitude.69f788")) + "</span><input name=\"lng\" inputmode=\"decimal\" placeholder=\"121.47\" aria-label=\"" + (pomeLocaleRendererSunWidget.attribute("copy.longitude.69f788")) + "\" data-i18n-aria-label=\"copy.longitude.69f788\"></label>\n        <label><span data-i18n=\"copy.name.d44e9b\">" + (pomeLocaleRendererSunWidget.t("copy.name.d44e9b")) + "</span><input name=\"name\" maxlength=\"24\" placeholder=\"" + (pomeLocaleRendererSunWidget.attribute("copy.optional.537352")) + "\" data-i18n-placeholder=\"copy.optional.537352\" aria-label=\"" + (pomeLocaleRendererSunWidget.attribute("copy.locationName.1e1d6f")) + "\" data-i18n-aria-label=\"copy.locationName.1e1d6f\"></label>\n        <button type=\"submit\"><span data-i18n=\"copy.useThisLocation.2887bb\">" + (pomeLocaleRendererSunWidget.t("copy.useThisLocation.2887bb")) + "</span></button>\n        <p class=\"sun-manual-error\" data-sun-manual-error hidden></p>\n      </form>\n      <p class=\"foot\"><span data-i18n=\"copy.locationIsStoredOnThisDeviceOnly.3bc25b\">" + (pomeLocaleRendererSunWidget.t("copy.locationIsStoredOnThisDeviceOnly.3bc25b")) + "</span></p>");
    pop.hidden = false;
    pop.scrollTop = 0;
    positionPanel();
    if (!panelOpen) return;
    const input = document.getElementById('sun-city-query');
    const caret = input.value.length;
    input.focus({ preventScroll: true });
    input.setSelectionRange(caret, caret);
  }

  function closePanel() {
    panelOpen = false;
    manualOpen = false;
    const pop = document.getElementById('sun-location-popover');
    if (pop) {
      if (pop.contains(document.activeElement)) document.activeElement.blur();
      pop.hidden = true;
      pop.replaceChildren();
    }
  }

  function applyCity(city, persist) {
    const next = Sun.locationFromCity(city);
    if (!next) return;
    closePanel();
    saveLocation(next, persist);
  }

  tile.addEventListener('click', (event) => {
    const suggest = event.target.closest('[data-sun-suggest]');
    if (suggest) {
      event.preventDefault();
      event.stopPropagation();
      const city = cities().find((item) => item.id === suggest.dataset.sunSuggest);
      if (city) applyCity(city, true);
      return;
    }
    const place = event.target.closest('[data-sun-place]');
    if (!place) return;
    event.preventDefault();
    event.stopPropagation();
    if (panelOpen) closePanel();
    else openPanel('');
  });

  document.addEventListener('click', (event) => {
    const pop = document.getElementById('sun-location-popover');
    if (!panelOpen || !pop || pop.hidden) return;
    if (pop.contains(event.target) || tile.contains(event.target)) return;
    closePanel();
  });

  document.addEventListener('input', (event) => {
    if (event.target.id !== 'sun-city-query') return;
    const results = document.getElementById('sun-city-results');
    if (results) results.innerHTML = resultRows(event.target.value);
    positionPanel();
  });

  document.addEventListener('click', (event) => {
    const cityButton = event.target.closest('[data-sun-city]');
    if (cityButton) {
      event.preventDefault();
      const city = cities().find((item) => item.id === cityButton.dataset.sunCity);
      if (city) applyCity(city, true);
      return;
    }
    const manual = event.target.closest('[data-sun-manual]');
    if (!manual) return;
    event.preventDefault();
    manualOpen = !manualOpen;
    const form = document.querySelector('[data-sun-manual-form]');
    if (form) form.hidden = !manualOpen;
    manual.setAttribute('aria-expanded', String(manualOpen));
    positionPanel();
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-sun-manual-form]');
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const parsed = Sun.parseManualLocation(data.get('lat'), data.get('lng'), data.get('name'));
    const error = form.querySelector('[data-sun-manual-error]');
    if (!parsed.ok) {
      if (error) {
        error.hidden = false;
        error.textContent = parsed.error;
      }
      positionPanel();
      return;
    }
    parsed.location.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    closePanel();
    saveLocation(parsed.location, true);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panelOpen) {
      event.stopPropagation();
      closePanel();
    }
  }, true);

  function schedule() {
    window.clearTimeout(timer);
    const now = nowDate();
    const wait = previewNow ? 60000 : (60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 30);
    timer = window.setTimeout(() => {
      render();
    }, Math.max(500, wait));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) closePanel();
    else render();
  });
  document.addEventListener('notch:will-collapse', closePanel);
  document.addEventListener('notch:modechange', (event) => {
    if (!event.detail?.expanded) closePanel();
  });
  document.addEventListener('notch:tabchange', (event) => {
    if (event.detail?.tab !== 'home') closePanel();
  });
  document.addEventListener('notch:home-layout-applied', positionPanel);
  window.addEventListener('blur', closePanel);
  window.addEventListener('resize', positionPanel);
  document.addEventListener('scroll', (event) => {
    if (!document.getElementById('sun-location-popover')?.contains(event.target)) positionPanel();
  }, true);
  window.addEventListener('focus', () => render());

  const sizeObserver = new MutationObserver(() => {
    if (tile.hidden) closePanel();
    render();
  });
  sizeObserver.observe(tile, { attributes: true, attributeFilter: ['data-widget-size', 'hidden'] });
  const surfaceObserver = new MutationObserver(() => {
    if (panelOpen && !canShowPanel()) closePanel();
  });
  surfaceObserver.observe(document.getElementById('app'), { attributes: true, attributeFilter: ['class'] });

  window.PomeSun = Object.freeze({
    render,
    setPreviewNow(value) {
      previewNow = value ? new Date(value) : null;
      render();
    },
    setLocation(next, options) {
      saveLocation(next, options && options.persist === false ? false : true);
    },
    openLocation(query) {
      openPanel(query || '');
      if (query) {
        const input = document.getElementById('sun-city-query');
        if (input) {
          input.value = query;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    },
    closeLocation: closePanel,
    getLocation: () => location && { ...location },
  });

  render();
})();
