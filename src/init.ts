// Safety shield for 'Cannot set property fetch of #<Window> which has only a getter'
if (typeof window !== 'undefined') {
  try {
    const targets = [
      window,
      (window as any).Window?.prototype,
      Object.getPrototypeOf(window),
      globalThis
    ];

    for (const target of targets) {
      if (!target) continue;
      
      const desc = Object.getOwnPropertyDescriptor(target, 'fetch');
      if (desc && desc.get && !desc.set) {
        try {
          Object.defineProperty(target, 'fetch', {
            get: desc.get,
            set: () => { /* Prevent error when library tries to assign to fetch */ },
            configurable: true,
            enumerable: true
          });
        } catch (innerErr) {
          // might be non-configurable
        }
      }
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
