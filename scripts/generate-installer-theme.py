"""Build the NSIS theme using the existing transparent metallic Red-XAI mark."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'build' / 'installer-theme'
LOGO = ROOT / 'build' / 'installer-x-transparent.png'
S, W, H = 3, 200, 232
BG, TRACK, RED = '#101014', '#34242c', '#f04464'
font_path = Path('C:/Windows/Fonts/seguisb.ttf')
font = ImageFont.truetype(str(font_path), 17*S) if font_path.exists() else ImageFont.load_default(size=17*S)

def load_logo(path=LOGO):
    with Image.open(path) as source:
        if source.format != 'PNG':
            raise ValueError('Installer branding must be a transparent PNG.')
        if not (1 <= source.width <= 4096 and 1 <= source.height <= 4096):
            raise ValueError('Installer branding dimensions are invalid.')
        if 'A' not in source.getbands() and 'transparency' not in source.info:
            raise ValueError('Installer branding must include an alpha channel.')
        logo = source.convert('RGBA')
    alpha = logo.getchannel('A')
    minimum, maximum = alpha.getextrema()
    if minimum != 0 or maximum == 0 or alpha.getbbox() is None:
        raise ValueError('Installer branding needs visible artwork and full transparency.')
    if any(alpha.getpixel(point) != 0 for point in
           [(0, 0), (logo.width - 1, 0), (0, logo.height - 1),
            (logo.width - 1, logo.height - 1)]):
        raise ValueError('Installer branding must have transparent corners, without a tile.')
    return logo

def generate():
    logo = load_logo()
    # Contain the supplied canvas without altering its content or alpha. Its
    # transparent padding leaves the metallic tips clear of the 160px ring.
    mark = ImageOps.contain(logo, (128*S, 128*S), Image.Resampling.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    sprite = Image.new('RGB', (W, H*101), BG)
    for percent in range(101):
        image = Image.new('RGB', (W*S,H*S), BG)
        draw = ImageDraw.Draw(image)
        box = (20*S,12*S,180*S,172*S)
        draw.ellipse(box, outline=TRACK, width=5*S)
        if percent:
            draw.arc(box, start=-90, end=-90+3.6*percent, fill=RED, width=5*S)
        image.paste(mark, (100*S - mark.width//2, 92*S - mark.height//2), mark)
        label = f'{percent}/100'
        draw.text((100*S,201*S), label, font=font, fill='#f5f0f2', anchor='mm')
        sprite.paste(image.resize((W,H),Image.Resampling.LANCZOS),(0,H*percent))
    sprite.save(OUT/'progress-sprite.bmp')
    sprite.crop((0, 50*H, W, 51*H)).save(OUT/'progress-preview-50.png')

    icon = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    icon_mark = ImageOps.contain(logo, (256, 256), Image.Resampling.LANCZOS)
    icon.alpha_composite(icon_mark, ((256 - icon_mark.width)//2,
                                     (256 - icon_mark.height)//2))
    icon.save(ROOT/'build'/'installer-icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
    icon.save(OUT/'x-transparent.png')
    # Inert extraction-test payload; this SVG is not the displayed brand artwork.
    (OUT/'x.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#f04464" d="M19 15h18l44 70H63zM63 15h18L37 85H19z"/></svg>\n',encoding='utf8')
    print('Generated metallic Red-XAI installer sprite and transparent icon.')


if __name__ == '__main__':
    generate()
