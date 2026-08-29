// The last three things that had to be re-clicked in Xcode after every
// `prebuild --clean`, encoded so the regeneration carries them:
//   1. expo-audio's UIBackgroundModes (background audio) removed — Qleck
//      plays its one celebration sound in the foreground only.
//   2. Mac / Apple Vision "Designed for iPad" destinations off (the app's
//      frameworks don't run there — ITMS-90863).
//   3. Release signing pinned to the manual App Store distribution profile.
// Every mod is defensive: a failure leaves that one Xcode step manual
// again, never breaks prebuild.
const { withInfoPlist, withXcodeProject } = require('expo/config-plugins');

module.exports = function withQleckIos(config) {
  config = withInfoPlist(config, (c) => {
    try { delete c.modResults.UIBackgroundModes; } catch {}
    return c;
  });

  config = withXcodeProject(config, (c) => {
    try {
      const proj = c.modResults;
      const section = proj.pbxXCBuildConfigurationSection();
      for (const key of Object.keys(section)) {
        const entry = section[key];
        if (!entry || typeof entry !== 'object' || !entry.buildSettings) continue;
        const bs = entry.buildSettings;
        if (!bs.PRODUCT_NAME) continue; // app target configs only, not project-level
        bs.SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = 'NO';
        bs.SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD = 'NO';
        bs.SUPPORTS_MACCATALYST = 'NO';
        if (entry.name === 'Release') {
          bs.CODE_SIGN_STYLE = 'Manual';
          bs.DEVELOPMENT_TEAM = 'LK8FVGBQPL';
          bs.CODE_SIGN_IDENTITY = '"Apple Distribution"';
          bs.PROVISIONING_PROFILE_SPECIFIER = '"Qleck App Store"';
        }
      }
      try { proj.addTargetAttribute('ProvisioningStyle', 'Manual'); } catch {}
    } catch {}
    return c;
  });

  return config;
};
