import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const url=process.env.EXPO_PUBLIC_SUPABASE_URL;
const key=process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const cloudEnabled=Boolean(url&&key&&!url.includes('YOUR_PROJECT_REF'));
export const supabase=createClient(url??'https://invalid.local',key??'not-configured',{
  auth:{storage:AsyncStorage,autoRefreshToken:true,persistSession:true,detectSessionInUrl:false},
});
if(Platform.OS!=='web') AppState.addEventListener('change',state=>state==='active'?supabase.auth.startAutoRefresh():supabase.auth.stopAutoRefresh());
