import React from 'react';
import { Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRally } from '../state/RallyContext';
import { colors, fonts } from '../theme';

interface Props {
  size?: number;
  fontSize?: number;
  serif?: boolean;
  style?: ViewStyle;
}

// Your own avatar. Onboarding lets you pick a gradient in place of a photo, so
// honour that when it's set and fall back to the app's cream chip when it
// isn't. Phase 2 swaps the gradient for the real uploaded photo.
export default function YouAvatar({ size = 40, fontSize = 14, serif, style }: Props) {
  const { profile } = useRally();
  const label = (
    <Text
      style={{
        color: profile.avatarColors ? '#07130C' : colors.accentLink,
        fontSize,
        fontFamily: serif && !profile.avatarColors ? fonts.serif : fonts.extrabold,
      }}
    >
      {profile.initials}
    </Text>
  );
  const box: ViewStyle = {
    width: size, height: size, borderRadius: size / 2,
    alignItems: 'center', justifyContent: 'center',
  };

  if (profile.avatarColors) {
    return (
      <LinearGradient
        colors={profile.avatarColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[box, style]}
      >
        {label}
      </LinearGradient>
    );
  }
  return <View style={[box, { backgroundColor: colors.openBg }, style]}>{label}</View>;
}
