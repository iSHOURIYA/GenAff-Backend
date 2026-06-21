/**
 * Model Validator — Tests every model in MODEL_PRICING across all providers
 *
 * Usage: node scripts/validateModels.js
 *
 * This script makes real API calls to all providers with a tiny "ping" prompt.
 * It reports PASS/FAIL for each model and outputs a LIVE_MODELS_OVERRIDE string
 * containing only the working models.
 *
 * IMPORTANT: This costs real API credits. Total cost ≈ ₹2-5 for 29 models.
 */

require('dotenv').config();

const { callOpenAI } = require('../src/providers/openai');
const { callDeepSeek } = require('../src/providers/deepseek');
const { callGemini } = require('../src/providers/gemini');
const { callNvidia } = require('../src/providers/nvidia');
const { MODEL_PRICING, detectProvider } = require('../src/utils/pricing');

const PROVIDER_HANDLERS = {
  openai: callOpenAI,
  deepseek: callDeepSeek,
  gemini: callGemini,
  nvidia: callNvidia,
};

const TEST_PROMPT = 'Reply with exactly: PING';
const TEST_MAX_TOKENS = 4;
const TIMEOUT_MS = 15000;

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function color(text, c) {
  return `${COLORS[c]}${text}${COLORS.reset}`;
}

async function testModel(model) {
  const provider = detectProvider(model);
  const handler = PROVIDER_HANDLERS[provider];

  if (!handler) {
    return { model, provider, status: 'SKIP', error: 'No provider handler' };
  }

  try {
    const result = await Promise.race([
      handler({
        model,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        max_tokens: TEST_MAX_TOKENS,
        temperature: 0,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), TIMEOUT_MS)
      ),
    ]);

    if (result && result.data) {
      return { model, provider, status: 'PASS', tokens: result.tokensUsed };
    }
    return { model, provider, status: 'FAIL', error: 'Empty response' };
  } catch (err) {
    const isAuth = err.message?.includes('401') || err.message?.includes('Unauthorized');
    const isModelError = err.message?.includes('model') || err.response?.data?.error?.message?.includes('model');
    return {
      model,
      provider,
      status: 'FAIL',
      error: err.message || 'Unknown error',
      isAuth,
      isModelError,
    };
  }
}

async function main() {
  const models = Object.keys(MODEL_PRICING);

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║        GenAff Model Validator                            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`Testing ${models.length} models with a minimal prompt...\n`);

  const results = [];
  const startTime = Date.now();

  // Test sequentially to avoid rate limits
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const provider = detectProvider(model);
    process.stdout.write(`  ${String(i + 1).padStart(2)}/${models.length}  ${model.padEnd(30)}  [${provider.padEnd(8)}]  ... `);

    const result = await testModel(model);
    results.push(result);

    if (result.status === 'PASS') {
      console.log(color('✔ PASS', 'green'), `  ${result.tokens} tokens`);
    } else if (result.status === 'SKIP') {
      console.log(color('⊘ SKIP', 'yellow'), `  ${result.error}`);
    } else {
      const errShort = result.error.length > 60 ? result.error.substring(0, 60) + '...' : result.error;
      console.log(color('✘ FAIL', 'red'), `  ${errShort}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  const passed = results.filter((r) => r.status === 'PASS');
  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                   SUMMARY                                ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`  Total:    ${models.length}`);
  console.log(`  ${color('Passed:', 'green')}   ${passed.length}`);
  console.log(`  ${color('Failed:', 'red')}   ${failed.length}`);
  console.log(`  ${color('Skipped:', 'yellow')}  ${skipped.length}`);
  console.log(`  Time:     ${elapsed}s`);

  if (passed.length > 0) {
    console.log('\n' + color('Passed Models:', 'green'));
    passed.forEach((r) => console.log(`  ✔ ${r.model} (${r.provider})`));

    console.log('\n' + color('LIVE_MODELS_OVERRIDE value:', 'cyan'));
    const overrideValue = passed.map((r) => r.model).join(',');
    console.log(`  ${overrideValue}`);
    console.log(`\n  Add this to your .env to serve only working models:`);
    console.log(`  LIVE_MODELS_OVERRIDE=${overrideValue}`);
  }

  if (failed.length > 0) {
    console.log('\n' + color('Failed Models:', 'red'));
    failed.forEach((r) => {
      console.log(`  ✘ ${r.model} (${r.provider})`);
      console.log(`    Error: ${r.error}`);
    });

    if (failed.some((r) => r.isAuth)) {
      console.log(color('\n⚠ Some failures are authentication errors (401). Check your API keys.', 'yellow'));
    }
  }

  // Recommendations
  if (failed.length > 0) {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║              RECOMMENDATIONS                             ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('1. Set LIVE_MODELS_OVERRIDE in .env to hide broken models:');
    console.log('   LIVE_MODELS_OVERRIDE=' + passed.map((r) => r.model).join(','));
    console.log('\n2. Or remove failed models from src/utils/pricing.js:');
    failed.forEach((r) => console.log(`   - Remove: '${r.model}'`));
    console.log('\n3. Update HEALTH_CHECK_ENABLED=false to stop wasting API credits:');
    console.log('   HEALTH_CHECK_ENABLED=false');
  }

  console.log('');

  // Exit code: 0 if all pass, 1 if any fail
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
