import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { addPendingConnection, getProfile, hasConnection, listPlans, migrateDatabase, savePlan, saveProfile, type LocalProfile, type StoredPlan } from './src/database';
import { QRCodeMatrix } from './src/QRCodeMatrix';

type Tab = 'Discover' | 'Create' | 'Plans' | 'Profile';
type Hangout = {
  id: number; emoji: string; category: string; title: string; area: string;
  time: string; host: string; spots: number; language: string; audience: string; safety: number; trustedOnly?: boolean;
};

const categories = ['All', 'Women only', 'New in city', 'Sports', 'Trips', 'Food', 'Shopping'];
const hangouts: Hangout[] = [
  { id: 1, emoji: '🏸', category: 'Sports', title: 'Badminton after work', area: 'Anna Nagar', time: 'Today · 7:00 PM', host: 'Arun', spots: 2, language: 'English · Tamil', audience: 'Open group', safety: 4.7 },
  { id: 2, emoji: '💃', category: 'Women only', title: 'Girls dance & coffee circle', area: 'Indiranagar', time: 'Sat · 5:30 PM', host: 'Meera', spots: 4, language: 'English · Tamil', audience: 'Verified women only', safety: 4.9 },
  { id: 3, emoji: '🧳', category: 'New in city', title: 'New to Bengaluru outing', area: 'Koramangala', time: 'Sun · 3:00 PM', host: 'Nikhil', spots: 5, language: 'English · Malayalam', audience: 'Singles · friendship only', safety: 4.6 },
  { id: 4, emoji: '🍜', category: 'Food', title: 'Restaurant hopping', area: 'Church Street', time: 'Sun · 6:30 PM', host: 'Sara', spots: 5, language: 'English', audience: 'Open group', safety: 4.8 },
  { id: 5, emoji: '🛍️', category: 'Shopping', title: 'Weekend street shopping', area: 'Commercial Street', time: 'Sat · 11:00 AM', host: 'Anu', spots: 3, language: 'English · Kannada', audience: 'Verified women only', safety: 4.9 },
  { id: 6, emoji: '🏔️', category: 'Trips', title: 'Nandi Hills sunrise trip', area: 'Starts in North Bengaluru', time: 'Sun · 4:30 AM', host: 'Dev', spots: 4, language: 'English', audience: 'Trusted members only', safety: 4.8, trustedOnly: true },
];

const USER_TRUST = { isAdult: true, isVerified: true, attendedPlans: 3, hasActiveRestriction: false };
const canUseTrips = USER_TRUST.isAdult && USER_TRUST.isVerified && USER_TRUST.attendedPlans >= 3 && !USER_TRUST.hasActiveRestriction;

export default function App() {
  return <SQLiteProvider databaseName="nook.db" onInit={migrateDatabase}><Nook /></SQLiteProvider>;
}

function Nook() {
  const db = useSQLiteContext();
  const [tab, setTab] = useState<Tab>('Discover');
  const [category, setCategory] = useState('All');
  const [joined, setJoined] = useState<number[]>([]);
  const [localPlans, setLocalPlans] = useState<Hangout[]>([]);
  const [profile,setProfile]=useState<LocalProfile|null|undefined>(undefined);
  async function refreshPlans() {
    const rows = await listPlans(db);
    setLocalPlans(rows.map(toHangout));
  }
  useEffect(() => { refreshPlans().catch(() => Alert.alert('Storage error','Could not load plans stored on this phone.')); getProfile(db).then(setProfile).catch(()=>setProfile(null)); }, []);
  const allPlans = useMemo(() => [...localPlans, ...hangouts], [localPlans]);
  const visible = useMemo(() => category === 'All' ? allPlans : allPlans.filter(h => h.category === category), [category, allPlans]);

  if (profile===undefined) return <SafeAreaView style={styles.safe}><View style={styles.loading}><Text style={styles.h1}>Nook</Text><Text style={styles.meta}>Opening your local profile…</Text></View></SafeAreaView>;
  if (profile===null) return <Onboarding onDone={async()=>setProfile(await getProfile(db))} />;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8F6EF" />
      <View style={styles.shell}>
        {tab === 'Discover' && <Discover visible={visible} category={category} setCategory={setCategory} joined={joined} setJoined={setJoined} />}
        {tab === 'Create' && <CreateHub onCreated={async () => { await refreshPlans(); setTab('Discover'); }} />}
        {tab === 'Plans' && <Plans joined={joined} />}
        {tab === 'Profile' && profile && <Profile profile={profile} onEdit={()=>setProfile(null)} />}
        <Nav active={tab} onChange={setTab} />
      </View>
    </SafeAreaView>
  );
}

