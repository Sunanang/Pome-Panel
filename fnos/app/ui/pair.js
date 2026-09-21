'use strict';

(function () {
  const statusEl = document.getElementById('pair-status');
  const codeEl = document.getElementById('pair-code');
  const listEl = document.getElementById('device-list');
  const emptyEl = document.getElementById('device-empty');
  let csrfToken = '';

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.dataset.kind = kind || '';
  }

  async function refreshCsrf() {
    const res = await fetch('/api/v1/pair/csrf', { credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(body.error || '无法获取 CSRF（需网关登录）', 'error');
      csrfToken = '';
      return false;
    }
    csrfToken = body.csrfToken || '';
    setStatus('CSRF 已就绪', 'ok');
    return true;
  }

  async function startPair() {
    if (!csrfToken) {
      const ok = await refreshCsrf();
      if (!ok) return;
    }
    const res = await fetch('/api/v1/pair/start', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: '{}',
    });
    const body = await res.json().catch(() => ({}));
    csrfToken = '';
    if (!res.ok) {
      setStatus(body.error || '生成失败', 'error');
      if (codeEl) codeEl.hidden = true;
      return;
    }
    if (codeEl) {
      codeEl.hidden = false;
      codeEl.textContent = body.pairingCode || '';
    }
    setStatus('配对码已生成（仅显示一次）', 'ok');
  }

  async function loadDevices() {
    const res = await fetch('/api/v1/devices', { credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    if (!listEl) return;
    listEl.innerHTML = '';
    const devices = (body && body.devices) || [];
    if (emptyEl) emptyEl.hidden = devices.length > 0;
    for (const device of devices) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = device.name || device.deviceId || '设备';
      if (device.insecureBound) {
        const badge = document.createElement('span');
        badge.className = 'badge-insecure';
        badge.textContent = '不安全绑定 / HTTP';
        label.appendChild(badge);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = '吊销';
      btn.addEventListener('click', async () => {
        await fetch(`/api/v1/devices/${encodeURIComponent(device.deviceId)}/revoke`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        await loadDevices();
      });
      li.appendChild(label);
      li.appendChild(btn);
      listEl.appendChild(li);
    }
  }

  const startBtn = document.getElementById('pair-start-btn');
  const csrfBtn = document.getElementById('pair-csrf-btn');
  if (startBtn) startBtn.addEventListener('click', () => { void startPair(); });
  if (csrfBtn) csrfBtn.addEventListener('click', () => { void refreshCsrf(); });
  void refreshCsrf();
  void loadDevices();
})();
