// The things that had to be re-clicked in Xcode after every
// `prebuild --clean`, encoded so the regeneration carries them:
//   1. expo-audio's UIBackgroundModes (background audio) removed — Qleck
//      plays its one celebration sound in the foreground only.
//   2. Mac / Apple Vision "Designed for iPad" destinations off (the app's
//      frameworks don't run there — ITMS-90863).
//   3. Release signing pinned to the manual App Store distribution profile.
//   4. The push entitlement expo-notifications adds, removed. Qleck's nudges
//      are LOCAL notifications only -- scheduleNotificationAsync with DATE
//      triggers, and not one remote-push API in the codebase -- and local
//      notifications need neither `aps-environment` nor the Push
//      Notifications capability. Leaving the entitlement in fails the build
//      against a distribution profile that (rightly) has no push capability,
//      and would otherwise mean declaring a capability the app never uses.
// Every mod is defensive: a failure leaves that one Xcode step manual
// again, never breaks prebuild.
//
// ORDER MATTERS, AND IT IS BACKWARDS FROM THE OBVIOUS GUESS. Expo chains
// config-plugin mods LIFO: the LAST plugin registered has its mod run FIRST,
// so the FIRST plugin registered runs LAST and gets the final word. Every mod
// here is a deletion of something another plugin adds, so this plugin must sit
// at the TOP of app.json's `plugins` array to win. Moving it to the bottom
// silently breaks all of it -- verify with:
//
//   npx expo config --type introspect
//
// and confirm `aps-environment` and `UIBackgroundModes` are both absent while
// `applesignin` is still present. That check runs on Windows; it does not need
// a Mac or a build.
const { withEntitlementsPlist, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

module.exports = function withQleckIos(config) {
  config = withInfoPlist(config, (c) => {
    try { delete c.modResults.UIBackgroundModes; } catch {}
    return c;
  });

  config = withEntitlementsPlist(config, (c) => {
    try {
      delete c.modResults['aps-environment'];
      delete c.modResults['com.apple.developer.aps-environment'];
    } catch {}
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
