const AS_OF = '2026-10-01';
const GRADES = ['Junior', 'Middle', 'Senior', 'Lead'];
const STATUS_LABELS = {completed:'Завершено',in_progress:'В процессе',dropped:'Прервано',no_show:'Пропуск',declined:'Отказ',overdue:'Просрочено'};
const FORMAT_LABELS = {online:'Онлайн',offline:'Очно',self_paced:'В своём темпе',office:'Офис',hybrid:'Гибрид',remote:'Удалённо'};
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const dateRu = value => value ? new Date(value + 'T12:00:00Z').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}) : '—';
const countWord = (n,one,few,many) => { const mod10=n%10,mod100=n%100; return mod10===1&&mod100!==11?one:(mod10>=2&&mod10<=4&&(mod100<12||mod100>14)?few:many); };

let db;
let currentView = 'hr';

function parseCsv(text) {
  const rows=[]; let row=[], field='', quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i], next=text[i+1];
    if(ch==='"' && quoted && next==='"'){field+='"';i++;}
    else if(ch==='"'){quoted=!quoted;}
    else if(ch===',' && !quoted){row.push(field);field='';}
    else if((ch==='\n'||ch==='\r') && !quoted){if(ch==='\r'&&next==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}
    else field+=ch;
  }
  if(field||row.length){row.push(field);rows.push(row);}
  const headers=rows.shift();
  return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
}

function nextProfile(employee) {
  const goal=employee.career_goal;
  const next=GRADES[Math.min(GRADES.indexOf(employee.grade)+1,GRADES.length-1)];
  const role=goal?.target_role || employee.role;
  const grade=goal?.target_grade || next;
  return db.profiles.find(p=>p.role===role&&p.grade===grade) || db.profiles.find(p=>p.role===employee.role&&p.grade===employee.grade);
}

function employeeHistory(employee) { return db.historyByEmployee.get(employee.employee_id) || []; }

function effectiveSkills(employee) {
  const levels={...employee.skills};
  const completed=employeeHistory(employee).filter(h=>h.status==='completed'&&h.date>employee.last_review_date&&h.date<AS_OF).sort((a,b)=>a.date.localeCompare(b.date));
  for(const record of completed){
    const event=db.eventById.get(record.event_id);
    if(!event)continue;
    for(const gain of event.develops_skills){
      const before=levels[gain.skill_id]||0;
      levels[gain.skill_id]=Math.max(before,Math.min(before+gain.gain,gain.max_level));
    }
  }
  return levels;
}

function getGaps(profile,levels) {
  return Object.entries(profile.required_skills).map(([id,required])=>({id,required,current:levels[id]||0,gap:Math.max(0,required-(levels[id]||0)),critical:profile.critical_skills.includes(id),name:db.skillById.get(id)?.name||id}));
}

function recommendations(employee,profile,levels,gaps){
  const records=employeeHistory(employee);
  const completed=new Set(records.filter(r=>r.status==='completed').map(r=>r.event_id));
  const ongoing=new Set(records.filter(r=>r.status==='in_progress').map(r=>r.event_id));
  const gapById=new Map(gaps.map(g=>[g.id,g]));
  const scored=[];
  for(const event of db.events){
    if(event.mandatory||!event.target_roles.includes(employee.role)||!event.target_grades.includes(employee.grade))continue;
    if(completed.has(event.event_id)&&event.event_id!=='EV_036')continue;
    if(ongoing.has(event.event_id))continue;
    if(Object.entries(event.prerequisites).some(([id,min])=>(levels[id]||0)<min))continue;
    const session=event.format==='self_paced'?'Доступно сейчас':(event.upcoming_sessions.find(d=>d>=AS_OF)?dateRu(event.upcoming_sessions.find(d=>d>=AS_OF)):'');
    if(!session)continue;
    const effects=[];
    let score=0;
    for(const gain of event.develops_skills){
      const gap=gapById.get(gain.skill_id);
      if(!gap||!gap.gap)continue;
      const before=levels[gain.skill_id]||0;
      const after=Math.max(before,Math.min(before+gain.gain,gain.max_level));
      const covered=Math.min(gap.gap,Math.max(0,after-before));
      if(!covered)continue;
      score+=covered*(gap.critical?5:2.2);
      effects.push({name:gap.name,before,after,required:gap.required,critical:gap.critical});
    }
    if(!effects.length)continue;
    const similar=records.filter(r=>db.eventById.get(r.event_id)?.format===event.format&&!db.eventById.get(r.event_id)?.mandatory);
    const missed=similar.filter(r=>['no_show','dropped','declined'].includes(r.status)).length;
    const finished=similar.filter(r=>r.status==='completed').length;
    score+=Math.min(finished,3)*.4-Math.min(missed,3)*.8-Math.max(0,event.duration_hours-8)*.025;
    scored.push({event,effects,score,session,finished,missed});
  }
  return scored.sort((a,b)=>b.score-a.score||a.event.event_id.localeCompare(b.event.event_id));
}

