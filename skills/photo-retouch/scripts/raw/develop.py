"""One-shot decoder. Only pixel interchange and decoder metadata leave Python."""
import sys,json,platform
import numpy as np
import rawpy

if sys.argv[1] == '--probe':
    print(json.dumps({'backend':'rawpy','backendVersion':rawpy.__version__,'decoderVersion':'.'.join(map(str,rawpy.libraw_version))}))
    sys.exit(0)
source,output=sys.argv[1:3]
with rawpy.imread(source) as image:
    h,w=image.sizes.height,image.sizes.width
    if h*w>96000000 or max(h,w)>16384: raise ValueError('RAW dimensions exceed budget')
    rgb=image.postprocess(use_camera_wb=True,no_auto_bright=True,gamma=(1,1),output_bps=16,output_color=rawpy.ColorSpace.sRGB,highlight_mode=rawpy.HighlightMode.Ignore)
    h,w=rgb.shape[:2]
    # Row writes avoid allocating a full Float32 RGBA copy beside the uint16 RGB.
    row=np.empty((w,4),dtype='<f4');row[:,3]=255
    with open(output,'wb') as target:
        for y in range(h):
            row[:,:3]=rgb[y].astype(np.float32)/65535.0
            row.tofile(target)
    print(json.dumps({'backend':'rawpy','backendVersion':rawpy.__version__,'decoderVersion':'.'.join(map(str,rawpy.libraw_version)),'width':w,'height':h,'precision':'linear-rgb16','settings':{'whiteBalance':'as-shot','autoBright':False,'gamma':[1,1],'highlight':'unclip','colorSpace':'sRGB'}}))
