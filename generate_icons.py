import os
from PIL import Image

assets_dir = os.path.join(os.getcwd(), 'assets')
os.makedirs(assets_dir, exist_ok=True)

logo_path = os.path.join(os.getcwd(), 'Resources', 'logo.png')

if os.path.exists(logo_path):
    img = Image.open(logo_path)
    img = img.convert('RGBA')
    for size in [16, 48, 128]:
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(os.path.join(assets_dir, f'icon{size}.png'))
    print('Icons generated successfully from logo.png')
else:
    print('logo.png not found, creating solid icon fallback')
    for size in [16, 48, 128]:
        img = Image.new('RGBA', (size, size), (63, 81, 181, 255))
        img.save(os.path.join(assets_dir, f'icon{size}.png'))
    print('Fallback icons created successfully')
