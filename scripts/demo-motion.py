"""Render motion graphics around actual RUNA renderer frames (Windows fonts/TTS).

Generate source first: bare scripts/demo-walkthrough.js OUTPUT --extended
Then: python scripts/demo-motion.py OUTPUT
No game rules, model geometry or recorded damage are changed by this edit.
"""

import argparse
from array import array
import json
import math
import subprocess
import wave
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FPS = 15
SIZE = (1920, 1080)
BG = '#0b1019'
WHITE = '#e7edf5'
MUTED = '#94a5bb'
CYAN = '#75e7ed'
GOLD = '#ffd76a'
FONT_DIR = Path('C:/Windows/Fonts')


def font(size, bold=False, mono=False):
    name = ('consolab.ttf' if bold else 'consola.ttf') if mono else ('seguisb.ttf' if bold else 'segoeui.ttf')
    return ImageFont.truetype(str(FONT_DIR / name), size)


class Terminal(HTMLParser):
    def __init__(self, columns, rows):
        super().__init__(convert_charrefs=True)
        self.image = Image.new('RGB', (1375, 900), '#11151d')
        self.draw = ImageDraw.Draw(self.image)
        self.size = 26 if columns == 80 else 16
        self.normal = font(self.size, mono=True)
        self.bold = font(self.size, bold=True, mono=True)
        self.cell = self.normal.getlength('M')
        self.line = self.size * 1.2
        self.origin = ((1375 - columns * self.cell) / 2, (900 - rows * self.line) / 2)
        self.x = self.y = 0
        self.style = {}

    def handle_starttag(self, tag, attrs):
        if tag == 'span':
            css = dict(attrs).get('style', '')
            self.style = dict(item.split(':', 1) for item in css.split(';') if ':' in item)

    def handle_endtag(self, tag):
        self.style = {}

    def handle_data(self, data):
        fg = self.style.get('color', '#d8dee9')
        if 'opacity' in self.style:
            rgb = tuple(int(fg[i:i + 2], 16) for i in (1, 3, 5))
            opacity = float(self.style['opacity'])
            fg = tuple(round(a * opacity + b * (1 - opacity)) for a, b in zip(rgb, (17, 21, 29)))
        chosen = self.bold if self.style.get('font-weight') == '700' else self.normal
        for i, line in enumerate(data.split('\n')):
            if i:
                self.y += 1
                self.x = 0
            px = self.origin[0] + self.x * self.cell
            py = self.origin[1] + self.y * self.line
            if line:
                if 'background' in self.style:
                    self.draw.rectangle((px, py, px + len(line) * self.cell, py + self.line), fill=self.style['background'])
                self.draw.text((px, py), line, font=chosen, fill=fg, anchor='lt')
            self.x += len(line)


SCENES = [
    (0, 12, 'coloso', 'THE COLOSSUS', 'Rotating main menu', ['24 shaded views', 'One complete rotation']),
    (12, 20, 'heroe', 'THE HERO', 'Character creation preview', ['Generated hero mesh', 'Rendered as ASCII']),
    (20, 28, 'yelmo', 'IRON HELMET', 'Select + buy in the armory', ['Real item purchase', '75 gold']),
    (28, 36, 'yelmo', 'IRON HELMET', 'Equipped inventory preview', ['Rotating item preview', 'Defense +2']),
    (36, 66, 'coloso', 'THE COLOSSUS', '30 seconds of real combat', ['Same GLB as the menu', 'Hits + runic powers']),
]

LINES = [
    (0, 'Runa. Imagination takes shape.'),
    (4, 'This Colossus was generated with Tripo. We convert its three D mesh into twenty four shaded ASCII views for the rotating menu.'),
    (16, 'The hero is also generated with Tripo. Its rotating preview appears when you create your character.'),
    (24, 'The iron helmet is our third Tripo model. Here we select it and buy the real item.'),
    (32, 'Its ASCII preview follows the equipped item. The helmet adds two defense points to the character.'),
    (40, 'Now the same Colossus model appears inside the arena. This is thirty seconds of continuous combat from the real game.'),
    (52, 'The player attacks while the boss launches runic powers. Attack warnings, damage and health all come from Runa\'s combat system.'),
    (62, 'One generated model powers both the menu and the encounter. Three D geometry becomes playable ASCII.'),
    (70, 'Next: Runa\'s three D browser world.'),
]


def text(draw, xy, value, size=24, color=WHITE, bold=False):
    draw.text(xy, value, font=font(size, bold), fill=color)