function toHangout(p: StoredPlan): Hangout { return { id: 10000+p.id, emoji: p.trusted_only ? '🧳' : '✨', category:p.category, title:p.title, area:p.area, time:p.starts_at, host:'You', spots:p.spots, language:p.language, audience:p.trusted_only?'Trusted members only':'Open group', safety:5.0, trustedOnly:!!p.trusted_only }; }

function Discover({ visible, category, setCategory, joined, setJoined }: any) {
  return <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
    <View style={styles.header}><View><Text style={styles.eyebrow}>BENGALURU ▾</Text><Text style={styles.h1}>Find your people.</Text></View><View style={styles.avatar}><Text style={styles.avatarText}>Y</Text></View></View>
    <Text style={styles.intro}>Join something you already want to do—without sharing your number.</Text>
    <View style={styles.trustBanner}><Text style={styles.trustIcon}>✓</Text><View style={{flex:1}}><Text style={styles.trustTitle}>Trusted member</Text><Text style={styles.trustCopy}>3 attended plans · eligible for local trips</Text></View></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {categories.map(c => <TouchableOpacity key={c} onPress={() => setCategory(c)} style={[styles.chip, c === category && styles.chipActive]}><Text style={[styles.chipText, c === category && styles.chipTextActive]}>{c}</Text></TouchableOpacity>)}
    </ScrollView>
    <View style={styles.sectionRow}><Text style={styles.sectionTitle}>Happening nearby</Text><Text style={styles.muted}>Approximate areas</Text></View>
    {visible.map((h: Hangout) => {
      const isJoined = joined.includes(h.id);
      return <View key={h.id} style={styles.card}>
        <View style={styles.cardTop}><View style={styles.icon}><Text style={styles.iconText}>{h.emoji}</Text></View><View style={styles.pill}><Text style={styles.pillText}>★ {h.safety} · {h.spots} spots</Text></View></View>
        <Text style={styles.cardTitle}>{h.title}</Text>
        <Text style={styles.audience}>{h.audience}</Text><Text style={styles.meta}>{h.time}</Text><Text style={styles.meta}>{h.area} · {h.language}</Text>
        {h.trustedOnly && <View style={styles.tripRules}><Text style={styles.tripRulesText}>🔒 Verified profile · 3 attended plans · no active safety restrictions</Text></View>}
        <View style={styles.cardBottom}><Text style={styles.host}>Hosted by {h.host}</Text><TouchableOpacity disabled={isJoined} onPress={() => setJoined([...joined, h.id])} style={[styles.join, h.trustedOnly && styles.tripJoin, isJoined && styles.joined]}><Text style={styles.joinText}>{isJoined ? 'Requested' : h.trustedOnly ? 'Request trip' : 'Ask to join'}</Text></TouchableOpacity></View>
      </View>;
    })}
    <View style={{height: 92}} />
  </ScrollView>;
}

