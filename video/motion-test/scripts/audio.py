#!/usr/bin/env python3
"""Synthesizes the soundtrack and sound effects for the GrantTrace video.

Everything is generated from code, so the audio is royalty-free and
reproducible. Timing matches src/timeline.ts: 120 BPM, so one bar is
2 seconds, or 60 frames at 30 fps.
"""
import os
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
BEAT = 0.5
BAR = 4 * BEAT
LENGTH = 38.0
N = int(SR * LENGTH)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
rng = np.random.default_rng(7)


def at(bar, beat=0.0):
    return (bar * 4 + beat) * BEAT


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def filt(x, kind, f, order=2):
    return sosfilt(butter(order, f, kind, fs=SR, output="sos"), x, axis=-1)


def times(seconds):
    return np.arange(int(seconds * SR)) / SR


def stereo(sig, pan=0.0):
    if sig.ndim == 2:
        return sig
    return np.stack([sig * np.sqrt(1 - pan), sig * np.sqrt(1 + pan)])


def place(bus, sig, t, gain=1.0, pan=0.0):
    sig = stereo(sig, pan)
    i = int(round(t * SR))
    n = min(sig.shape[1], bus.shape[1] - i)
    if n > 0:
        bus[:, i : i + n] += gain * sig[:, :n]


def write(name, sig, peak=0.9):
    sig = stereo(sig)
    sig = sig / (np.abs(sig).max() + 1e-9) * peak
    data = (np.clip(sig, -1, 1).T * 32767).astype("<i2")
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def section(bar):
    if bar < 2:
        return "intro"
    if bar < 4:
        return "tension"
    if bar < 8:
        return "dropA"
    if bar < 10:
        return "breakdown"
    if bar < 16:
        return "dropB"
    return "outro"


# Upper voicing and bass root. IV - V - iii - vi in C, resolving to Cmaj9.
CHORDS = {
    "F": ([53, 57, 60, 64], 41),
    "G": ([55, 59, 62, 64], 43),
    "Em": ([52, 55, 59, 62], 40),
    "Am": ([55, 60, 64, 71], 45),
    "C": ([55, 60, 64, 71, 74], 36),
}


def chord(bar):
    if bar < 16:
        return ["F", "G", "Em", "Am"][bar % 4]
    return "F" if bar == 16 else "C"


# ---------------------------------------------------------------- instruments


def saw(f, n):
    return 2 * ((np.arange(n) / SR * f + rng.random()) % 1.0) - 1


def pluck(f):
    t = times(0.6)
    env = np.exp(-t / 0.16) * np.minimum(1, t / 0.003)
    tone = (
        np.sin(2 * np.pi * f * t)
        + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t / 0.05)
        + 0.12 * np.sin(6 * np.pi * f * t) * np.exp(-t / 0.03)
    )
    return tone * env


def bell(f, length):
    t = times(length + 1.2)
    mod = np.sin(2 * np.pi * f * 3.5 * t) * 1.6 * np.exp(-t / 0.25)
    env = np.exp(-t / 0.9) * np.minimum(1, t / 0.004)
    return np.sin(2 * np.pi * f * t + mod) * env


def bass_note(f, length, attack=0.01):
    t = times(length)
    env = np.minimum(1, t / attack) * np.clip((length - t) / 0.06, 0, 1)
    tone = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    return tone * env


def kick():
    t = times(0.5)
    f = 45 + 110 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.26)
    click = filt(rng.standard_normal(t.size), "high", 2500) * np.exp(-t / 0.003) * 0.25
    return body + click


def clap():
    t = times(0.5)
    noise = filt(rng.standard_normal(t.size), "band", [900, 5000])
    env = np.zeros_like(t)
    for offset in (0.0, 0.011, 0.023):
        env += np.where(t >= offset, np.exp(-(t - offset) / 0.009), 0) * 0.6
    env += np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.13), 0)
    return noise * env * 0.7


def hat(length=0.025):
    t = times(0.2)
    return filt(rng.standard_normal(t.size), "high", 7500) * np.exp(-t / length)


def sweep_noise(length, f0, f1, width=0.5):
    """Band-passed noise whose centre frequency glides from f0 to f1."""
    n = int(length * SR)
    noise = rng.standard_normal(n + 4096)
    out = np.zeros(n + 4096)
    win = np.hanning(2048)
    for s in range(0, n, 1024):
        fc = f0 * (f1 / f0) ** (s / n)
        lo, hi = fc * (1 - width), min(fc * (1 + width), SR * 0.45)
        seg = sosfilt(butter(2, [lo, hi], "band", fs=SR, output="sos"), noise[s : s + 2048])
        out[s : s + 2048] += seg * win
    return out[:n]


def riser(length):
    t = times(length)
    env = (t / length) ** 2.2
    f = 180 * (4.5 ** (t / length))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.12
    return (sweep_noise(length, 300, 8000) * 0.6 + tone) * env


