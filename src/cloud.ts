import { supabase } from './supabase';

export type CloudGroup={id:string;host_id:string;title:string;category:string;city:string;area:string;language:string;description:string;women_only:boolean;trusted_only:boolean;created_at:string};

export async function listCloudGroups(city:string){const {data,error}=await supabase.from('groups').select('*').eq('city',city).order('created_at',{ascending:false});if(error)throw error;return (data??[]) as CloudGroup[];}
export async function createCloudGroup(group:Omit<CloudGroup,'id'|'host_id'|'created_at'>){const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('Sign in required');const {data,error}=await supabase.from('groups').insert({...group,host_id:user.id}).select().single();if(error)throw error;return data as CloudGroup;}
export async function requestCloudMembership(groupId:string){const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('Sign in required');const {error}=await supabase.from('memberships').insert({group_id:groupId,user_id:user.id,status:'pending'});if(error)throw error;}
export async function listCloudHostRequests(groupId:string){const {data,error}=await supabase.from('memberships').select('group_id,user_id,status,created_at,profiles(display_name)').eq('group_id',groupId);if(error)throw error;return data??[];}
export async function decideCloudMembership(groupId:string,userId:string,status:'approved'|'rejected'|'removed'|'blocked'){const {error}=await supabase.from('memberships').update({status}).eq('group_id',groupId).eq('user_id',userId);if(error)throw error;}
export async function submitCloudSafetyRating(groupId:string,rating:number){const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('Sign in required');const {error}=await supabase.from('safety_ratings').insert({group_id:groupId,user_id:user.id,rating});if(error)throw error;}
export async function submitCloudReport(groupId:string,reason:string){const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('Sign in required');const {error}=await supabase.from('reports').insert({group_id:groupId,reporter_id:user.id,reason});if(error)throw error;}