function CreateHub({onCreated}:{onCreated:()=>Promise<void>}) {
  const db = useSQLiteContext();
  const [kind, setKind] = useState<'local'|'trip'>('local');
  const [title,setTitle]=useState(''); const [area,setArea]=useState(''); const [startsAt,setStartsAt]=useState('');
  const [language,setLanguage]=useState('English'); const [spots,setSpots]=useState('4'); const [saving,setSaving]=useState(false);
  async function submit() {
    if (!title.trim() || !area.trim() || !startsAt.trim()) return Alert.alert('Complete the plan','Add an activity, area, and date/time.');
    if (kind==='trip' && !canUseTrips) return Alert.alert('Trips are locked','Complete verification and attend three local plans first.');
    const count=Number(spots); if (!Number.isInteger(count)||count<2||count>12) return Alert.alert('Check group size','Choose between 2 and 12 people.');
    setSaving(true);
    try { await savePlan(db,{title,category:kind==='trip'?'Trips':'New in city',area,starts_at:startsAt,language,spots:count,trustedOnly:kind==='trip'}); Alert.alert('Plan saved','This plan now lives on your phone.'); await onCreated(); }
    catch { Alert.alert('Could not save','Please check the details and try again.'); }
    finally { setSaving(false); }
  }
  return <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
    <Text style={styles.h1}>Make a plan</Text><Text style={styles.intro}>Start with what you want to do—not who you want to meet.</Text>
    <View style={styles.kindRow}>
      <TouchableOpacity onPress={() => setKind('local')} style={[styles.kindCard, kind==='local' && styles.kindActive]}><Text style={styles.kindEmoji}>☕</Text><Text style={styles.kindTitle}>Local activity</Text><Text style={styles.kindCopy}>Meet in a public place for a few hours.</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => setKind('trip')} style={[styles.kindCard, kind==='trip' && styles.kindActive]}><Text style={styles.kindEmoji}>🧳</Text><Text style={styles.kindTitle}>Plan a trip</Text><Text style={styles.kindCopy}>Available only to trusted members.</Text></TouchableOpacity>
    </View>
    {kind==='trip' && <>
      <View style={styles.tripHero}><Text style={styles.tripHeroTitle}>Trusted trips</Text><Text style={styles.tripHeroText}>Trips unlock after 3 successfully attended local plans, profile verification and no active safety restrictions.</Text></View>
      <View style={styles.tripWarning}><Text style={styles.tripWarningTitle}>Public trips first</Text><Text style={styles.meta}>V0 allows only local day trips with a public start point. Private stays, international travel and rides with unverified members remain blocked.</Text></View>
    </>}
    <Text style={styles.sectionTitle}>{kind==='trip'?'Trip essentials':'Local plan essentials'}</Text>
    <Field label={kind==='trip'?'Destination and purpose':'Activity and purpose'} value={title} onChangeText={setTitle} placeholder={kind==='trip'?'Nandi Hills sunrise day trip':'Badminton after work'} />
    <Field label={kind==='trip'?'Public meeting point':'Approximate area'} value={area} onChangeText={setArea} placeholder="Indiranagar" />
    <Field label={kind==='trip'?'Start and return time':'Date and start time'} value={startsAt} onChangeText={setStartsAt} placeholder="Sunday · 7:00 AM" />
    <Field label="Group language" value={language} onChangeText={setLanguage} placeholder="English · Malayalam" />
    <Field label="Total group size" value={spots} onChangeText={setSpots} placeholder="4" keyboardType="number-pad" />
    {kind==='trip' && <View style={styles.requiredList}><Text style={styles.requiredTitle}>Required before publishing</Text><Text style={styles.meta}>Transport plan · expected cost · return point · emergency sharing · cancellation agreement</Text></View>}
    <TouchableOpacity disabled={saving} onPress={submit} style={[styles.primaryWide,kind==='trip'&&styles.tripButton,saving&&styles.joined]}><Text style={styles.primaryText}>{saving?'Saving…':kind==='trip'?'Save trusted trip':'Save local plan'}</Text></TouchableOpacity>
    <View style={{height:90}} />
  </ScrollView>;
}

function Field({label,...props}:{label:string;value:string;onChangeText:(v:string)=>void;placeholder:string;keyboardType?:'default'|'number-pad'}) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...props} placeholderTextColor="#9A9F9C" style={styles.input} /></View>; }

function Plans({ joined }: {joined: number[]}) {
  const plans = hangouts.filter(h => joined.includes(h.id));
  return <ScrollView contentContainerStyle={styles.page}><Text style={styles.h1}>Your plans</Text><Text style={styles.intro}>Requests and confirmed meetups appear here.</Text>{plans.length ? plans.map(h => <View key={h.id} style={styles.card}><Text style={styles.cardTitle}>{h.emoji}  {h.title}</Text><Text style={styles.meta}>{h.time} · {h.area}</Text><View style={styles.pending}><Text style={styles.pendingText}>Waiting for host approval</Text></View></View>) : <Empty emoji="☀" title="Nothing planned yet" body="Discover a hangout and ask to join. Your exact location is never shared publicly." action="Browse activities" />}</ScrollView>;
}

