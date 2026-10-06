import Foundation
import CoreImage
import ImageIO

func emit(_ value:[String:Any]) throws {let data=try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]);print(String(data:data,encoding:.utf8)!)}
if CommandLine.arguments[1] == "--probe" {
    try emit(["backend":"apple","backendVersion":ProcessInfo.processInfo.operatingSystemVersionString,"decoderVersion":"runtime-selected","cameraCount":CIRAWFilter.supportedCameraModels.count])
} else {
    let source=URL(fileURLWithPath:CommandLine.arguments[1]),target=URL(fileURLWithPath:CommandLine.arguments[2])
    guard let filter=CIRAWFilter(imageURL:source) else {throw NSError(domain:"RAW_UNSUPPORTED",code:1)}
    filter.boostAmount=0;filter.boostShadowAmount=0;filter.exposure=0;filter.baselineExposure=0;filter.shadowBias=0
    filter.isGamutMappingEnabled=false;filter.scaleFactor=1
    guard let image=filter.outputImage else {throw NSError(domain:"RAW_UNSUPPORTED",code:2)}
    let rect=image.extent.integral,w=Int(rect.width),h=Int(rect.height)
    guard w>0 && h>0 && w*h<=96000000 && max(w,h)<=16384 else {throw NSError(domain:"RAW_SIZE",code:3)}
    let context=CIContext(options:[.workingColorSpace:CGColorSpace(name:CGColorSpace.extendedLinearSRGB)!, .cacheIntermediates:false])
    FileManager.default.createFile(atPath:target.path,contents:nil)
    let handle=try FileHandle(forWritingTo:target);defer{try? handle.close()}
    // Core Image coordinates are bottom-up; interchange rows are top-down.
    let rows=128
    for top in stride(from:0,to:h,by:rows){
        let count=min(rows,h-top),bounds=CGRect(x:rect.minX,y:rect.maxY-CGFloat(top+count),width:CGFloat(w),height:CGFloat(count))
        var pixels=[Float](repeating:0,count:w*count*4)
        context.render(image,toBitmap:&pixels,rowBytes:w*16,bounds:bounds,format:.RGBAf,colorSpace:CGColorSpace(name:CGColorSpace.extendedLinearSRGB))
        for y in stride(from:count-1,through:0,by:-1){
            for x in 0..<w {pixels[(y*w+x)*4+3]=255}
            try pixels.withUnsafeBytes {data in try handle.write(contentsOf:data[(y*w*16)..<((y+1)*w*16)])}
        }
    }
    try emit(["backend":"apple","backendVersion":ProcessInfo.processInfo.operatingSystemVersionString,"decoderVersion":filter.decoderVersion.rawValue,"width":w,"height":h,"precision":"linear-float32","settings":["whiteBalance":"as-shot","boost":0,"baselineExposure":0,"gamutMapping":false,"colorSpace":"extended-linear-sRGB"]])
}
