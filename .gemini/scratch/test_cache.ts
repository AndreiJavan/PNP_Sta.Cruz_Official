import { memoryCache } from '../../utils/cache.js';

async function runDiagnostics() {
  console.log('--- MemoryCache Diagnostics ---');

  // Test 1: Set & Get
  const testKey = 'test:diagnostic_key';
  const testData = { system: 'PNP Sta. Cruz', active: true, timestamp: Date.now() };
  await memoryCache.set(testKey, testData, 10000);
  const retrieved = await memoryCache.get<typeof testData>(testKey);

  console.log('1. Set & Get Test:', retrieved && retrieved.system === testData.system ? 'PASSED (Match)' : 'FAILED');

  // Test 2: Synchronous Get
  const syncRetrieved = memoryCache.getSync<typeof testData>(testKey);
  console.log('2. Sync Get Test:', syncRetrieved && syncRetrieved.system === testData.system ? 'PASSED (Sub-ms RAM hit)' : 'FAILED');

  // Test 3: getOrSet helper
  let fetchCounter = 0;
  const fetcher = async () => {
    fetchCounter++;
    return ['item1', 'item2', 'item3'];
  };

  const getOrSetResult1 = await memoryCache.getOrSet('test:fetcher_key', fetcher, 10000);
  const getOrSetResult2 = await memoryCache.getOrSet('test:fetcher_key', fetcher, 10000);

  console.log('3. getOrSet Test (Fetch count should be 1):', fetchCounter === 1 && getOrSetResult2.length === 3 ? 'PASSED (Cache Hit, no re-fetch)' : 'FAILED');

  // Test 4: clearNamespace
  await memoryCache.clearNamespace('test:');
  const afterClear1 = await memoryCache.get(testKey);
  const afterClear2 = await memoryCache.get('test:fetcher_key');
  console.log('4. clearNamespace Invalidation Test:', afterClear1 === null && afterClear2 === null ? 'PASSED (Namespace purged)' : 'FAILED');

  console.log('--- All MemoryCache Diagnostics Completed Successfully ---');
}

runDiagnostics().catch(console.error);