function renderEmployee(id){
  if(workspaceRole!=='employee'||id!==actorId)return;
  const employee=db.employeeById.get(id);
  if(!employee)return;
  const profile=nextProfile(employee);
  const levels=effectiveSkills(employee);
  const gaps=getGaps(profile,levels);
  const open=gaps.filter(g=>g.gap>0);
  const critical=open.filter(g=>g.critical);
  const total=gaps.reduce((n,g)=>n+g.required,0);
  const attained=gaps.reduce((n,g)=>n+Math.min(g.current,g.required),0);
  const readiness=Math.round(attained/total*100);
  const history=employeeHistory(employee);
  const allRecs=recommendations(employee,profile,levels,gaps);
  const recs=allRecs.slice(0,3);
  $('person-initials').textContent=employee.full_name.split(' ').map(x=>x[0]).slice(0,2).join('');
  $('person-name').textContent=employee.full_name;
  $('person-role').textContent=`${employee.role} · ${employee.grade}`;
  $('person-dept').textContent=employee.department;
  $('person-format').textContent=FORMAT_LABELS[employee.work_format]||employee.work_format;
  $('person-review').textContent=dateRu(employee.last_review_date);
  $('current-grade').textContent=employee.grade;
  $('goal-label').textContent=employee.career_goal?'Цель':'Ориентир';
  $('target-grade').textContent=`${profile.role} · ${profile.grade}`;
  $('readiness-value').textContent=`${readiness}%`;
  $('readiness-bar').style.width=`${readiness}%`;
  $('readiness-description').textContent=`${attained} из ${total} требуемых уровней навыков набрано. Это ориентир, не решение о повышении.`;
  $('skill-count').textContent=gaps.length;
  $('gap-count').textContent=open.length;
  $('critical-count').textContent=critical.length;
  $('skill-list').innerHTML=open.sort((a,b)=>Number(b.critical)-Number(a.critical)||b.gap-a.gap||a.name.localeCompare(b.name)).slice(0,8).map(g=>`<div class="skill-row ${g.critical?'critical':''}"><div class="skill-line"><b>${escapeHtml(g.name)}</b><span>${g.current} / ${g.required}</span></div><div class="mini-track"><div class="mini-fill" style="width:${Math.min(100,g.current/g.required*100)}%"></div></div></div>`).join('')||'<p class="empty-state">Все требования выбранного профиля по навыкам выполнены.</p>';
  const uncoveredCritical=critical.filter(g=>!allRecs.some(item=>item.effects.some(effect=>effect.name===g.name)));
  $('critical-notice').hidden=uncoveredCritical.length===0;
  $('critical-notice').innerHTML=uncoveredCritical.length?`<b>Нужен отдельный маршрут:</b> для ${escapeHtml(uncoveredCritical.map(g=>g.name).join(', '))} пока нет подходящего доступного занятия с приростом. HR может предложить новую активность или наставника.`:'';
  $('recommendation-list').innerHTML=recs.map((item,index)=>{
    const effect=item.effects[0];
    const extra=item.effects.length>1?` Также помогает с ${item.effects.slice(1).map(x=>x.name).join(', ')}.`:'';
    const historyText=item.missed?` В истории этого формата: пропуски, отказы или прерванное обучение — ${item.missed}. Это снижает приоритет занятия.`:item.finished?` В истории этого формата завершено занятий: ${item.finished}.`:' Истории по этому формату пока мало.';
    return `<article class="recommendation ${index===0?'featured':''}"><div class="recommendation-head"><span class="rank">0${index+1}</span><div><h4>${escapeHtml(item.event.title)}</h4><p class="rec-sub">${escapeHtml(FORMAT_LABELS[item.event.format]||item.event.format)} · ${item.event.duration_hours} ч · ${escapeHtml(item.session)}</p></div></div><p><b>${escapeHtml(effect.name)}:</b> сейчас ${effect.before}, нужно ${effect.required} для ${escapeHtml(profile.grade)}. После завершения станет ${effect.after}.${escapeHtml(extra)}${escapeHtml(historyText)}</p><div class="rec-impact">${item.effects.map(x=>`<span class="impact-pill">${escapeHtml(x.name)} ${x.before} → ${x.after}</span>`).join('')}</div></article>`;
  }).join('')||'<div class="empty-state">Для этого профиля сейчас нет доступных добровольных мероприятий с измеримым приростом к цели. Можно пересмотреть цель или каталог занятий.</div>';
  const statusCounts=Object.entries(STATUS_LABELS).map(([status,label])=>({status,label,count:history.filter(r=>r.status===status).length})).filter(x=>x.count);
  $('history-total').textContent=`${history.length} записей`;
  $('history-stats').innerHTML=statusCounts.map(x=>`<span class="history-stat"><b>${x.count}</b>${x.label}</span>`).join('');
  $('history-list').innerHTML=[...history].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(record=>{const event=db.eventById.get(record.event_id);return `<div class="history-entry"><b>${escapeHtml(event?.title||record.event_id)}</b><span>${escapeHtml(STATUS_LABELS[record.status]||record.status)} · ${dateRu(record.date)}</span></div>`}).join('')||'<p class="empty-state">Истории участия пока нет.</p>';
  renderPersonalProgress(employee);
}

