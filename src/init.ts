// Safety shield for 'Cannot set property fetch of #<Window> which has only a getter'
if (typeof window !== 'undefined') {
  try {
    const proto = (window as any).Window?.prototype || window;
    const desc = Object.getOwnPropertyDescriptor(proto, 'fetch');
    if (desc && desc.get && !desc.set) {
      Object.defineProperty(proto, 'fetch', {
        get: desc.get,
        set: () => { /* Prevent error when library tries to assign to fetch */ },
        configurable: true,
        enumerable: true
      });
    }
    // Also polyfill process.version for libraries checking for Node
    (window as any).process = (window as any).process || {};
    (window as any).process.version = (window as any).process.version || 'v20.0.0';
    (window as any).process.env = (window as any).process.env || {};
  } catch (e) {
    // ignore
  }
}
export {};
