"""Prepare public reference photos for the dependency-free renderer evaluation."""
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1]
folder=root/'test/web/fixtures/calibration'
cases=[('portrait',folder/'portrait.png',None),('night',folder/'night.jpg',None),('high-contrast',folder/'high-contrast.png',None),('backlight',root/'public/assets/alpine-demo.png',None),('sky',root/'public/assets/alpine-demo.png',(400,0,1448,340))]
for name,path,crop in cases:
 im=Image.open(path).convert('RGB')
 if crop:im=im.crop(crop)
 im.thumbnail((640,640),Image.Resampling.LANCZOS)
 im.save(folder/f'{name}.ppm')
 if name in ['backlight','sky']:im.save(folder/f'{name}.png')
 print(name,im.size)
