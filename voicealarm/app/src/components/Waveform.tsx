import { View } from 'react-native';
import { useTheme } from '../theme';

const BAR_COUNT = 40;

/**
 * 녹음 레벨 막대.
 *
 * 실제 오디오 파형이 아니라 입력 레벨 이력이다. 정확한 파형을 그리려면 샘플을 직접
 * 읽어야 하는데, 녹음 중에 그걸 하면 저사양 기기에서 프레임이 떨어진다.
 * 여기서 필요한 건 "지금 내 목소리가 잡히고 있다"는 신호뿐이라 이 정도면 충분하다.
 */
export function Waveform({ levels, active }: { levels: number[]; active: boolean }) {
  const { colors, radius, spacing } = useTheme();

  // 항상 같은 개수의 막대를 그린다. 개수가 변하면 폭이 출렁여서 보기 나쁘다.
  const padded = [...Array<number>(Math.max(0, BAR_COUNT - levels.length)).fill(0), ...levels].slice(
    -BAR_COUNT,
  );

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 72,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        gap: 2,
      }}
    >
      {padded.map((value, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            // 최소 높이를 줘야 무음 구간에서도 막대가 사라지지 않는다
            height: Math.max(3, value * 60),
            borderRadius: radius.pill,
            backgroundColor: active ? colors.primary : colors.border,
          }}
        />
      ))}
    </View>
  );
}