def panel(scene, number, crop):
    _, _, model, title, subtitle, facts = scene
    im = Image.new('RGBA', (430, 900))
    d = ImageDraw.Draw(im)
    text(d, (0, 0), f'0{number + 1} / TRIPO IN RUNA', 22, CYAN, True)
    text(d, (0, 44), title, 42, WHITE, True)
    text(d, (0, 112), subtitle, 23, MUTED)
    d.rounded_rectangle((0, 176, 382, 578), radius=18, fill='#14191f', outline='#33414e', width=2)
    im.alpha_composite(crop.convert('RGBA'), (17, 192))
    text(d, (20, 540), 'ORIGINAL TRIPO GLB', 19, CYAN, True)
    text(d, (0, 617), 'GENERATED WITH TRIPO', 23, CYAN, True)
    for i, fact in enumerate(facts):
        text(d, (0, 662 + i * 36), fact, 25)
    d.line((0, 761, 380, 761), fill='#33414e', width=2)
    text(d, (0, 787), 'GLB  >  24 VIEWS  >  ASCII', 23, GOLD, True)
    text(d, (0, 831), 'Offline conversion. Text-only runtime.', 20, MUTED)
    return im


def title_card(t, ending=False):
    im = Image.new('RGB', SIZE, BG)
    d = ImageDraw.Draw(im)
    color = CYAN if not ending else GOLD
    reveal = min(1, t / .8)
    d.rectangle((95, 180, 95 + round(1720 * reveal), 185), fill=color)
    text(d, (95, 226), 'RUNA / TRIPO', 32, color, True)
    text(d, (95, 310), 'IMAGINATION' if not ending else 'CONTINUES IN PART 02', 102 if not ending else 78, WHITE, True)
    text(d, (95, 443), 'TAKES SHAPE' if not ending else 'RUNA IN THE 3D BROWSER', 102 if not ending else 68, WHITE, True)
    text(d, (100, 622), 'PART 01 / GENERATED 3D, PLAYABLE ASCII' if not ending else 'A separate demo of the new browser experience', 34, MUTED)
    names = ['COLOSSUS', 'HERO', 'IRON HELMET'] if not ending else ['ONE WORLD', 'SAME GAME', 'NEW VIEW']
    for i, name in enumerate(names):
        if t > .35 + i * .2:
            x = 100 + i * 563
            d.rounded_rectangle((x, 750, x + 515, 848), radius=16, outline=color, width=2)
            text(d, (x + 30, 775), name, 34, color, True)
    text(d, (100, 970), 'Actual RUNA renderer + generated Tripo models', 23, MUTED)
    return im


