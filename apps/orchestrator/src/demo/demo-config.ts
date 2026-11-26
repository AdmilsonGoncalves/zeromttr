export interface ResolvedDemoConfig {
  demoModeEnabled: boolean;
  requireDemoKey: boolean;
  publicLiveDemo: boolean;
}

/**
 * Resolves interactive demo availability and key-enforcement flags with legacy `PUBLIC_LIVE_DEMO` fallback.
 */
export function resolveDemoConfig(
  env: Record<string, string | undefined> = process.env
): ResolvedDemoConfig {
  const demoModeEnabled = env.ENABLE_DEMO_MODE?.trim().toLowerCase() !== 'false';
  const rawRequireKey = env.REQUIRE_DEMO_KEY?.trim().toLowerCase();

  let requireDemoKey: boolean;
  if (rawRequireKey === 'true') {
    requireDemoKey = true;
  } else if (rawRequireKey === 'false') {
    requireDemoKey = false;
  } else {
    requireDemoKey = env.PUBLIC_LIVE_DEMO?.trim().toLowerCase() !== 'true';
  }

  return {
    demoModeEnabled,
    requireDemoKey,
    publicLiveDemo: !requireDemoKey
  };
}