def impact():
    t = times(2.8)
    f = 36 + 34 * np.exp(-t / 0.12)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.75) * np.minimum(1, t / 0.002)
    crack = filt(rng.standard_normal(t.size), "low", 3000) * np.exp(-t / 0.1) * 0.45
    return boom + crack


def pingpong(x, delay=0.375, feedback=0.4, mix=0.32):
    d = int(delay * SR)
    wet = np.zeros_like(x)
    for k in range(1, 6):
        echo = np.zeros_like(x)
        echo[:, k * d :] = x[:, : -k * d]
        if k % 2:
            echo = echo[::-1]
        wet += echo * mix * feedback ** (k - 1)
    return x + filt(wet, "low", 3200)


def reverb(x, length=2.8, decay=0.85):
    t = times(length)
    ir = rng.standard_normal((2, t.size)) * np.exp(-t / decay)
    ir = filt(ir, "low", 5500)
    ir[:, : int(0.02 * SR)] = 0
    ir /= np.sqrt((ir**2).sum(axis=1, keepdims=True))
    return np.stack([fftconvolve(x[c], ir[c])[: x.shape[1]] for c in range(2)])


# ---------------------------------------------------------------------- score

pad, arp, bass, drums, claps, lead, fx = (np.zeros((2, N)) for _ in range(7))
kicks = []

CUTOFF = {"intro": 800, "tension": 1300, "dropA": 1700, "breakdown": 1300, "dropB": 2300, "outro": 1400}
PAD_GAIN = {"intro": 0.8, "tension": 1.0, "dropA": 0.75, "breakdown": 1.0, "dropB": 0.75, "outro": 1.0}

bar = 0
while bar < 19:
    held = 2 if bar == 17 else 1
    length = held * BAR
    release = 0.9 if bar < 17 else 0.0
    t = times(length + release)
    env = np.minimum(1, t / 0.35) * np.where(t < length, 1.0, np.clip(1 - (t - length) / 0.9, 0, 1))
    if bar == 17:
        env *= np.clip((length - t) / 3.2, 0, 1)
    sig = np.zeros((2, t.size))
    for m in CHORDS[chord(bar)][0]:
        for cents, pan in ((-9, -0.7), (0, 0.0), (9, 0.7)):
            sig += stereo(saw(hz(m) * 2 ** (cents / 1200), t.size), pan)
    sig = filt(sig, "low", CUTOFF[section(bar)]) * env * 0.08 * PAD_GAIN[section(bar)]
    place(pad, sig, at(bar))
    bar += held

PATTERN = [0, 1, 2, 3, 2, 1, 3, 2]
ARP_GAIN = {"intro": 0.45, "dropA": 0.8, "breakdown": 0.7, "dropB": 0.9, "outro": 0.45}
for bar in range(18):
    sec = section(bar)
    if sec == "tension":
        continue
    notes = CHORDS[chord(bar)][0]
    steps = 4 if sec == "outro" else 8
    for s in range(steps):
        idx = PATTERN[s] if steps == 8 else [0, 2, 1, 3][s]
        gain = ARP_GAIN[sec] * (1.0 if s % 2 == 0 else 0.7)
        if bar == 0:
            gain *= min(1, (s + 1) / 6)
        place(arp, pluck(hz(notes[idx % len(notes)] + 12)), at(bar, s * 4 / steps), gain, 0.3 if s % 2 else -0.3)

GROOVE = [(0, 0.7), (1, 0.45), (1.5, 0.45), (2, 0.7), (3, 0.45), (3.5, 0.45)]
for bar in range(2, 19):
    sec = section(bar)
    root = hz(CHORDS[chord(bar)][1])
    if sec in ("tension", "breakdown"):
        length = BAR - (0.25 if bar == 3 else 0)
        place(bass, bass_note(root, length, attack=0.4), at(bar), 0.6)
    elif sec in ("dropA", "dropB"):
        for beat, length in GROOVE:
            place(bass, bass_note(root, length), at(bar, beat), 0.75)
    elif bar == 16:
        place(bass, bass_note(root, BAR, attack=0.02), at(bar), 0.7)
    elif bar == 17:
        place(bass, bass_note(root, 2 * BAR - 0.6, attack=0.3) * np.linspace(1, 0, int((2 * BAR - 0.6) * SR)), at(bar), 0.7)

for bar in (2, 3):
    place(drums, kick(), at(bar), 0.55)
    kicks.append(at(bar))