function renderHr(role){
  if(workspaceRole==='employee')return;
  const people=filteredPeople();
  const personIds=new Set(people.map(e=>e.employee_id));
  const records=db.history.filter(r=>personIds.has(r.employee_id));
  const gapCounts=new Map();
  let peopleWithCritical=0;
  for(const person of people){
    const gaps=getGaps(nextProfile(person),effectiveSkills(person));
    if(gaps.some(g=>g.critical&&g.gap>0))peopleWithCritical++;
    for(const gap of gaps.filter(g=>g.gap>0))gapCounts.set(gap.id,(gapCounts.get(gap.id)||0)+1);
  }
  const completed=records.filter(r=>r.status==='completed').length;
  const voluntary=records.filter(r=>!db.eventById.get(r.event_id)?.mandatory);
  const voluntaryCompleted=voluntary.filter(r=>r.status==='completed').length;
  const overdue=records.filter(r=>r.status==='overdue').length;
  const average=people.length?Math.round(people.reduce((sum,e)=>sum+employeeSummary(e).readiness,0)/people.length):0;
  $('hr-metrics').innerHTML=[['Сотрудников',people.length,'В выбранных отделах и ролях'],['С ключевым разрывом',peopleWithCritical,'По матрице целевого профиля'],['Средняя готовность',people.length?average+'%':'—','К цели · не оценка эффективности'],['Завершено активностей',completed,overdue+' просроченных записей']].map(([label,value,caption])=>`<div class="panel hr-metric"><span>${label}</span><strong>${value}</strong><small>${caption}</small></div>`).join('');
  const top=[...gapCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,7);
  $('hr-gaps').innerHTML=top.map(([id,count])=>`<div class="hr-gap-row"><b>${escapeHtml(db.skillById.get(id)?.name||id)}</b><div class="mini-track"><div class="mini-fill" style="width:${Math.round(count/people.length*100)}%"></div></div><span>${count}</span></div>`).join('')||'<p class="empty-state">Для этой выборки разрывов нет.</p>';
  $('hr-activity').innerHTML=[['Завершено',completed],['Добровольных завершено',voluntaryCompleted],['Пропущено',records.filter(r=>r.status==='no_show').length],['Прервано',records.filter(r=>r.status==='dropped').length],['Отказ',records.filter(r=>r.status==='declined').length],['В процессе',records.filter(r=>r.status==='in_progress').length]].map(([label,value])=>`<div class="hr-activity-row"><span>${label}</span><b>${value}</b></div>`).join('');
  renderDashboardExtras(people);
}

