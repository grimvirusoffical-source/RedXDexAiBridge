"""Build the NSIS theme from vector geometry, with no runtime image dependencies."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'build' / 'installer-theme'
OUT.mkdir(parents=True, exist_ok=True)
S, W, H = 3, 200, 232
BG, TRACK, RED = '#101014', '#34242c', '#f04464'
font_path = Path('C:/Windows/Fonts/seguisb.ttf')
font = ImageFont.truetype(str(font_path), 17*S) if font_path.exists() else ImageFont.load_default(size=17*S)

def draw_x(draw, cx, cy, scale, color):
    # A standalone geometric X: no square, tile or opaque logo background.
    points = [(-31,-35),(-13,-35),(31,35),(13,35)]
    draw.polygon([(round(cx+x*scale),round(cy+y*scale)) for x,y in points], fill=color)
    points = [(13,-35),(31,-35),(-13,35),(-31,35)]
    draw.polygon([(round(cx+x*scale),round(cy+y*scale)) for x,y in points], fill=color)

sprite = Image.new('RGB', (W, H*101), BG)
for percent in range(101):
    image = Image.new('RGB', (W*S,H*S), BG)
    draw = ImageDraw.Draw(image)
    box = (20*S,12*S,180*S,172*S)
    draw.ellipse(box, outline=TRACK, width=5*S)
    if percent:
        draw.arc(box, start=-90, end=-90+3.6*percent, fill=RED, width=5*S)
    draw_x(draw,100*S,92*S,S,RED)
    label = f'{percent}/100'
    draw.text((100*S,201*S), label, font=font, fill='#f5f0f2', anchor='mm')
    sprite.paste(image.resize((W,H),Image.Resampling.LANCZOS),(0,H*percent))
sprite.save(OUT/'progress-sprite.bmp')

icon=Image.new('RGBA',(256,256),(0,0,0,0))
draw_x(ImageDraw.Draw(icon),128,128,3.0,RED)
icon.save(ROOT/'build'/'installer-icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
icon.save(OUT/'x-transparent.png')
(OUT/'x.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#f04464" d="M19 15h18l44 70H63zM63 15h18L37 85H19z"/></svg>\n',encoding='utf8')
print('Generated red/black installer sprite and transparent X icon.')