function Onboarding({onDone}:{onDone:()=>Promise<void>}) { const db=useSQLiteContext(); const [name,setName]=useState(''); const [city,setCity]=useState('Bengaluru'); const [zone,setZone]=useState(''); const [languages,setLanguages]=useState('English'); const [interests,setInterests]=useState(''); const [bio,setBio]=useState(''); async function submit(){if(!name.trim()||!zone.trim()||!interests.trim())return Alert.alert('Almost there','Add your name, area and interests.'); await saveProfile(db,{name,city,zone,languages,interests,bio}); await onDone();} return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}><Text style={styles.eyebrow}>LOCAL PROFILE</Text><Text style={styles.h1}>What brings you outside?</Text><Text style={styles.intro}>This stays on your phone for now. Share only what helps others understand the activity.</Text><Field label="First name" value={name} onChangeText={setName} placeholder="Yadhu"/><Field label="City" value={city} onChangeText={setCity} placeholder="Bengaluru"/><Field label="Approximate area" value={zone} onChangeText={setZone} placeholder="Indiranagar"/><Field label="Languages" value={languages} onChangeText={setLanguages} placeholder="English · Malayalam"/><Field label="Interests" value={interests} onChangeText={setInterests} placeholder="Badminton, food, drawing"/><Field label="Short bio (optional)" value={bio} onChangeText={setBio} placeholder="New to the city and looking for weekend plans"/><TouchableOpacity onPress={submit} style={styles.primaryWide}><Text style={styles.primaryText}>Create local profile</Text></TouchableOpacity></ScrollView></SafeAreaView>; }

function Profile({profile,onEdit}:{profile:LocalProfile;onEdit:()=>void}) { const initial=profile.name.slice(0,1).toUpperCase(); const [mode,setMode]=useState<'profile'|'show'|'scan'>('profile'); const [nonce,setNonce]=useState(Crypto.randomUUID()); const expiry=Date.now()+5*60*1000; const payload=JSON.stringify({v:1,type:'nook-connect',account:profile.account_code,name:profile.name,exp:expiry,nonce}); if(mode==='show') return <SafeAreaView style={styles.safe}><View style={styles.qrScreen}><Text style={styles.h1}>Connect in person</Text><Text style={styles.intro}>Ask the other person to scan this within 5 minutes.</Text><QRCodeMatrix value={payload}/><Text style={styles.accountCode}>{profile.account_code}</Text><Text style={styles.qrCopy}>No phone number or contact list is shared.</Text><TouchableOpacity onPress={()=>{setNonce(Crypto.randomUUID());setMode('profile')}} style={styles.primaryWide}><Text style={styles.primaryText}>Done</Text></TouchableOpacity></View></SafeAreaView>; if(mode==='scan') return <QRScanner ownCode={profile.account_code} onClose={()=>setMode('profile')}/>; return <ScrollView contentContainerStyle={styles.page}><Text style={styles.h1}>Your colourful corner</Text><View style={styles.profileCard}><View style={styles.profileGlow}><View style={styles.bigAvatar}><Text style={styles.bigAvatarText}>{initial}</Text></View><View style={styles.verified}><Text style={styles.verifiedText}>Local profile</Text></View></View><Text style={styles.profileName}>{profile.name}</Text><Text style={styles.profileBio}>{profile.bio||'Ready for a real plan, not endless chatting'}</Text><Text style={styles.profileLocation}>📍 {profile.zone}, {profile.city}  ·  {profile.languages}</Text><View style={styles.qr}><Text style={styles.qrMark}>▦</Text><View style={{flex:1}}><Text style={styles.qrTitle}>Private connection</Text><Text style={styles.accountCode}>{profile.account_code}</Text><Text style={styles.qrCopy}>Use a rotating QR after meeting. Your phone number stays private.</Text></View></View><View style={styles.qrActions}><TouchableOpacity onPress={()=>setMode('show')} style={styles.qrAction}><Text style={styles.qrActionText}>Show my QR</Text></TouchableOpacity><TouchableOpacity onPress={()=>setMode('scan')} style={styles.qrActionAlt}><Text style={styles.qrActionAltText}>Scan QR</Text></TouchableOpacity></View></View><Text style={styles.sectionTitle}>My vibe</Text><View style={styles.wrap}>{profile.interests.split(',').map(x => <View key={x} style={styles.colorChip}><Text style={styles.colorChipText}>{x.trim()}</Text></View>)}</View><TouchableOpacity onPress={onEdit} style={styles.editButton}><Text style={styles.editText}>Edit local profile</Text></TouchableOpacity><View style={styles.safety}><Text style={styles.safetyTitle}>Trust & privacy</Text><Text style={styles.meta}>A scan creates a pending local connection. It does not reveal contact details or prove global identity.</Text></View></ScrollView>; }

