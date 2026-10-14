(function (root) {
  function pagination(total, page, pageSize) {
    const count = Math.max(0, Math.trunc(Number(total) || 0));
    const size = Math.max(1, Math.trunc(Number(pageSize) || 1));
    const lastPage = Math.max(0, Math.ceil(count / size) - 1);
    const current = Math.max(0, Math.min(lastPage, Math.trunc(Number(page) || 0)));
    return { page: current, offset: current * size, limit: size, visible: count > size,
      previous: current > 0, next: (current + 1) * size < count, label: current > 0 ? `第 ${current + 1} 页` : '' };
  }
  const api = Object.freeze({ pagination });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotchTaskInboxDomain = api;
})(typeof window === 'object' ? window : globalThis);
