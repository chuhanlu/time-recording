import { useEffect, useMemo, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Plus, Clock3, FlaskConical, CalendarDays, ChartNoAxesCombined, Trash2, Pencil, Download } from 'lucide-react'
import './App.css'
import CategoryManager from './CategoryManager.jsx'
import {CATEGORY_KEY,loadCategories,includeCategories,splitHourly} from './categories.js'
import { parseBackup, planImport } from './backup.js'

const PROJECTS = ['pQMA-ZK', 'HSP', 'SOI', 'EFI-1PRS', '其他']
const KEY = 'time-recording-v1' // Keep the same key so existing v1.0 records are preserved.
const DAY = 1440
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const shiftDate = (day, amount) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate()+amount); return localDate(d) }
const minutes = t => { const [h,m] = t.split(':').map(Number); return h*60+m }
const timeLabel = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
const pretty = n => `${Math.floor(n/60)}小时${n%60 ? `${n%60}分` : ''}`
const initialForm = (date=localDate()) => ({title:'',date,start:'09:30',end:'10:30',category:'核心科研',project:'pQMA-ZK',note:''})

// End 24:00 means midnight at the end of the start date, including a full day from 00:00.
// An entry with end < start continues into the next day. Equal start/end is invalid.
const absoluteInterval = r => {
  const start = Date.parse(`${r.date}T00:00:00`) / 60000 + minutes(r.start)
  const end = Date.parse(`${r.date}T00:00:00`) / 60000 + minutes(r.end) + (minutes(r.end)<minutes(r.start) ? DAY : 0)
  return {start,end}
}
const duration = r => { const {start,end} = absoluteInterval(r); return Math.max(0,end-start) }
const segmentsForDay = (records, day) => {
  const dayStart = Date.parse(`${day}T00:00:00`) / 60000
  return records.flatMap(r => {
    if (!r?.date || !r?.start || !r?.end) return []
    const {start,end} = absoluteInterval(r)
    const a = Math.max(start,dayStart), b = Math.min(end,dayStart+DAY)
    return b>a ? [{...r,segmentStart:a-dayStart,segmentEnd:b-dayStart,segmentMinutes:b-a,continuesFromYesterday:start<dayStart,continuesTomorrow:end>dayStart+DAY}] : []
  }).sort((a,b)=>a.segmentStart-b.segmentStart)
}
const calculateGaps = segments => {
  const gaps=[]; let cursor=0
  for(const s of segments){if(s.segmentStart>cursor)gaps.push({start:cursor,end:s.segmentStart});cursor=Math.max(cursor,s.segmentEnd)}
  if(cursor<DAY)gaps.push({start:cursor,end:DAY})
  return gaps
}
function App(){
  const [records,setRecords] = useState(()=>{try{const value=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(value)?value:[]}catch{return []}})
  const [categories,setCategories]=useState(()=>loadCategories(records))
  const [showCategories,setShowCategories]=useState(false)
  const categoryInfo=name=>categories.find(c=>c.name===name)
  const isResearch=name=>['core','research'].includes(categoryInfo(name)?.kind)
  const isCore=r=>categoryInfo(r.category)?.kind==='core'
  const categoryColor=name=>categoryInfo(name)?.color||'#64748b'
  const saveCategories=(next,nextRecords)=>{
    const previousCategories=localStorage.getItem(CATEGORY_KEY),previousRecords=localStorage.getItem(KEY)
    try{localStorage.setItem(CATEGORY_KEY,JSON.stringify(next));localStorage.setItem(KEY,JSON.stringify(nextRecords))}
    catch(err){if(previousCategories===null)localStorage.removeItem(CATEGORY_KEY);else localStorage.setItem(CATEGORY_KEY,previousCategories);if(previousRecords!==null)localStorage.setItem(KEY,previousRecords);throw err}
    setCategories(next);setRecords(nextRecords)
  }
  const [tab,setTab]=useState('today')
  const [date,setDate]=useState(localDate())
  const [showForm,setShowForm]=useState(false)
  const [form,setForm]=useState(initialForm())
  const [editing,setEditing]=useState(null)
  const [error,setError]=useState('')
  const [showImport,setShowImport]=useState(false)
  const [importData,setImportData]=useState(null)
  const [importError,setImportError]=useState('')
  const [importBusy,setImportBusy]=useState(false)
  const [importMessage,setImportMessage]=useState('')
  const importPlan=useMemo(()=>importData?planImport(records,importData.records):null,[records,importData])
  const readBackup=async e=>{
    const file=e.target.files?.[0]
    setImportData(null);setImportError('')
    if(!file)return
    setImportBusy(true)
    try{
      if(file.size>5*1024*1024)throw new Error('文件超过 5 MB，请选择较小的备份文件。')
      const parsed=parseBackup(await file.text())
      setImportData({name:file.name,records:parsed})
    }catch(err){setImportError(err.message)}finally{setImportBusy(false)}
  }
  const restoreBackup=()=>{
    if(!importPlan?.additions.length)return
    const merged=[...records,...importPlan.additions]
    try{localStorage.setItem(KEY,JSON.stringify(merged))}
    catch{setImportError('保存失败，浏览器存储空间不足或不可用；尚未恢复，请先导出当前记录。');return}
    setCategories(old=>includeCategories(old,merged));setRecords(merged)
    setImportMessage(`恢复完成：新增 ${importPlan.additions.length} 条，跳过 ${importPlan.duplicates} 条重复 ID。`)
    setImportData(null);setShowImport(false)
  }
  useEffect(()=>localStorage.setItem(KEY,JSON.stringify(records)),[records])
  useEffect(()=>localStorage.setItem(CATEGORY_KEY,JSON.stringify(categories)),[categories])
  const daily=useMemo(()=>segmentsForDay(records,date),[records,date])
  const total=daily.reduce((s,r)=>s+r.segmentMinutes,0)
  const research=daily.filter(isCore).reduce((s,r)=>s+r.segmentMinutes,0)
  const gaps=useMemo(()=>splitHourly(calculateGaps(daily)),[daily])
  const uncovered=gaps.reduce((s,g)=>s+g.end-g.start,0)
  const covered=DAY-uncovered
  const categoryData=categories.map(({name,color})=>({name,value:daily.filter(r=>r.category===name).reduce((s,r)=>s+r.segmentMinutes,0),color})).filter(x=>x.value)
  const last7=Array.from({length:7},(_,i)=>{const k=shiftDate(date,-6+i);const d=new Date(`${k}T12:00:00`);return {day:`${d.getMonth()+1}/${d.getDate()}`,hours:+(segmentsForDay(records,k).filter(isCore).reduce((s,r)=>s+r.segmentMinutes,0)/60).toFixed(2)}})
  const openNew=(prefill=null)=>{setEditing(null);setError('');setForm({...initialForm(date),category:categories.find(c=>c.kind==='core')?.name||categories[0].name,...prefill});setShowForm(true)}
  const edit=r=>{setEditing(r.id);setError('');const {segmentStart,segmentEnd,segmentMinutes,continuesFromYesterday,continuesTomorrow,...original}=r;setForm(original);setShowForm(true)}
  const save=e=>{
    e.preventDefault()
    if(!form.title.trim())return setError('请输入活动名称。')
    if(form.start===form.end)return setError('开始和结束时间不能相同。')
    const item={...form,title:form.title.trim(),id:editing||crypto.randomUUID()}
    const candidate=absoluteInterval(item)
    const conflict=records.find(r=>r.id!==editing&&r.date&&r.start&&r.end&&candidate.start<absoluteInterval(r).end&&candidate.end>absoluteInterval(r).start)
    if(conflict)return setError(`与「${conflict.title}」（${conflict.date} ${conflict.start}–${conflict.end}）时间重叠，请调整后保存。`)
    setRecords(old=>editing?old.map(r=>r.id===editing?item:r):[...old,item]);setShowForm(false);setError('')
  }
  const remove=id=>{if(window.confirm('确定删除这条记录吗？'))setRecords(old=>old.filter(r=>r.id!==id))}
  const exportJSON=()=>{const blob=new Blob([JSON.stringify(records.map(r=>({...r,categoryColor:categoryColor(r.category),categoryKind:categoryInfo(r.category)?.kind||'other'})),null,2)],{type:'application/json'});const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=`time-recording-${localDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  const addFromGap = gap => {
    const start=gap.start===DAY ? DAY-1 : gap.start
    const end=timeLabel(gap.end)
    openNew({date,start:timeLabel(start),end})
  }
  const datePicker=<input aria-label="选择日期" className="date-input" type="date" value={date} onChange={e=>setDate(e.target.value)}/>
  const recordsView= daily.length ? daily.map(r=><div className="record" key={`${r.id}-${r.segmentStart}`}><div className="record-time">{timeLabel(r.segmentStart)}<span>—</span>{r.segmentEnd===DAY?'24:00':timeLabel(r.segmentEnd)}</div><div className="record-main"><strong>{r.title}</strong><div><span className="dot" style={{background:categoryColor(r.category)}}/>{r.category}{r.project&&isResearch(r.category)?` · ${r.project}`:''}{r.continuesFromYesterday?' · 昨日开始':''}{r.continuesTomorrow?' · 延续至次日':''}</div></div><div className="record-duration">{pretty(r.segmentMinutes)}</div><button title="编辑" className="icon-btn" onClick={()=>edit(r)}><Pencil size={15}/></button><button title="删除" className="icon-btn" onClick={()=>remove(r.id)}><Trash2 size={15}/></button></div>) : <div className="empty">还没有记录。点击右上角「添加记录」开始吧。</div>
  return <div className="app"><aside className="sidebar"><div className="brand"><span className="brand-icon">◷</span><div><strong>我的时间账本</strong><small>记录时间，观察生活</small></div></div><nav>{[['today',Clock3,'今日记录'],['stats',ChartNoAxesCombined,'统计分析'],['history',CalendarDays,'历史记录']].map(([id,Icon,label])=><button key={id} className={`nav-btn ${tab===id?'active':''}`} onClick={()=>setTab(id)}><Icon size={18}/>{label}</button>)}<button className="nav-btn" onClick={()=>setShowCategories(true)}>分类管理</button></nav><div className="sidebar-bottom">所有数据保存在当前浏览器<br/>建议定期导出备份</div></aside>
  <main className="main"><header><div><div className="eyebrow">PERSONAL TIME JOURNAL · V1.1</div><h1>{tab==='today'?'今日记录':tab==='stats'?'统计分析':'历史记录'}</h1><p className="subtitle">把每一天，变成可以回顾的生活。</p></div><button className="primary" onClick={()=>openNew()}><Plus size={18}/> 添加记录</button></header>
  {tab==='today'&&<><div className="topline"><h2>时间概览</h2>{datePicker}</div><section className="metrics"><div className="metric"><span><Clock3 size={17}/> 已记录时间</span><strong>{pretty(total)}</strong><small>当天活动时长（跨午夜自动拆分）</small></div><div className="metric"><span><FlaskConical size={17}/> 核心科研</span><strong>{pretty(research)}</strong><small>占已记录时间 {total?Math.round(research/total*100):0}%</small></div><div className="metric"><span>◴ 当日覆盖率</span><strong>{Math.round(covered/DAY*100)}%</strong><small>{pretty(uncovered)} 尚未记录</small></div></section><div className="grid"><section className="card"><div className="card-title"><h2>当日活动</h2><span>{daily.length} 段活动</span></div>{recordsView}</section><section className="card"><div className="card-title"><h2>当日时间分布</h2><span>按分类</span></div>{categoryData.length?<><div className="donut"><ResponsiveContainer width="100%" height={230}><PieChart><Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={67} outerRadius={93} paddingAngle={3}>{categoryData.map(x=><Cell key={x.name} fill={x.color}/>)}</Pie><Tooltip formatter={v=>pretty(v)}/></PieChart></ResponsiveContainer></div><div className="legend">{categoryData.map(x=><div key={x.name}><span className="dot" style={{background:x.color}}/>{x.name}<b>{pretty(x.value)}</b></div>)}</div></>:<div className="empty">添加记录后自动显示分类图表</div>}</section></div><section className="card gap-card"><div className="card-title"><h2>24 小时时间轴</h2><span>点击未记录区间补录</span></div><div className="timeline"><div className="timeline-bar">{daily.map(r=><div key={`${r.id}-${r.segmentStart}`} title={`${r.title} · ${timeLabel(r.segmentStart)}–${timeLabel(r.segmentEnd)}`} className="timeline-piece" style={{left:`${r.segmentStart/DAY*100}%`,width:`${r.segmentMinutes/DAY*100}%`,background:categoryColor(r.category)}}/>)}{gaps.map(g=><button key={g.start} title={`补录 ${timeLabel(g.start)}–${g.end===DAY?'24:00':timeLabel(g.end)}`} className="timeline-gap" style={{left:`${g.start/DAY*100}%`,width:`${(g.end-g.start)/DAY*100}%`}} onClick={()=>addFromGap(g)}/>)}</div><div className="timeline-ticks"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div></div><div className="gap-list"><strong>尚未记录 · {pretty(uncovered)}</strong>{gaps.length?gaps.map(g=><button key={g.start} className="gap-button" onClick={()=>addFromGap(g)}><Plus size={13}/>{timeLabel(g.start)} – {g.end===DAY?'24:00':timeLabel(g.end)} · {pretty(g.end-g.start)}</button>):<span className="complete">已覆盖全天 24 小时</span>}</div></section></>}
  {tab==='stats'&&<><div className="topline"><h2>趋势与分布</h2>{datePicker}</div><div className="grid"><section className="card"><div className="card-title"><h2>近 7 天核心科研</h2><span>小时</span></div><div className="chart"><ResponsiveContainer width="100%" height={300}><BarChart data={last7}><CartesianGrid stroke="#263044" vertical={false}/><XAxis dataKey="day" stroke="#8f9ab0"/><YAxis stroke="#8f9ab0"/><Tooltip/><Bar dataKey="hours" name="核心科研" fill="#a78bfa" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div></section><section className="card"><div className="card-title"><h2>所选日期的分类分布</h2></div>{categoryData.length?<><div className="donut"><ResponsiveContainer width="100%" height={245}><PieChart><Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={65} outerRadius={95}>{categoryData.map(x=><Cell key={x.name} fill={x.color}/>)}</Pie><Tooltip formatter={v=>pretty(v)}/></PieChart></ResponsiveContainer></div><div className="legend">{categoryData.map(x=><div key={x.name}><span className="dot" style={{background:x.color}}/>{x.name}<b>{pretty(x.value)}</b></div>)}</div></>:<div className="empty">该日期暂无数据</div>}</section></div></>}
  {tab==='history'&&<><div className="topline"><h2>按日期回顾</h2>{datePicker}</div><section className="card"><div className="card-title"><h2>{date} · 活动清单</h2><div className="backup-actions"><button className="secondary" onClick={()=>{setShowImport(true);setImportData(null);setImportError('');setImportMessage('')}}>导入 JSON</button><button className="secondary" onClick={exportJSON}><Download size={16}/> 导出全部 JSON</button></div></div>{recordsView}</section></>}
  {importMessage&&<p className="import-message" role="status">{importMessage}</p>}
  <footer>Time Recording · Local-first · 数据仅保存在当前浏览器</footer></main>
  {showCategories&&<CategoryManager categories={categories} records={records} onSave={saveCategories} onClose={()=>setShowCategories(false)}/>}
  {showImport&&<div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><div className="modal-header"><h2 id="import-title">导入 JSON 备份</h2><button className="close" aria-label="关闭导入" disabled={importBusy} onClick={()=>setShowImport(false)}>✕</button></div><p className="import-help">按记录 ID 合并。相同 ID 保留当前记录；备份内重复 ID 保留第一条。确认前不会修改数据。</p><label className="backup-file">选择 JSON 备份文件<input type="file" accept=".json,application/json" disabled={importBusy} onChange={readBackup}/></label>{importBusy&&<p role="status">正在校验…</p>}{importError&&<p className="form-error" role="alert">{importError}</p>}{importData&&importPlan&&<div className="import-preview"><p>文件：{importData.name}</p><p>校验通过：{importData.records.length} 条记录</p><p>当前已有：{records.length} 条 · 将新增：{importPlan.additions.length} 条 · 重复 ID 跳过：{importPlan.duplicates} 条</p>{importPlan.overlaps&&<p className="import-warning">合并后的记录存在时间重叠。恢复会保留这些记录，请在恢复后检查时间轴。</p>}{!importPlan.additions.length&&<p>没有需要新增的记录。</p>}</div>}<div className="actions"><button className="secondary" disabled={importBusy} onClick={()=>setShowImport(false)}>取消</button><button className="primary" disabled={importBusy||!importPlan?.additions.length} onClick={restoreBackup}>确认恢复</button></div></section></div>}
  {showForm&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setShowForm(false)}}><div className="modal"><div className="modal-header"><h2>{editing?'编辑记录':'添加时间记录'}</h2><button className="close" onClick={()=>setShowForm(false)}>✕</button></div><form onSubmit={save}><label>活动名称<input autoFocus required placeholder="例如：阅读 HSP 论文" value={form.title} onChange={e=>{setForm({...form,title:e.target.value});setError('')}}/></label><label>日期（活动开始的日期）<input required type="date" value={form.date} onChange={e=>{setForm({...form,date:e.target.value});setError('')}}/></label><div className="form-row"><label>开始时间<input required type="time" value={form.start} onChange={e=>{setForm({...form,start:e.target.value});setError('')}}/></label><label>结束时间<input required type="time" disabled={form.end==='24:00'} value={form.end==='24:00'?'00:00':form.end} onChange={e=>{setForm({...form,end:e.target.value});setError('')}}/></label></div><label className="midnight-option"><input type="checkbox" checked={form.end==='24:00'} onChange={e=>{setForm({...form,end:e.target.checked?'24:00':'00:00'});setError('')}}/>结束于当日 24:00（次日零点）</label><div className="duration-preview">自动计算时长：{form.start===form.end?'请设置不同的开始与结束时间':pretty(duration(form))} {form.end<form.start?' · 跨午夜，自动分配到两天':''}</div><label>分类<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{categories.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</select></label>{isResearch(form.category)&&<label>研究项目<select value={form.project} onChange={e=>setForm({...form,project:e.target.value})}>{PROJECTS.map(p=><option key={p}>{p}</option>)}</select></label>}<label>备注（可选）<textarea rows="2" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>{error&&<div className="form-error" role="alert">{error}</div>}<div className="actions"><button type="button" className="secondary" onClick={()=>setShowForm(false)}>取消</button><button className="primary" type="submit">保存记录</button></div></form></div></div>}</div>
}
export default App