for bar in range(1, 16):
    sec = section(bar)
    if sec == "intro":
        for s in range(8):
            place(drums, hat(), at(bar, s / 2), 0.08 + 0.02 * s, 0.2)
    elif sec in ("dropA", "dropB"):
        for beat in ([0, 2, 2.5] if sec == "dropA" else [0, 1, 2, 3]):
            place(drums, kick(), at(bar, beat), 0.9)
            kicks.append(at(bar, beat))
        for beat in (1, 3):
            place(claps, clap(), at(bar, beat), 0.55)
        for s in range(16 if sec == "dropB" else 8):
            beat = s / (4 if sec == "dropB" else 2)
            offbeat = (beat % 1) == 0.5
            place(drums, hat(0.05 if offbeat else 0.02), at(bar, beat), 0.28 if offbeat else 0.12, 0.25)
    elif sec == "breakdown":
        for s in range(8 if bar == 8 else 16):
            beat = s / (2 if bar == 8 else 4)
            place(drums, hat(), at(bar, beat), 0.1 + (0.1 * s / 16 if bar == 9 else 0), -0.2)

MELODY = [
    [(0, 72, 1), (1, 76, 1), (2, 79, 1.5), (3.5, 77, 0.5)],
    [(0, 76, 1.5), (1.5, 74, 0.5), (2, 74, 2)],
    [(0, 71, 1), (1, 74, 1), (2, 79, 1), (3, 76, 1)],
    [(0, 76, 3), (3, 72, 1)],
]
for i, phrase in enumerate(MELODY):
    for beat, m, length in phrase:
        place(lead, bell(hz(m), length * BEAT), at(12 + i, beat), 0.32, 0.1)

place(fx, riser(at(3, 3.5) - at(3)), at(3), 0.5)
place(fx, riser(BAR), at(9), 0.4)
place(fx, riser(BEAT * 1.5), at(15, 2.5), 0.3)
place(fx, impact(), at(4), 0.9)
place(fx, impact(), at(16), 0.8)

# Sidechain: everything melodic breathes around the kick.
duck = np.ones(N)
for tk in kicks:
    i = int(tk * SR)
    t = times(0.35)
    n = min(t.size, N - i)
    duck[i : i + n] = np.minimum(duck[i : i + n], 1 - np.exp(-t[:n] / 0.13))
duck = 0.45 + 0.55 * duck

arp_mix = pingpong(filt(arp, "low", 4800))
dry = pad * duck * 0.9 + arp_mix * (0.6 + 0.4 * duck) * 0.55 + bass * duck * 0.75 + drums * 0.8 + claps * 0.6 + lead * 0.5 + fx
wet = reverb(pad * 0.3 + arp * 0.25 + claps * 0.35 + lead * 0.6 + fx * 0.35)
master = filt(dry + wet * 0.4, "high", 30)

# A beat of silence before the drop, and a clean tail at the end.
t_all = np.arange(N) / SR
gap = np.clip(np.maximum((at(3, 3.5) - t_all) / 0.01, (t_all - at(4) + 0.005) / 0.005), 0, 1)
master *= gap
master *= np.clip((LENGTH - t_all) / 1.5, 0, 1)

master /= np.abs(master).max()
master = np.tanh(1.4 * master) / np.tanh(1.4)
write("music.wav", master, peak=0.89)

# -------------------------------------------------------------- sound effects

t = times(0.14)
f = 650 + 500 * (1 - np.exp(-t / 0.01))
write("sfx/pop.wav", np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035) * np.minimum(1, t / 0.002)
      + filt(rng.standard_normal(t.size), "high", 3000) * np.exp(-t / 0.002) * 0.3)

t = times(0.12)
write("sfx/tick.wav", np.sin(2 * np.pi * 2300 * t) * np.exp(-t / 0.012) + 0.5 * np.sin(2 * np.pi * 1150 * t) * np.exp(-t / 0.025))

t = times(0.5)
body = sweep_noise(0.5, 450, 3200, width=0.6) * np.sin(np.pi * np.clip(t / 0.5, 0, 1) ** 0.75) ** 2
pan = np.linspace(-0.8, 0.8, t.size)
write("sfx/whoosh.wav", np.stack([body * np.sqrt(1 - pan), body * np.sqrt(1 + pan)]))

t = times(0.5)
f = 50 + 60 * np.exp(-t / 0.02)
write("sfx/thump.wav", np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
      + filt(rng.standard_normal(t.size), "band", [1500, 6000]) * np.exp(-t / 0.004) * 0.5)

typing = np.zeros((2, int(6 * SR)))
clock = 0.0
while clock < 5.8:
    t = times(0.05)
    click = filt(rng.standard_normal(t.size), "high", 1800) * np.exp(-t / 0.004) * rng.uniform(0.5, 1.0)
    click += np.sin(2 * np.pi * rng.uniform(150, 230) * t) * np.exp(-t / 0.01) * 0.35
    place(typing, filt(click, "low", 9000), clock, 1.0, rng.uniform(-0.3, 0.3))
    clock += rng.uniform(0.05, 0.085)
write("sfx/typing.wav", typing, peak=0.8)

print("wrote music.wav and sfx/")
