"""Decode licensed real photos from the official wheel and make labeled stress variants."""
from pathlib import Path
from PIL import Image
import zipfile,io,json,hashlib,random,argparse
root=Path(__file__).resolve().parents[1];folder=root/'test/web/fixtures/quality'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--wheel',type=Path,required=True,help='Official scikit-image wheel containing the attributed sample images')
wheel=parser.parse_args().wheel
catalog=[('portrait','astronaut.png','NASA / Eileen Collins','public domain'),('night','rocket.jpg','SpaceX','public domain'),('contrast','camera.png','Lav Varshney','CC0'),('still-life','coffee.png','Rachel Michetti / Pikolo Espresso Bar','CC0'),('pet','chelsea.png','Stefan van der Walt','CC0'),('deep-field','hubble_deep_field.jpg','NASA / Hubble','public domain')]
manifest=[]
previous={}
if (folder/'manifest.json').exists():
 previous={item['id']:item for item in json.loads((folder/'manifest.json').read_text())['cases']}
def save(name,im,source,rights,topic,variant='original',parent=None):
 im=im.convert('RGB');im.thumbnail((640,640),Image.Resampling.LANCZOS)
 im.save(folder/(name+'.png'));im.save(folder/(name+'.ppm'))
 manifest.append(dict(id=name,file=name+'.png',pixels=name+'.ppm',width=im.width,height=im.height,source=source,rights=rights,topic=topic,variant=variant,parent=parent,sha256=hashlib.sha256((folder/(name+'.png')).read_bytes()).hexdigest(),reviewStatus='pending visual editor review',watch=['wrong advice','over-adjustment','unsafe crop','texture loss','preview/export mismatch']))
with zipfile.ZipFile(wheel) as z:
 images={}
 for name,file,source,rights in catalog:
  im=Image.open(io.BytesIO(z.read('skimage/data/'+file)));im.load();images[name]=im.convert('RGB');save(name,im.copy(),source,rights,name)
 # Derived conditions are never counted as new independent photographs.
 im=images['portrait'].crop((112,0,453,512));save('portrait-vertical',im,'derived from portrait','public domain','portrait','2:3 crop','portrait')
 im=images['night'];save('night-wide',im.crop((0,75,640,352)),'derived from night','public domain','night','wide crop','night')
 for name,factor in [('portrait-low',.48),('still-life-high',1.35)]:
  parent='portrait' if name.startswith('portrait') else 'still-life';im=images[parent].copy();im=im.point(lambda value:max(0,min(255,round(value*factor))))
  save(name,im,'derived from '+parent,'same as parent',parent,'synthetic encoded-brightness x'+str(factor),parent)
 random.seed(731);im=images['night'].copy();im.putdata([tuple(max(0,min(255,round(v+random.gauss(0,12)))) for v in pixel) for pixel in im.getdata()])
 save('night-noise',im,'derived from night','public domain','night','synthetic Gaussian channel noise sigma=12 seed=731','night')
for item in manifest:
 if item['id'] in previous:
  for key in ['protectedRegions','protectionStatus']:item[key]=previous[item['id']].get(key,[])
(folder/'manifest.json').write_text(json.dumps({'version':1,'sources':'https://scikit-image.org/docs/stable/api/skimage.data.html','independentPhotos':6,'limitations':['One light-skin portrait only','No camera RAW','Exposure and noise stress conditions are synthetic, not sensor measurements','No independent architecture or mixed-lighting portrait yet'],'cases':manifest},ensure_ascii=False,indent=2)+'\n')
print('Prepared',len(manifest),'cases from 6 real photographs')
