import React, { useMemo } from 'react';
import { View } from 'react-native';
import qrcode from 'qrcode-generator';

export function QRCodeMatrix({value,size=190}:{value:string;size?:number}) {
  const matrix=useMemo(()=>{const qr=qrcode(0,'M');qr.addData(value);qr.make();const n=qr.getModuleCount();return {n,cells:Array.from({length:n*n},(_,i)=>qr.isDark(Math.floor(i/n),i%n))};},[value]);
  const cell=size/matrix.n;
  return <View style={{width:size+16,height:size+16,padding:8,backgroundColor:'white',flexDirection:'row',flexWrap:'wrap'}}>{matrix.cells.map((dark,i)=><View key={i} style={{width:cell,height:cell,backgroundColor:dark?'#17211F':'#FFFFFF'}}/>)}</View>;
}
