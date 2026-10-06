import Foundation
import CoreImage
import ImageIO

func emit(_ value:[String:Any]) throws {let data=try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]);print(String(data:data,encoding:.utf8)!)}
func writeLinear(_ image:CIImage,_ target:URL) throws -> (Int,Int) {
    let rect=image.extent.integral,w=Int(rect.width),h=Int(rect.height)
    guard w>0 && h>0 && w*h<=96000000 && max(w,h)<=16384 else {throw NSError(domain:"RAW_SIZE",code:3)}
    let context=CIContext(options:[.workingColorSpace:CGColorSpace(name:CGColorSpace.extendedLinearSRGB)!, .cacheIntermediates:false])
    FileManager.default.createFile(atPath:target.path,contents:nil)
    let handle=try FileHandle(forWritingTo:target);defer{try? handle.close()}
    // Bounds use Core Image bottom-up coordinates. render(toBitmap:) already
    // returns top-down rows within each band; do not reverse them a second time.
    let rows=128
    for top in stride(from:0,to:h,by:rows){
        let count=min(rows,h-top),bounds=CGRect(x:rect.minX,y:rect.maxY-CGFloat(top+count),width:CGFloat(w),height:CGFloat(count))
        var pixels=[Float](repeating:0,count:w*count*4)
        context.render(image,toBitmap:&pixels,rowBytes:w*16,bounds:bounds,format:.RGBAf,colorSpace:CGColorSpace(name:CGColorSpace.extendedLinearSRGB))
        for y in 0..<count {
            for x in 0..<w {pixels[(y*w+x)*4+3]=255}
            try pixels.withUnsafeBytes {data in try handle.write(contentsOf:data[(y*w*16)..<((y+1)*w*16)])}
        }
    }
    return (w,h)
}
if CommandLine.arguments[1] == "--probe" {
    try emit(["backend":"apple","backendVersion":ProcessInfo.processInfo.operatingSystemVersionString,"decoderVersion":"runtime-selected","cameraCount":CIRAWFilter.supportedCameraModels.count])
} else if CommandLine.arguments[1] == "--self-test" {
    let image=CIFilter(name:"CILinearGradient",parameters:["inputPoint0":CIVector(x:0,y:0),"inputPoint1":CIVector(x:0,y:300),"inputColor0":CIColor(red:1,green:0,blue:0),"inputColor1":CIColor(red:0,green:0,blue:1)])!.outputImage!.cropped(to:CGRect(x:0,y:0,width:17,height:300))
    let (w,h)=try writeLinear(image,URL(fileURLWithPath:CommandLine.arguments[2]));try emit(["width":w,"height":h])
} else {
    let source=URL(fileURLWithPath:CommandLine.arguments[1]),target=URL(fileURLWithPath:CommandLine.arguments[2])
    guard let filter=CIRAWFilter(imageURL:source) else {throw NSError(domain:"RAW_UNSUPPORTED",code:1)}
    filter.boostAmount=0;filter.boostShadowAmount=0;filter.exposure=0;filter.baselineExposure=0;filter.shadowBias=0
    filter.isGamutMappingEnabled=false;filter.scaleFactor=1
    guard !filter.decoderVersion.rawValue.isEmpty, let image=filter.outputImage else {throw NSError(domain:"RAW_UNSUPPORTED",code:2)}
    let (w,h)=try writeLinear(image,target)
    try emit(["backend":"apple","backendVersion":ProcessInfo.processInfo.operatingSystemVersionString,"decoderVersion":filter.decoderVersion.rawValue,"width":w,"height":h,"precision":"linear-float32","settings":["whiteBalance":"as-shot","boost":0,"baselineExposure":0,"gamutMapping":false,"colorSpace":"extended-linear-sRGB"]])
}
