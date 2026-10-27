import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { BEATS, SPLASH_SEEN_KEY, SplashPlan, splashPlan } from '../lib/splash';
import { fonts } from '../theme';

const BG = '#023D40';
const GOLD = '#F5B83D';
const COIN = 180;   // the same width as the still splash image, so the hand-over from it is seamless

/**
 * Cinematic splash: the coin turns, warm light blooms, rings spread, light sweeps across the coin,
 * the coin lifts and the name rises. First launch only runs the full 3.5 seconds; later launches are short.
 * Tap anywhere to skip. It waits for the app to be ready before fading out.
 */
export default function AnimatedSplash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [plan, setPlan] = useState<SplashPlan | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let first = true;
      let reduce = false;
      try { first = (await AsyncStorage.getItem(SPLASH_SEEN_KEY)) !== '1'; } catch { /* treat as first launch */ }
      try { reduce = await AccessibilityInfo.isReduceMotionEnabled(); } catch { /* assume motion is fine */ }
      if (!alive) return;
      const p = splashPlan({ firstLaunch: first, reduceMotion: reduce });
      if (p.mode === 'full') AsyncStorage.setItem(SPLASH_SEEN_KEY, '1').catch(() => {});
      setPlan(p);
    })();
    return () => { alive = false; };
  }, []);

  if (!plan) return null;   // the still splash image stays on screen until the plan is known
  return <Stage plan={plan} ready={ready} onDone={onDone} />;
}

function Stage({ plan, ready, onDone }: { plan: SplashPlan; ready: boolean; onDone: () => void }) {
  const { height } = useWindowDimensions();
  const full = plan.mode === 'full';
  const still = plan.mode === 'still';
  // later launches start from the end state, so only the shine and the fade play
  const v = useMemo(() => ({
    turn: new Animated.Value(full ? 0 : 1),
    glow: new Animated.Value(full ? 0 : 1),
    ripple1: new Animated.Value(0),
    ripple2: new Animated.Value(0),
    shine: new Animated.Value(0),
    lift: new Animated.Value(full ? 0 : 1),
    name: new Animated.Value(full ? 0 : 1),
    tagline: new Animated.Value(full ? 0 : 1),
    fade: new Animated.Value(1),
  }), [full]);

  const readyRef = useRef(ready);
  readyRef.current = ready;
  const finished = useRef(false);

  const fadeOut = () => {
    if (finished.current) return;
    finished.current = true;
    Animated.timing(v.fade, { toValue: 0, duration: plan.fadeMs, easing: Easing.out(Easing.quad), useNativeDriver: true })
      .start(() => onDone());
  };

  useEffect(() => {
    const t = (value: Animated.Value, beat: { at: number; for: number }, easing = Easing.out(Easing.cubic)) =>
      Animated.sequence([Animated.delay(beat.at), Animated.timing(value, { toValue: 1, duration: beat.for, easing, useNativeDriver: true })]);

    if (full) {
      Animated.parallel([
        t(v.turn, BEATS.coinTurn, Easing.inOut(Easing.cubic)),
        t(v.glow, BEATS.glow, Easing.out(Easing.quad)),
        t(v.ripple1, BEATS.ripple1, Easing.out(Easing.quad)),
        t(v.ripple2, BEATS.ripple2, Easing.out(Easing.quad)),
        t(v.shine, BEATS.shine, Easing.inOut(Easing.quad)),
        t(v.lift, BEATS.coinLift, Easing.inOut(Easing.cubic)),
        t(v.name, BEATS.name),
        t(v.tagline, BEATS.tagline),
      ]).start();
    } else if (!still) {
      t(v.shine, { at: 100, for: 500 }, Easing.inOut(Easing.quad)).start();
    }

    // Fade out at the planned time, but wait (up to 2 more seconds) if the app is not ready yet.
    let waited = 0;
    let poll: ReturnType<typeof setInterval> | undefined;
    const timer = setTimeout(() => {
      if (readyRef.current) { fadeOut(); return; }
      poll = setInterval(() => {
        waited += 100;
        if (readyRef.current || waited >= 2000) { if (poll) clearInterval(poll); fadeOut(); }
      }, 100);
    }, plan.fadeStartMs);
    return () => { clearTimeout(timer); if (poll) clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turn = v.turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const lift = v.lift.interpolate({ inputRange: [0, 1], outputRange: [0, -56] });
  const coinScale = v.lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const glowScale = v.glow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.1] });
  const glowOpacity = v.glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.16] });
  const shineX = v.shine.interpolate({ inputRange: [0, 1], outputRange: [-COIN, COIN * 1.3] });
  const ripple = (p: Animated.Value) => ({
    opacity: p.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0] }),
    transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 2.5] }) }],
  });
  const rise = (p: Animated.Value) => ({
    opacity: p,
    transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
  });

  return (
    <Animated.View style={[s.root, { opacity: v.fade }]} onLayout={() => { SplashScreen.hideAsync().catch(() => {}); }}>
      <StatusBar style="light" />
      <Pressable style={s.fill} onPress={fadeOut} accessibilityRole="button" accessibilityLabel="Skip intro">
        <Animated.View style={[s.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
        <Animated.View style={[s.ring, ripple(v.ripple1)]} />
        <Animated.View style={[s.ring, ripple(v.ripple2)]} />

        <Animated.View style={[s.coin, { transform: [{ translateY: lift }, { scale: coinScale }, { perspective: 900 }, { rotateY: turn }] }]}>
          <Image source={require('../../assets/splash-icon.png')} style={s.coinImage} accessibilityLabel="Fiji Rewards" />
          <Animated.View style={[s.shine, { transform: [{ rotate: '20deg' }, { translateX: shineX }] }]} />
        </Animated.View>

        <Animated.Text style={[s.name, { top: height / 2 + 66 }, rise(v.name)]}>Fiji Rewards</Animated.Text>
        <Animated.Text style={[s.tagline, { top: height / 2 + 116 }, rise(v.tagline)]}>One wallet. Every local shop.</Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: BG, zIndex: 1000, elevation: 1000 },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 460, height: 460, borderRadius: 230, backgroundColor: GOLD },
  ring: { position: 'absolute', width: COIN, height: COIN, borderRadius: COIN / 2, borderWidth: 2, borderColor: GOLD },
  coin: { width: COIN, height: COIN, borderRadius: COIN / 2, overflow: 'hidden' },
  coinImage: { width: COIN, height: COIN },
  shine: { position: 'absolute', top: -COIN * 0.3, width: 56, height: COIN * 1.6, backgroundColor: 'rgba(255,255,255,0.32)' },
  name: { position: 'absolute', alignSelf: 'center', fontFamily: fonts.extraBold, fontSize: 34, color: '#FFF4D6' },
  tagline: { position: 'absolute', alignSelf: 'center', fontFamily: fonts.medium, fontSize: 15, color: GOLD, opacity: 0.9 },
});