function switchView(view){
  const allowed=workspaceRole==='employee'?['employee','learning','integrations']:['hr','people'];
  if(!allowed.includes(view))view=allowed[0];
  currentView=view;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  ['employee','hr','integrations','people','learning'].forEach(name=>$(name+'-view').hidden=name!==view);
  $('team-filters').hidden=workspaceRole==='employee';
  $('page-title').textContent={employee:'Мой маршрут развития',learning:'Моё обучение',hr:workspaceRole==='manager'?'Аналитика моего отдела':'Общая аналитика',people:workspaceRole==='manager'?'Сотрудники моего отдела':'Все сотрудники',integrations:'Мои GitHub и Jira'}[view];
  if(view==='hr')renderHr($('role-select').value);
  if(view==='people')renderEmployeeTable();
  if(view==='employee')renderEmployee(actorId);
  if(view==='learning')renderLearning(actorId);
  if(view==='integrations')renderIntegrations();
}

async function start(){
  try{
    const paths=['employees.json','skills.json','events.json','activity_history.csv'];
    const responses=await Promise.all(paths.map(name=>fetch(`./data/${name}`)));
    for(const response of responses)if(!response.ok)throw new Error(`Не удалось загрузить ${response.url}`);
    const [people,skills,events,csv]=await Promise.all([responses[0].json(),responses[1].json(),responses[2].json(),responses[3].text()]);
    const history=parseCsv(csv);
    db={employees:people.employees,skills:skills.skills,profiles:skills.role_profiles,events:events.events,history,employeeById:new Map(people.employees.map(x=>[x.employee_id,x])),eventById:new Map(events.events.map(x=>[x.event_id,x])),skillById:new Map(skills.skills.map(x=>[x.skill_id,x])),historyByEmployee:new Map()};
    for(const record of history){if(!db.historyByEmployee.has(record.employee_id))db.historyByEmployee.set(record.employee_id,[]);db.historyByEmployee.get(record.employee_id).push(record);}
    const picker=$('employee-select');
    picker.innerHTML=db.employees.map(e=>`<option value="${escapeHtml(e.employee_id)}">${escapeHtml(e.full_name)} · ${escapeHtml(e.employee_id)}</option>`).join('');
    picker.value=db.employeeById.has('E0028')?'E0028':db.employees[0].employee_id;
    const roles=[...new Set(db.employees.map(e=>e.role))].sort();
    $('role-select').innerHTML='<option value="all">Все роли</option>'+roles.map(role=>`<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`).join('');
    initDashboard();
    $('role-select').addEventListener('change',event=>{tablePage=0;renderHr(event.target.value);});
    document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
    initRoles();
    $('loading').hidden=true;
    switchView(currentView);
  }catch(error){$('loading').hidden=true;$('error').hidden=false;$('error').textContent=`Не удалось открыть датасет: ${error.message}`;}
}
start();