def prepare_audio(directory, total):
    (directory / 'narration.json').write_text(json.dumps([{'at': at, 'text': line} for at, line in LINES], indent=2), encoding='utf-8')
    ps = """param([string]$Directory)
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.SelectVoice('Microsoft Zira Desktop')
$speaker.Rate = 0
$lines = Get-Content -LiteralPath (Join-Path $Directory 'narration.json') -Raw -Encoding UTF8 | ConvertFrom-Json
for($i=0; $i -lt $lines.Count; $i++) {
  $file = Join-Path $Directory ('voice-{0:D2}.wav' -f $i)
  $speaker.SetOutputToWaveFile($file)
  $speaker.Speak($lines[$i].text)
  $speaker.SetOutputToNull()
}
$speaker.Dispose()
"""
    (directory / 'narrate.ps1').write_text(ps, encoding='utf-8-sig')
    subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(directory / 'narrate.ps1'), str(directory)], check=True)
    # Original, quiet synthesized sound bed; not represented as game audio.
    rate = 24000
    samples = array('h')
    notes = [(110, .010), (164.81, .006), (220, .003), (329.63, .002)]
    for sample in range(int(total * rate)):
        ts = sample / rate
        envelope = min(1, ts / 2) * min(1, (total - ts) / 3)
        modulation = .7 + .3 * math.sin(2 * math.pi * .085 * ts)
        bed = sum(gain * math.sin(2 * math.pi * note * ts) for note, gain in notes) * modulation
        for at in [4, 16, 24, 32, 40, 70]:
            local = ts - at
            if 0 <= local < .3:
                bed += .016 * math.sin(2 * math.pi * (420 * local + 950 * local ** 2)) * math.sin(math.pi * local / .3) ** 2
        samples.append(round(max(-1, min(1, bed * envelope)) * 32767))
    with wave.open(str(directory / 'sound-bed.wav'), 'wb') as out:
        out.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        out.writeframes(samples.tobytes())
    args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(directory / 'sound-bed.wav')]
    filters = []
    durations = []
    for i, (at, line) in enumerate(LINES):
        source = directory / f'voice-{i:02}.wav'
        with wave.open(str(source), 'rb') as source_wave:
            seconds = source_wave.getnframes() / source_wave.getframerate()
        window = LINES[i + 1][0] - at if i + 1 < len(LINES) else total - at
        if seconds > window:
            raise RuntimeError(f'Narration {i} is {seconds:.2f}s, exceeding its {window}s window; shorten the text')
        durations.append({'at': at, 'seconds': seconds, 'text': line})
        args += ['-i', str(source)]
        filters.append(f'[{i + 1}:a]volume=1.6,adelay={at * 1000}:all=1[v{i}]')
    filters.append('[0:a]' + ''.join(f'[v{i}]' for i in range(len(LINES))) + f'amix=inputs={len(LINES) + 1}:normalize=0,alimiter=limit=0.9,apad,atrim=duration={total}[audio]')
    args += ['-filter_complex', ';'.join(filters), '-map', '[audio]', '-ar', '48000', '-ac', '2', str(directory / 'mix.wav')]
    subprocess.run(args, check=True)
    (directory / 'audio-metrics.json').write_text(json.dumps(durations, indent=2), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/demo/runa-tripo-motion-part1-en.mp4')
    parser.add_argument('--preview', action='store_true')
    opts = parser.parse_args()
    directory = opts.directory.resolve()
    frames = json.loads((directory / 'frames.json').read_text(encoding='utf-8'))
    if len(frames) != 990:
        raise RuntimeError('Expected 66 seconds: 36s model showcase + 30s real combat')
    board = Image.open(ROOT / 'docs/screens/tripo-modelos.png')
    crops = {name: board.crop(box).resize((348, 340), Image.Resampling.LANCZOS) for name, box in {
        'yelmo': (17, 64, 284, 364), 'heroe': (302, 64, 569, 364), 'coloso': (587, 64, 854, 364)
    }.items()}
    panels = [panel(scene, i, crops[scene[2]]) for i, scene in enumerate(SCENES)]
    cache = {}

    def render(seconds):
        if seconds < 4:
            return title_card(seconds)
        if seconds >= 70:
            return title_card(seconds - 70, True)
        local = seconds - 4
        index = min(len(frames) - 1, int(local * FPS + .001))
        frame = frames[index]
        key = frame['html']
        if key not in cache:
            terminal = Terminal(frame['columns'], frame['rows'])
            terminal.feed(key)
            if len(cache) > 8:
                cache.clear()
            cache[key] = terminal.image
        im = Image.new('RGB', SIZE, BG)
        im.paste(cache[key], (485, 95))
        d = ImageDraw.Draw(im)
        text(d, (48, 25), 'RUNA', 30, GOLD, True)
        text(d, (485, 27), 'PART 01 / TRIPO MODELS IN THE ASCII GAME', 24, CYAN, True)
        d.rounded_rectangle((483, 93, 1862, 998), radius=12, outline='#33414e', width=2)
        scene_index = next(i for i, scene in enumerate(SCENES) if scene[0] <= local < scene[1])
        scene = SCENES[scene_index]
        progress = min(1, (local - scene[0]) / .6)
        eased = 1 - (1 - progress) ** 3
        layer = panels[scene_index].copy()
        layer.putalpha(layer.getchannel('A').point(lambda a: round(a * eased)))
        im.paste(layer, (48 - round(32 * (1 - eased)), 96), layer)
        text(d, (485, 1017), 'REAL GAMEPLAY / LEVEL 20 COMBAT FIXTURE' if scene_index == 4 else 'REAL RUNA RENDERER / GENERATED TRIPO MODEL', 23, MUTED)
        if scene_index == 4:
            text(d, (1410, 1017), f'COMBAT  {local - 36:04.1f} / 30 s', 23, GOLD, True)
        d.rectangle((485, 1060, 1860, 1065), fill='#27323f')
        d.rectangle((485, 1060, 485 + round(1375 * local / 66), 1065), fill=CYAN)
        return im

    if opts.preview:
        for at in [1, 8, 19, 28, 36, 43, 65, 72]:
            render(at).save(directory / f'preview-{at:02}.png')
        return
    prepare_audio(directory, 74)
    opts.output.parent.mkdir(parents=True, exist_ok=True)
    args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '1920x1080', '-r', str(FPS), '-i', '-', '-i', str(directory / 'mix.wav'), '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', '74', '-movflags', '+faststart', str(opts.output)]
    encoder = subprocess.Popen(args, stdin=subprocess.PIPE)
    try:
        for i in range(74 * FPS):
            encoder.stdin.write(render(i / FPS).tobytes())
            if i % (FPS * 10) == 0:
                print(f'Rendered {i / FPS:.0f}/74 seconds', flush=True)
        encoder.stdin.close()
        if encoder.wait() != 0:
            raise RuntimeError('FFmpeg render failed')
    except BaseException:
        encoder.kill()
        raise
    print(opts.output, flush=True)


if __name__ == '__main__':
    main()