function QRScanner({ownCode,onClose}:{ownCode:string;onClose:()=>void}) { const db=useSQLiteContext(); const [permission,requestPermission]=useCameraPermissions(); const [locked,setLocked]=useState(false); async function scanned({data}:{data:string}){if(locked)return;setLocked(true);try{const p=JSON.parse(data);if(p.type!=='nook-connect'||p.v!==1||!p.account||!p.name||!p.exp)throw new Error('format');if(p.account===ownCode)return Alert.alert('That is your QR','Ask the other person to show theirs.');if(Date.now()>p.exp)return Alert.alert('QR expired','Ask them to generate a new QR.');if(await hasConnection(db,p.account))return Alert.alert('Already connected','This account is already on your phone.');Alert.alert(`Connect with ${p.name}?`,'This creates a pending connection. No contact details will be shared.',[{text:'Cancel',style:'cancel',onPress:()=>setLocked(false)},{text:'Add pending',onPress:async()=>{await addPendingConnection(db,p.account,p.name);Alert.alert('Pending connection saved');onClose();}}]);}catch{Alert.alert('Not a Nook QR','Ask the person to open their connection QR.',[{text:'Try again',onPress:()=>setLocked(false)}]);}} if(!permission)return <SafeAreaView style={styles.safe}/>; if(!permission.granted)return <SafeAreaView style={styles.safe}><View style={styles.qrScreen}><Text style={styles.h1}>Scan connection QR</Text><Text style={styles.intro}>Camera access is used only while this scanner is open.</Text><TouchableOpacity onPress={requestPermission} style={styles.primaryWide}><Text style={styles.primaryText}>Allow camera</Text></TouchableOpacity><TouchableOpacity onPress={onClose} style={styles.editButton}><Text style={styles.editText}>Cancel</Text></TouchableOpacity></View></SafeAreaView>; return <SafeAreaView style={styles.scanner}><CameraView style={StyleSheet.absoluteFillObject} barcodeScannerSettings={{barcodeTypes:['qr']}} onBarcodeScanned={scanned}/><View style={styles.scanOverlay}><Text style={styles.scanTitle}>Scan Nook QR</Text><View style={styles.scanFrame}/><TouchableOpacity onPress={onClose} style={styles.scanClose}><Text style={styles.primaryText}>Close scanner</Text></TouchableOpacity></View></SafeAreaView>; }

function Empty({emoji, title, body, action}: {emoji:string; title:string; body:string; action:string}) { return <View style={styles.empty}><Text style={styles.emptyEmoji}>{emoji}</Text><Text style={styles.cardTitle}>{title}</Text><Text style={[styles.meta, {textAlign:'center'}]}>{body}</Text><TouchableOpacity style={styles.primary}><Text style={styles.primaryText}>{action}</Text></TouchableOpacity></View>; }

