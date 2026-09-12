declare module 'qrcode-generator' {
  type QR = { addData(data:string):void; make():void; getModuleCount():number; isDark(row:number,col:number):boolean };
  export default function qrcode(typeNumber:number, errorCorrectionLevel:'L'|'M'|'Q'|'H'): QR;
}
