// Prisma model delegates (prisma.<model>.<method>) are Proxy-backed and their property
// descriptors don't satisfy node:test's `mock.method` (it reports "must be a method.
// Received undefined" even though the property works normally via get/set traps).
// This helper does a plain writable-property swap instead, restored via t.after, with
// call tracking compatible enough for the assertions used in these tests.
const mockProp = (t, obj, key, impl) => {
  const original = obj[key];
  const calls = [];

  const fn = async (...args) => {
    calls.push(args);
    return impl(...args);
  };
  fn.calls = calls;

  obj[key] = fn;
  t.after(() => {
    obj[key] = original;
  });

  return fn;
};

module.exports = { mockProp };