function Nav({active, onChange}: {active:Tab; onChange:(tab:Tab)=>void}) { const items: {name:Tab; icon:string}[] = [{name:'Discover',icon:'⌂'},{name:'Create',icon:'＋'},{name:'Plans',icon:'◷'},{name:'Profile',icon:'○'}]; return <View style={styles.nav}>{items.map(i => <TouchableOpacity key={i.name} style={styles.navItem} onPress={() => onChange(i.name)}><Text style={[styles.navIcon, active === i.name && styles.navActive]}>{i.icon}</Text><Text style={[styles.navText, active === i.name && styles.navActive]}>{i.name}</Text></TouchableOpacity>)}</View>; }

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#F8F6EF'}, shell:{flex:1}, page:{padding:20,paddingTop:24}, header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}, eyebrow:{fontSize:12,fontWeight:'800',letterSpacing:1.4,color:'#247064',marginBottom:8}, h1:{fontSize:34,lineHeight:39,fontWeight:'800',color:'#17211F',letterSpacing:-1}, intro:{fontSize:16,color:'#68716D',marginTop:8,marginBottom:22}, avatar:{width:44,height:44,borderRadius:22,backgroundColor:'#F0AF49',alignItems:'center',justifyContent:'center'}, avatarText:{fontWeight:'800',fontSize:17,color:'#17211F'}, chips:{gap:9,paddingBottom:22}, chip:{paddingHorizontal:16,paddingVertical:10,borderRadius:22,backgroundColor:'#ECEAE3'}, chipActive:{backgroundColor:'#247064'}, chipText:{fontWeight:'700',color:'#4F5955'}, chipTextActive:{color:'white'}, sectionRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline',marginBottom:12}, sectionTitle:{fontSize:18,fontWeight:'800',color:'#17211F',marginVertical:14}, muted:{fontSize:12,color:'#8A918E'}, card:{backgroundColor:'#FFFFFF',borderRadius:22,padding:18,marginBottom:14,borderWidth:1,borderColor:'#ECEAE3'}, cardTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:12}, icon:{width:46,height:46,borderRadius:14,backgroundColor:'#F4F1E8',alignItems:'center',justifyContent:'center'}, iconText:{fontSize:23}, pill:{backgroundColor:'#E3F2EC',paddingHorizontal:10,paddingVertical:6,borderRadius:12}, pillText:{color:'#247064',fontWeight:'800',fontSize:12}, cardTitle:{fontSize:20,fontWeight:'800',color:'#17211F',marginBottom:7}, meta:{fontSize:14,lineHeight:21,color:'#68716D'}, cardBottom:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:16}, host:{fontSize:13,fontWeight:'600',color:'#68716D'}, join:{backgroundColor:'#E76F51',paddingHorizontal:15,paddingVertical:11,borderRadius:14}, joined:{backgroundColor:'#82908B'}, joinText:{color:'white',fontWeight:'800'}, nav:{position:'absolute',left:12,right:12,bottom:10,height:70,backgroundColor:'#17211F',borderRadius:24,flexDirection:'row',alignItems:'center',justifyContent:'space-around',paddingHorizontal:7}, navItem:{alignItems:'center',minWidth:65}, navIcon:{fontSize:21,color:'#8FA09A'}, navText:{fontSize:10,fontWeight:'700',marginTop:3,color:'#8FA09A'}, navActive:{color:'#F0AF49'}, empty:{marginTop:70,alignItems:'center',paddingHorizontal:28}, emptyEmoji:{fontSize:42,marginBottom:18}, primary:{backgroundColor:'#247064',paddingHorizontal:20,paddingVertical:14,borderRadius:16,marginTop:22}, primaryText:{color:'white',fontWeight:'800'}, pending:{alignSelf:'flex-start',marginTop:14,padding:9,borderRadius:10,backgroundColor:'#FFF1D8'}, pendingText:{fontSize:12,fontWeight:'700',color:'#8B6226'}, profile:{alignItems:'center',paddingVertical:28}, bigAvatar:{width:76,height:76,borderRadius:38,backgroundColor:'#F0AF49',alignItems:'center',justifyContent:'center',marginBottom:13}, bigAvatarText:{fontSize:28,fontWeight:'800'}, wrap:{flexDirection:'row',flexWrap:'wrap',gap:9}, safety:{backgroundColor:'#E3F2EC',borderRadius:20,padding:18,marginTop:30}, safetyTitle:{fontSize:17,fontWeight:'800',color:'#247064',marginBottom:7}
  ,audience:{alignSelf:'flex-start',backgroundColor:'#F5E8FF',color:'#70408C',fontSize:11,fontWeight:'800',paddingHorizontal:9,paddingVertical:5,borderRadius:9,marginBottom:8},profileCard:{backgroundColor:'#503A82',borderRadius:28,padding:22,marginTop:22,overflow:'hidden'},profileGlow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},verified:{backgroundColor:'#DDF7E8',borderRadius:13,paddingHorizontal:10,paddingVertical:7},verifiedText:{color:'#176448',fontWeight:'800',fontSize:12},profileName:{fontSize:28,fontWeight:'900',color:'white'},profileBio:{fontSize:15,color:'#E8DFFF',marginTop:5},profileLocation:{fontSize:13,color:'#D4C9F1',marginTop:10},qr:{backgroundColor:'#FFFFFF',borderRadius:18,padding:14,marginTop:20,flexDirection:'row',alignItems:'center',gap:13},qrMark:{fontSize:38,color:'#17211F'},qrTitle:{fontSize:15,fontWeight:'900',color:'#17211F'},qrCopy:{fontSize:11,lineHeight:16,color:'#68716D',marginTop:2},colorChip:{paddingHorizontal:14,paddingVertical:10,borderRadius:22,backgroundColor:'#FFE5B9'},colorChipText:{fontWeight:'800',color:'#6A4711'},trustBanner:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:'#E5F5ED',padding:14,borderRadius:18,marginBottom:18},trustIcon:{width:32,height:32,borderRadius:16,textAlign:'center',textAlignVertical:'center',backgroundColor:'#247064',color:'white',fontWeight:'900'},trustTitle:{fontSize:14,fontWeight:'900',color:'#174E45'},trustCopy:{fontSize:12,color:'#55716A',marginTop:2},tripRules:{backgroundColor:'#EEF0FF',padding:10,borderRadius:12,marginTop:12},tripRulesText:{fontSize:11,fontWeight:'700',color:'#4B4F83'},tripJoin:{backgroundColor:'#4E56A6'},kindRow:{flexDirection:'row',gap:12},kindCard:{flex:1,minHeight:150,backgroundColor:'#FFFFFF',borderWidth:2,borderColor:'#ECEAE3',borderRadius:22,padding:16},kindActive:{borderColor:'#247064',backgroundColor:'#F1FAF6'},kindEmoji:{fontSize:27,marginBottom:13},kindTitle:{fontSize:16,fontWeight:'900',color:'#17211F'},kindCopy:{fontSize:12,lineHeight:17,color:'#68716D',marginTop:5},formRow:{height:54,flexDirection:'row',alignItems:'center',backgroundColor:'#FFFFFF',borderBottomWidth:1,borderBottomColor:'#ECEAE3',paddingHorizontal:13},formNumber:{width:26,height:26,borderRadius:13,backgroundColor:'#ECEAE3',textAlign:'center',textAlignVertical:'center',fontSize:12,fontWeight:'800',color:'#59615E'},formLabel:{flex:1,fontSize:14,fontWeight:'700',color:'#28322F',marginLeft:11},formArrow:{fontSize:24,color:'#8A918E'},primaryWide:{backgroundColor:'#247064',paddingVertical:16,borderRadius:17,alignItems:'center',marginTop:20},tripHero:{backgroundColor:'#4E56A6',borderRadius:22,padding:18,marginTop:20},tripHeroTitle:{fontSize:21,fontWeight:'900',color:'white'},tripHeroText:{fontSize:13,lineHeight:19,color:'#E6E8FF',marginTop:7},tripWarning:{backgroundColor:'#FFF1D8',padding:16,borderRadius:18,marginTop:18},tripWarningTitle:{fontSize:15,fontWeight:'900',color:'#7B541C',marginBottom:5},tripButton:{backgroundColor:'#4E56A6'},field:{marginBottom:13},fieldLabel:{fontSize:12,fontWeight:'800',color:'#4F5955',marginBottom:6},input:{height:50,backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#DDDAD0',borderRadius:14,paddingHorizontal:14,fontSize:15,color:'#17211F'},requiredList:{backgroundColor:'#EEF0FF',padding:15,borderRadius:16,marginTop:4},requiredTitle:{fontSize:13,fontWeight:'900',color:'#4E56A6',marginBottom:4},loading:{flex:1,alignItems:'center',justifyContent:'center',gap:10},accountCode:{fontSize:17,fontWeight:'900',letterSpacing:1.5,color:'#503A82',marginTop:3},editButton:{marginTop:22,borderWidth:1,borderColor:'#503A82',paddingVertical:13,borderRadius:15,alignItems:'center'},editText:{fontWeight:'800',color:'#503A82'},qrActions:{flexDirection:'row',gap:10,marginTop:14},qrAction:{flex:1,backgroundColor:'#F0AF49',padding:13,borderRadius:14,alignItems:'center'},qrActionText:{fontWeight:'900',color:'#2C2417'},qrActionAlt:{flex:1,borderWidth:1,borderColor:'#D8CCF5',padding:13,borderRadius:14,alignItems:'center'},qrActionAltText:{fontWeight:'900',color:'white'},qrScreen:{flex:1,alignItems:'center',justifyContent:'center',padding:28},scanner:{flex:1,backgroundColor:'#000'},scanOverlay:{flex:1,alignItems:'center',justifyContent:'space-around',paddingVertical:60},scanTitle:{fontSize:22,fontWeight:'900',color:'white',backgroundColor:'#00000099',padding:12,borderRadius:12},scanFrame:{width:245,height:245,borderWidth:4,borderColor:'#F0AF49',borderRadius:24},scanClose:{backgroundColor:'#17211F',paddingHorizontal:24,paddingVertical:14,borderRadius:16}
});
