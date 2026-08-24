import React from 'react';
import { Text, View } from 'react-native';
import { night, nightFonts } from '../theme';
import { Screen, Spin } from '../ui';

// Purely a "checking…" beat — the flow auto-advances after 2.1s.
export default function FaceIdScreen() {
  return (
    <Screen scroll={false} style={{ alignItems: 'center', justifyContent: 'center', gap: 22 }}>
      <Spin>
        <View
          style={{
            width: 120, height: 120, borderRadius: 60,
            borderWidth: 2.5, borderColor: 'rgba(43,227,128,0.7)', borderStyle: 'dashed',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Spin reverse>
            <View
              style={{
                width: 88, height: 88, borderRadius: 44, backgroundColor: night.surface,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <View style={{ alignItems: 'center', gap: 8 }}>
                <View style={{ flexDirection: 'row', gap: 16 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: night.accent }} />
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: night.accent }} />
                </View>
                <View
                  style={{
                    width: 26, height: 12,
                    borderBottomLeftRadius: 13, borderBottomRightRadius: 13,
                    borderWidth: 3, borderTopWidth: 0, borderColor: night.accent,
                  }}
                />
              </View>
            </View>
          </Spin>
        </View>
      </Spin>

      <Text style={{ fontFamily: nightFonts.display, fontSize: 20, color: night.text }}>Face ID</Text>
      <Text style={{ fontFamily: nightFonts.body, fontSize: 14, color: night.textSoft }}>
        Checking it’s really you…
      </Text>
    </Screen>
  );
}
